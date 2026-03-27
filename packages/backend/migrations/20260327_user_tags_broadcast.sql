-- ============================================================
-- Migration: User Tags & Broadcast Campaigns
-- PPBears LINE SaaS — Phone Model Tagging Feature
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. user_tags table
CREATE TABLE IF NOT EXISTS public.user_tags (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tag         text        NOT NULL,
  source      text        NOT NULL DEFAULT 'ai_detected', -- 'ai_detected' | 'manual'
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one tag per user per tenant
ALTER TABLE public.user_tags
  ADD CONSTRAINT user_tags_tenant_user_tag_unique
  UNIQUE (tenant_id, user_id, tag);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_user_tags_tenant_tag     ON public.user_tags (tenant_id, tag);
CREATE INDEX IF NOT EXISTS idx_user_tags_tenant_user    ON public.user_tags (tenant_id, user_id);

-- Enable RLS
ALTER TABLE public.user_tags ENABLE ROW LEVEL SECURITY;

-- RLS: service role has full access (backend uses service role key)
CREATE POLICY "service_role_full_access_user_tags"
  ON public.user_tags
  FOR ALL
  USING (true)
  WITH CHECK (true);


-- ============================================================
-- 2. broadcast_campaigns table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.broadcast_campaigns (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  name              text        NOT NULL,
  tag_filter        text        NOT NULL,  -- e.g. 'phone:iphone-16-pro'
  message           text        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending', -- pending | sending | done | failed
  total_recipients  int         NOT NULL DEFAULT 0,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz
);

CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_tenant
  ON public.broadcast_campaigns (tenant_id, created_at DESC);

ALTER TABLE public.broadcast_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_broadcast"
  ON public.broadcast_campaigns
  FOR ALL
  USING (true)
  WITH CHECK (true);
