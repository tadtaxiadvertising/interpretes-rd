ALTER TABLE public.legal_agreement_versions
  ADD COLUMN IF NOT EXISTS legal_review_hash text;
