// ============================================================
// PPBears CS SaaS - Global Type Definitions
// ============================================================

// ---- Enums ----

export type ChannelType = 'line' | 'messenger' | 'whatsapp';
export type UserRole = 'customer' | 'admin';
export type MessageRole = 'user' | 'assistant' | 'system';
export type ConversationStatus = 'active' | 'live_agent' | 'closed';
export type LLMProviderType = 'openai' | 'gemini' | 'claude';
export type KnowledgeDocStatus = 'pending' | 'processing' | 'ready' | 'error';
export type SyncJobStatus = 'pending' | 'running' | 'completed' | 'failed';

// ---- Normalized Message ----

export interface NormalizedMessage {
  tenantId: string;
  channelType: ChannelType;
  platformUserId: string;
  messageType: 'text' | 'image' | 'sticker' | 'location' | 'other';
  content: string;
  rawEvent: unknown;
  receivedAt: Date;
}

export interface ReplyMessage {
  type: 'text' | 'image' | 'template';
  content: string;
  altText?: string;
  metadata?: Record<string, unknown>;
}

// ---- Channel Adapter Interface ----

export interface ChannelAdapter {
  channelType: ChannelType;
  verifyWebhook(headers: Record<string, string>, body: string | Buffer): boolean;
  normalizeEvents(rawBody: unknown): NormalizedMessage[];
  sendReply(tenantId: string, platformUserId: string, messages: ReplyMessage[], replyToken?: string): Promise<void>;
  sendReplyWithToken?(tenantId: string, replyToken: string, messages: ReplyMessage[]): Promise<void>;
}

// ---- LLM Types ----

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface LLMResponse {
  content: string;
  provider: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

export interface LLMProvider {
  name: LLMProviderType;
  callLLM(request: LLMRequest, config: LLMProviderConfig): Promise<LLMResponse>;
  isAvailable(config: LLMProviderConfig): Promise<boolean>;
}

export interface LLMProviderConfig {
  provider: LLMProviderType;
  modelName: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  retryCount: number;
}

// ---- DB Row Types ----

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  settings_json: Record<string, unknown>;
  plan: string;
  status: string;
  created_at: string;
}

export interface TenantChannelConfigRow {
  id: string;
  tenant_id: string;
  channel_type: ChannelType;
  credentials_encrypted: string;
  webhook_secret: string;
  enabled: boolean;
}

export interface TenantModelConfigRow {
  id: string;
  tenant_id: string;
  provider: LLMProviderType;
  model_name: string;
  api_key_encrypted: string;
  temperature: number;
  max_tokens: number;
  timeout_ms: number;
  retry_count: number;
  fallback_config_id: string | null;
  is_default: boolean;
  enabled: boolean;
}

export interface UserRow {
  id: string;
  tenant_id: string;
  unified_user_id: string;
  display_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ChannelIdentityRow {
  id: string;
  tenant_id: string;
  user_id: string;
  channel_type: ChannelType;
  platform_user_id: string;
  linked_at: string;
}

export interface ConversationRow {
  id: string;
  tenant_id: string;
  user_id: string;
  channel_type: ChannelType;
  status: ConversationStatus;
  started_at: string;
  last_message_at: string;
}

export interface MessageRow {
  id: string;
  tenant_id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

export interface LiveAgentSessionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  conversation_id: string;
  reason: string;
  started_at: string;
  expires_at: string;
  released_at: string | null;
  released_by: string | null;
}

export interface AdminSessionRow {
  id: string;
  tenant_id: string;
  admin_user_id: string | null;
  platform_user_id: string;
  channel_type: ChannelType;
  elevated_at: string;
  expires_at: string;
}

export interface KnowledgeDocumentRow {
  id: string;
  tenant_id: string;
  filename: string;
  file_type: string;
  category: string;
  storage_path: string;
  status: KnowledgeDocStatus;
  uploaded_at: string;
}

export interface KnowledgeChunkRow {
  id: string;
  tenant_id: string;
  document_id: string;
  content: string;
  embedding: number[];
  chunk_index: number;
  metadata_json: Record<string, unknown>;
}

export interface ProductIndexRow {
  id: string;
  tenant_id: string;
  woo_product_id: number;
  name: string;
  slug: string;
  categories: string;
  tags: string;
  price: string;
  url: string;
  image_url: string;
  phone_models: string;
  synced_at: string;
}

// ---- Orchestrator Types ----

export interface ProcessingContext {
  tenantId: string;
  userId: string;
  platformUserId: string;
  channelType: ChannelType;
  conversationId: string;
  mergedContent: string;
  userRole: UserRole;
  isLiveAgent: boolean;
  conversationHistory: ChatMessage[];
}

export interface OrchestratorResult {
  shouldReply: boolean;
  replyMessages: ReplyMessage[];
  metadata?: Record<string, unknown>;
}
