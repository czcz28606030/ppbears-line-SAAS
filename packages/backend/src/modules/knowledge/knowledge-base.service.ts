import { getSupabaseAdmin } from '../../utils/supabase.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'KnowledgeBase' });

const OPENAI_EMBEDDING_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

export class KnowledgeBaseService {
  /**
   * Split text into overlapping chunks for better retrieval.
   */
  private chunkText(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + CHUNK_SIZE, text.length);
      chunks.push(text.slice(start, end).trim());
      start += CHUNK_SIZE - CHUNK_OVERLAP;
    }
    return chunks.filter(c => c.length > 20);
  }

  /**
   * Create an embedding vector using OpenAI embedding model.
   */
  private async embed(text: string): Promise<number[] | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      log.warn('OPENAI_API_KEY not set, skipping embedding');
      return null;
    }

    try {
      const res = await fetch(OPENAI_EMBEDDING_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: text, model: EMBEDDING_MODEL }),
      });

      if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
      const data = await res.json() as any;
      return data.data[0].embedding;
    } catch (err: any) {
      log.error({ err: err.message }, 'Failed to create embedding');
      return null;
    }
  }

  /**
   * Process a document: chunk → embed → store in knowledge_chunks.
   */
  async processDocument(tenantId: string, documentId: string, textContent: string): Promise<void> {
    const db = getSupabaseAdmin();

    // Update status to processing
    await db.from('knowledge_documents').update({ status: 'processing' }).eq('id', documentId);

    try {
      const chunks = this.chunkText(textContent);
      log.info({ tenantId, documentId, chunks: chunks.length }, 'Processing document chunks');

      // Delete existing chunks for this document (re-indexing)
      await db.from('knowledge_chunks').delete().eq('document_id', documentId);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await this.embed(chunk);

        await db.from('knowledge_chunks').insert({
          tenant_id: tenantId,
          document_id: documentId,
          content: chunk,
          embedding: embedding ? `[${embedding.join(',')}]` : null,
          chunk_index: i,
          metadata_json: { chunkSize: chunk.length },
        });
      }

      await db.from('knowledge_documents').update({ status: 'ready' }).eq('id', documentId);
      log.info({ tenantId, documentId }, 'Document processing complete');
    } catch (err: any) {
      log.error({ tenantId, documentId, err: err.message }, 'Document processing failed');
      await db.from('knowledge_documents').update({
        status: 'error',
        error_message: err.message,
      }).eq('id', documentId);
    }
  }

  /**
   * Retrieve the top-k relevant chunks for a query using vector similarity.
   * Falls back to text search if embeddings not available.
   */
  async retrieveContext(tenantId: string, query: string, topK = 3): Promise<string[]> {
    const db = getSupabaseAdmin();

    // Try vector search first
    const queryEmbedding = await this.embed(query);
    if (queryEmbedding) {
      try {
        const { data } = await (db.rpc as any)('match_knowledge_chunks', {
          query_embedding: `[${queryEmbedding.join(',')}]`,
          match_count: topK,
          p_tenant_id: tenantId,
        });
        if (data && data.length > 0) {
          return data.map((d: any) => d.content);
        }
      } catch (err: any) {
        log.warn({ err: err.message }, 'Vector search failed, falling back to text search');
      }
    }

    // Fallback: text search
    const { data } = await db
      .from('knowledge_chunks')
      .select('content')
      .eq('tenant_id', tenantId)
      .ilike('content', `%${query}%`)
      .limit(topK);

    return data?.map(d => d.content) || [];
  }

  /**
   * Register a new document record in the database.
   */
  async registerDocument(tenantId: string, filename: string, fileType: string, storagePath: string, category = 'general'): Promise<string> {
    const db = getSupabaseAdmin();
    const { data, error } = await db.from('knowledge_documents').insert({
      tenant_id: tenantId,
      filename,
      file_type: fileType,
      category,
      storage_path: storagePath,
      status: 'pending',
    }).select('id').single();

    if (error || !data) throw new Error(`Failed to register document: ${error?.message}`);
    return data.id;
  }

  /**
   * Get all documents for a tenant.
   */
  async listDocuments(tenantId: string) {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('knowledge_documents')
      .select('id, filename, file_type, category, status, uploaded_at')
      .eq('tenant_id', tenantId)
      .order('uploaded_at', { ascending: false });
    return data || [];
  }

  /**
   * Delete a document and all its chunks.
   */
  async deleteDocument(tenantId: string, documentId: string): Promise<void> {
    const db = getSupabaseAdmin();
    // Chunks are deleted via CASCADE in the DB
    await db.from('knowledge_documents')
      .delete()
      .eq('id', documentId)
      .eq('tenant_id', tenantId);
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
