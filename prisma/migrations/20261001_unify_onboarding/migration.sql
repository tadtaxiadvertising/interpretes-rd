-- Unify onboarding state using the physical column names available in the database.
-- user_profiles onboarding state is canonical; interpreters.documentos_completo is legacy.
-- This migration is intentionally compatible with either historical camelCase or snake_case layouts.

DO $onboarding_backfill$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_profiles'
      AND column_name='onboarding_complete'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_profiles'
      AND column_name='interpreter_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='interpreters'
      AND column_name='documentos_completo'
  ) THEN
    UPDATE public.interpreters AS i
    SET documentos_completo = up.onboarding_complete
    FROM public.user_profiles AS up
    WHERE i.id = up.interpreter_id;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_profiles'
      AND column_name='onboardingComplete'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_profiles'
      AND column_name='interpreterId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='interpreters'
      AND column_name='documentos_completo'
  ) THEN
    EXECUTE 'UPDATE public.interpreters AS i
      SET documentos_completo = up."onboardingComplete"
      FROM public.user_profiles AS up
      WHERE i.id = up."interpreterId"';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_profiles'
      AND column_name='onboarding_complete'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN public.user_profiles.onboarding_complete IS
      ''Canonical onboarding state. interpreters.documentos_completo is legacy and synced from this field.''';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_profiles'
      AND column_name='onboardingComplete'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN public.user_profiles."onboardingComplete" IS
      ''Canonical onboarding state. interpreters.documentos_completo is legacy and synced from this field.''';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='interpreters'
      AND column_name='documentos_completo'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN public.interpreters.documentos_completo IS
      ''Legacy onboarding state. Kept for backward compatibility. Canonical source is user_profiles onboarding state.''';
  END IF;
END
$onboarding_backfill$;
