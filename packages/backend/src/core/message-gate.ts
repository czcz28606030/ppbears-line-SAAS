import { getSupabaseAdmin } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { v4 as uuidv4 } from 'uuid';

const log = createLogger({ module: 'MessageGate' });

interface PendingBatch {
  batchId: string;
  tenantId: string;
  userId: string;
  conversationId: string;
  messages: string[];
  timer: ReturnType<typeof setTimeout>;
  gateStartedAt: Date;
}

/**
 * 8-second message gate: merges rapid bursts from same user into one batch.
 * Uses in-memory timers but persists batch state to DB for crash recovery.
 */
export class MessageGateService {
  private pendingBatches = new Map<string, PendingBatch>();
  private onBatchReady: (batch: MergedBatch) => Promise<void>;

  constructor(onBatchReady: (batch: MergedBatch) => Promise<void>) {
    this.onBatchReady = onBatchReady;
  }

  /**
   * Add a message to the gate. If no pending batch for this user,
   * start a new gate window. If batch exists, append to it.
   */
  async addMessage(
    tenantId: string,
    userId: string,
    conversationId: string,
    content: string,
  ): Promise<void> {
    const key = `${tenantId}:${userId}`;
    const existing = this.pendingBatches.get(key);

    if (existing) {
      // Append to existing batch
      existing.messages.push(content);
      log.debug({ key, messageCount: existing.messages.length }, 'Message appended to gate');
      return;
    }

    // Start new gate window
    const batchId = uuidv4();
    const gateStartedAt = new Date();

    const timer = setTimeout(async () => {
      await this.flushBatch(key);
    }, config.messageGate.windowMs);

    this.pendingBatches.set(key, {
      batchId,
      tenantId,
      userId,
      conversationId,
      messages: [content],
      timer,
      gateStartedAt,
    });

    log.debug({ key, batchId }, 'New gate window started');

    // Persist to DB for crash recovery
    const db = getSupabaseAdmin();
    await db.from('message_batches').insert({
      id: batchId,
      tenant_id: tenantId,
      user_id: userId,
      conversation_id: conversationId,
      raw_messages: [content],
      gate_started_at: gateStartedAt.toISOString(),
      processed: false,
      processing_lock: null,
    });
  }

  /**
   * Flush a pending batch: merge messages and trigger processing.
   */
  private async flushBatch(key: string): Promise<void> {
    const batch = this.pendingBatches.get(key);
    if (!batch) return;

    this.pendingBatches.delete(key);
    const mergedContent = batch.messages.join('\n');
    const gateEndedAt = new Date();

    log.info({
      batchId: batch.batchId,
      messageCount: batch.messages.length,
      mergedContent: mergedContent.substring(0, 100),
    }, 'Gate flushed, processing batch');

    // Update DB batch record
    const db = getSupabaseAdmin();
    await db.from('message_batches')
      .update({
        raw_messages: batch.messages,
        merged_content: mergedContent,
        gate_ended_at: gateEndedAt.toISOString(),
        processed: true,
        processing_lock: 'processed',
      })
      .eq('id', batch.batchId);

    // Trigger processing
    await this.onBatchReady({
      batchId: batch.batchId,
      tenantId: batch.tenantId,
      userId: batch.userId,
      conversationId: batch.conversationId,
      mergedContent,
      messageCount: batch.messages.length,
    });
  }

  /**
   * Clean up all pending timers (for graceful shutdown).
   */
  shutdown(): void {
    for (const [key, batch] of this.pendingBatches) {
      clearTimeout(batch.timer);
    }
    this.pendingBatches.clear();
  }
}

export interface MergedBatch {
  batchId: string;
  tenantId: string;
  userId: string;
  conversationId: string;
  mergedContent: string;
  messageCount: number;
}
