-- ============================================================
-- PPBears CS SaaS - Initial Database Schema
-- ============================================================

-- Enable pgvector extension for knowledge embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable uuid extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. Tenants
-- ============================================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  settings_json JSONB DEFAULT '{}',
  plan TEXT DEFAULT 'free',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. Tenant Admin Users
-- ============================================================
CREATE TABLE tenant_admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, email)
);
CREATE INDEX idx_tenant_admin_users_tenant ON tenant_admin_users(tenant_id);

-- ============================================================
-- 3. Tenant Channel Configs
-- ============================================================
CREATE TABLE tenant_channel_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL, -- 'line' | 'messenger' | 'whatsapp'
  credentials_encrypted JSONB NOT NULL DEFAULT '{}',
  webhook_secret TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, channel_type)
);
CREATE INDEX idx_tenant_channel_configs_tenant ON tenant_channel_configs(tenant_id);

-- ============================================================
-- 4. Tenant Model Configs
-- ============================================================
CREATE TABLE tenant_model_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'openai' | 'gemini' | 'claude'
  model_name TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 1024,
  timeout_ms INTEGER DEFAULT 30000,
  retry_count INTEGER DEFAULT 2,
  fallback_config_id UUID REFERENCES tenant_model_configs(id),
  is_default BOOLEAN DEFAULT false,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_tenant_model_configs_tenant ON tenant_model_configs(tenant_id);
CREATE INDEX idx_tenant_model_configs_default ON tenant_model_configs(tenant_id, is_default) WHERE is_default = true;

-- ============================================================
-- 5. Tenant Prompt Configs
-- ============================================================
CREATE TABLE tenant_prompt_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prompt_type TEXT NOT NULL, -- 'system' | 'greeting' | 'fallback' | 'scope_guard'
  content TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_tenant_prompt_configs_tenant ON tenant_prompt_configs(tenant_id);

-- ============================================================
-- 6. Tenant Settings (key-value)
-- ============================================================
CREATE TABLE tenant_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, key)
);
CREATE INDEX idx_tenant_settings_tenant ON tenant_settings(tenant_id);

-- ============================================================
-- 7. Users (unified)
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unified_user_id TEXT NOT NULL,
  display_name TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, unified_user_id)
);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_unified ON users(tenant_id, unified_user_id);

-- ============================================================
-- 8. Channel Identities
-- ============================================================
CREATE TABLE channel_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  linked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, channel_type, platform_user_id)
);
CREATE INDEX idx_channel_identities_tenant ON channel_identities(tenant_id);
CREATE INDEX idx_channel_identities_platform ON channel_identities(tenant_id, channel_type, platform_user_id);

-- ============================================================
-- 9. Conversations
-- ============================================================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  status TEXT DEFAULT 'active', -- 'active' | 'live_agent' | 'closed'
  started_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX idx_conversations_user ON conversations(tenant_id, user_id);
CREATE INDEX idx_conversations_status ON conversations(tenant_id, status);

-- ============================================================
-- 10. Messages
-- ============================================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  metadata_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_tenant ON messages(tenant_id);

-- ============================================================
-- 11. Message Batches (8-second gate)
-- ============================================================
CREATE TABLE message_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  raw_messages JSONB DEFAULT '[]', -- array of individual messages
  merged_content TEXT,
  gate_started_at TIMESTAMPTZ NOT NULL,
  gate_ended_at TIMESTAMPTZ,
  processed BOOLEAN DEFAULT false,
  processing_lock TEXT, -- for DB-based locking
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_message_batches_pending ON message_batches(tenant_id, user_id, processed) WHERE processed = false;

-- ============================================================
-- 12. Admin Sessions (elevated auth via messaging)
-- ============================================================
CREATE TABLE admin_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  admin_user_id UUID REFERENCES tenant_admin_users(id),
  platform_user_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  elevated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_admin_sessions_lookup ON admin_sessions(tenant_id, platform_user_id, channel_type);

