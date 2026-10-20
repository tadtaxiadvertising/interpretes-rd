-- Migration: Add review_started_at column to roleplay_sessions table
-- This migration adds the review_started_at column to track when QA review started

-- Add the review_started_at column to roleplay_sessions table
ALTER TABLE "public"."roleplay_sessions" 
ADD COLUMN "review_started_at" TIMESTAMP WITH TIME ZONE;

-- Add the review_priority column to roleplay_sessions table
ALTER TABLE "public"."roleplay_sessions" 
ADD COLUMN "review_priority" INTEGER DEFAULT 0;

-- Add index for review_priority for efficient queue queries
CREATE INDEX IF NOT EXISTS "idx_roleplay_review_priority" ON "public"."roleplay_sessions" ("review_priority");

-- Add index for review_started_at for efficient queue queries
CREATE INDEX IF NOT EXISTS "idx_roleplay_review_started_at" ON "public"."roleplay_sessions" ("review_started_at");

-- Add index for status and review_started_at for efficient queue filtering
CREATE INDEX IF NOT EXISTS "idx_roleplay_status_review_started" ON "public"."roleplay_sessions" ("status", "review_started_at");