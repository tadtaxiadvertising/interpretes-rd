-- Preserve non-sensitive source metadata for externally imported Audio Studio clips.
-- Existing scenarios remain compatible: all new columns are nullable.
ALTER TABLE public.roleplay_scenarios
  ADD COLUMN IF NOT EXISTS studio_turn INTEGER,
  ADD COLUMN IF NOT EXISTS studio_speaker TEXT,
  ADD COLUMN IF NOT EXISTS studio_language TEXT,
  ADD COLUMN IF NOT EXISTS source_start_sec DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS source_end_sec DOUBLE PRECISION;

ALTER TABLE public.roleplay_scenarios
  ADD CONSTRAINT roleplay_scenarios_studio_turn_positive CHECK (studio_turn IS NULL OR studio_turn > 0),
  ADD CONSTRAINT roleplay_scenarios_studio_speaker_valid CHECK (studio_speaker IS NULL OR studio_speaker IN ('speaker_1', 'speaker_2', 'speaker_3')),
  ADD CONSTRAINT roleplay_scenarios_studio_language_valid CHECK (studio_language IS NULL OR studio_language IN ('en', 'es', 'mixed')),
  ADD CONSTRAINT roleplay_scenarios_source_time_pair_valid CHECK ((source_start_sec IS NULL AND source_end_sec IS NULL) OR (source_start_sec IS NOT NULL AND source_end_sec IS NOT NULL AND source_start_sec >= 0 AND source_end_sec > source_start_sec AND source_end_sec <= 7200));
