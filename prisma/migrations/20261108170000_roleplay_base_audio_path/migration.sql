-- Keep a canonical Storage object key for base audio so playback URLs can be renewed.
-- Existing rows remain compatible; legacy signed URLs are not rewritten.
ALTER TABLE "public"."roleplay_sessions"
ADD COLUMN IF NOT EXISTS "base_audio_path" TEXT;
