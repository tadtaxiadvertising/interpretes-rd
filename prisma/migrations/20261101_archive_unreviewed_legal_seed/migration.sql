-- The original migration seeded a generic contract as PUBLISHED.
-- It was not approved by Dominican counsel and must not remain available for
-- new signatures. Existing acceptance evidence is intentionally untouched.
DO $preflight$
BEGIN
  IF to_regclass('public.legal_agreement_versions') IS NULL THEN
    RAISE EXCEPTION
      'Preflight failed: public.legal_agreement_versions does not exist. Apply the versioned legal agreements migration first.';
  END IF;
END
$preflight$;

UPDATE public.legal_agreement_versions
SET status = 'ARCHIVED',
    updated_at = now()
WHERE id = 'legal-freelance-services-2026-10-01'
  AND agreement_key = 'freelance-services'
  AND status = 'PUBLISHED'
  AND created_by = 'system:migration'
  AND published_by = 'system:migration';
