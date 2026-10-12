-- Unify onboarding state using the physical column names defined in Prisma.
-- user_profiles.onboarding_complete is canonical; documentos_completo is legacy.

UPDATE public.interpreters AS i
SET documentos_completo = up.onboarding_complete
FROM public.user_profiles AS up
WHERE i.id = up.interpreter_id;

COMMENT ON COLUMN public.user_profiles.onboarding_complete
  IS 'Canonical onboarding state. interpreters.documentos_completo is legacy and synced from this field.';
COMMENT ON COLUMN public.interpreters.documentos_completo
  IS 'Legacy onboarding state. Kept for backward compatibility. Canonical source is user_profiles.onboarding_complete.';
