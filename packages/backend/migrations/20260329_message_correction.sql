-- ============================================================
-- Migration: Message Knowledge Correction Tracking
-- PPBears LINE SaaS — Conversation Message Correction Feature
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- Add corrected_at and corrected_by columns to messages table
-- Uses IF NOT EXISTS pattern to be idempotent (safe to run multiple times)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'corrected_at'
  ) THEN
    ALTER TABLE public.messages
      ADD COLUMN corrected_at  TIMESTAMPTZ DEFAULT NULL,
      ADD COLUMN corrected_by  TEXT        DEFAULT NULL;
  END IF;
END $$;

-- Index for quickly querying corrected messages per tenant
CREATE INDEX IF NOT EXISTS idx_messages_corrected_at
  ON public.messages (tenant_id, corrected_at)
  WHERE corrected_at IS NOT NULL;

-- Done
