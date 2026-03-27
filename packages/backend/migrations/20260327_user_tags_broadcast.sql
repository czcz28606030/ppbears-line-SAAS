-- ============================================================
-- Migration: User Tags & Broadcast Campaigns
-- PPBears LINE SaaS — Phone Model Tagging Feature
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. user_tags table (already exists — skip if present)
CREATE TABLE IF NOT EXISTS public.user_tags (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  user_id     uuid        NOT NULL,
  tag         text        NOT NULL,
  source      text        NOT NULL DEFAULT 'ai_detected',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Add unique constraint only if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_tags_tenant_user_tag_unique'
  ) THEN
    ALTER TABLE public.user_tags
      ADD CONSTRAINT user_tags_tenant_user_tag_unique UNIQUE (tenant_id, user_id, tag);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_tags_tenant_tag  ON public.user_tags (tenant_id, tag);
CREATE INDEX IF NOT EXISTS idx_user_tags_tenant_user ON public.user_tags (tenant_id, user_id);

ALTER TABLE public.user_tags ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_tags' AND policyname = 'service_role_full_access_user_tags'
  ) THEN
    CREATE POLICY "service_role_full_access_user_tags"
      ON public.user_tags FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 2. broadcast_campaigns table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.broadcast_campaigns (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  name              text        NOT NULL,
  tag_filter        text        NOT NULL,
  message           text        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending',
  total_recipients  int         NOT NULL DEFAULT 0,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz
);

CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_tenant
  ON public.broadcast_campaigns (tenant_id, created_at DESC);

ALTER TABLE public.broadcast_campaigns ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'broadcast_campaigns' AND policyname = 'service_role_full_access_broadcast'
  ) THEN
    CREATE POLICY "service_role_full_access_broadcast"
      ON public.broadcast_campaigns FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