-- ============================================================
-- 13. Admin Commands Log
-- ============================================================
CREATE TABLE admin_commands_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  admin_user_id TEXT,
  command TEXT NOT NULL,
  params_json JSONB DEFAULT '{}',
  result_json JSONB DEFAULT '{}',
  executed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_admin_commands_log_tenant ON admin_commands_log(tenant_id);

-- ============================================================
-- 14. Live Agent Sessions
-- ============================================================
CREATE TABLE live_agent_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  conversation_id UUID REFERENCES conversations(id),
  reason TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  released_by TEXT
);
CREATE INDEX idx_live_agent_sessions_active ON live_agent_sessions(tenant_id, user_id) WHERE released_at IS NULL;
CREATE INDEX idx_live_agent_sessions_expiry ON live_agent_sessions(expires_at) WHERE released_at IS NULL;

-- ============================================================
-- 15. Knowledge Documents
-- ============================================================
CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  storage_path TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending' | 'processing' | 'ready' | 'error'
  error_message TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_knowledge_documents_tenant ON knowledge_documents(tenant_id);

-- ============================================================
-- 16. Knowledge Chunks (with vector embedding)
-- ============================================================
CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536), -- OpenAI text-embedding-3-small dimension
  chunk_index INTEGER NOT NULL,
  metadata_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_knowledge_chunks_tenant ON knowledge_chunks(tenant_id);
CREATE INDEX idx_knowledge_chunks_document ON knowledge_chunks(document_id);

-- ============================================================
-- 17. Product Index
-- ============================================================
CREATE TABLE product_index (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  woo_product_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT,
  categories TEXT,
  tags TEXT,
  price TEXT,
  url TEXT,
  image_url TEXT,
  phone_models TEXT, -- comma-separated for search
  status TEXT DEFAULT 'active',
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, woo_product_id)
);
CREATE INDEX idx_product_index_tenant ON product_index(tenant_id);
CREATE INDEX idx_product_index_search ON product_index USING gin (to_tsvector('simple', name || ' ' || COALESCE(categories, '') || ' ' || COALESCE(tags, '') || ' ' || COALESCE(phone_models, '')));

-- ============================================================
-- 18. Order Lookup Logs
-- ============================================================
CREATE TABLE order_lookup_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  lookup_key TEXT,
  lookup_type TEXT, -- 'order_number' | 'phone' | 'name' | 'email'
  success BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_order_lookup_logs_tenant ON order_lookup_logs(tenant_id);

-- ============================================================
-- 19. Sync Jobs
-- ============================================================
CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL, -- 'product_sync' | 'category_sync' | 'model_sync'
  status TEXT DEFAULT 'pending', -- 'pending' | 'running' | 'completed' | 'failed'
  items_processed INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sync_jobs_tenant ON sync_jobs(tenant_id);

-- ============================================================
-- 20. Audit Logs
-- ============================================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  actor_type TEXT NOT NULL, -- 'system' | 'admin' | 'customer'
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_time ON audit_logs(created_at);

-- ============================================================
-- 21. System Errors
-- ============================================================
CREATE TABLE system_errors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID,
  module TEXT NOT NULL,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_system_errors_tenant ON system_errors(tenant_id);
CREATE INDEX idx_system_errors_time ON system_errors(created_at);

-- ============================================================
-- 22. Admin Whitelist (messaging-based admin identification)
-- ============================================================
CREATE TABLE admin_whitelist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  label TEXT, -- friendly name for the admin
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, channel_type, platform_user_id)
);
CREATE INDEX idx_admin_whitelist_lookup ON admin_whitelist(tenant_id, channel_type, platform_user_id);

-- ============================================================
-- Seed: Default PPBears tenant
-- ============================================================
INSERT INTO tenants (id, name, slug, plan, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'PPBears', 'ppbears', 'enterprise', 'active');
