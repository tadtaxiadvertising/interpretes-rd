-- Seed common language-service providers into the existing company directory.
-- Keep this idempotent and preserve any metadata or customizations already stored.
INSERT INTO public.companies (name, active, created_at, updated_at)
VALUES
  ('Propio Language Services', true, NOW(), NOW()),
  ('LanguageLine Solutions', true, NOW(), NOW()),
  ('Lionbridge', true, NOW(), NOW()),
  ('CyraCom', true, NOW(), NOW()),
  ('AMN Healthcare Language Services', true, NOW(), NOW()),
  ('Voyce', true, NOW(), NOW()),
  ('Globo', true, NOW(), NOW()),
  ('Boostlingo', true, NOW(), NOW()),
  ('Language Services Associates (LSA)', true, NOW(), NOW()),
  ('Interpreters Unlimited', true, NOW(), NOW()),
  ('TransPerfect', true, NOW(), NOW()),
  ('LanguageLink', true, NOW(), NOW()),
  ('Stratus Video', true, NOW(), NOW()),
  ('Martti', true, NOW(), NOW()),
  ('Certified Languages International (CLI)', true, NOW(), NOW()),
  ('Telelanguage', true, NOW(), NOW()),
  ('The Language Group', true, NOW(), NOW()),
  ('SOSi', true, NOW(), NOW()),
  ('Jeenie', true, NOW(), NOW()),
  ('Bromberg & Associates', true, NOW(), NOW()),
  ('Propia / Independiente', true, NOW(), NOW()),
  ('Otra compañía', true, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;
