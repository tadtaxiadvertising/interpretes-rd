-- Require a separate, recorded legal review before an agreement can be published.
ALTER TABLE public.legal_agreement_versions
  ADD COLUMN IF NOT EXISTS legal_reviewed_by text,
  ADD COLUMN IF NOT EXISTS legal_reviewed_at timestamptz;
