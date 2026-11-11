-- Restrict the internal Roleplay conversion queue to trusted backend database roles.
-- No client-facing policies are created; workers use the server-side database connection.
ALTER TABLE "public"."roleplay_audio_jobs" ENABLE ROW LEVEL SECURITY;
