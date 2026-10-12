-- Production schema reconciliation for errors observed in application logs.
-- Additive and idempotent: does not delete, recreate, or seed any users.
-- Review against a recent database backup before applying to production.

BEGIN;

-- Fail fast if these are not the existing tables from the reported production errors.
DO $preflight$
BEGIN
  IF to_regclass('public.user_profiles') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.user_profiles does not exist; stop and reconcile the database baseline first.';
  END IF;
  IF to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.notifications does not exist; stop and reconcile the database baseline first.';
  END IF;
  IF to_regclass('public.roleplay_sessions') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.roleplay_sessions does not exist; stop and reconcile the roleplay database baseline first.';
  END IF;
END
$preflight$;

-- UserProfile fields used by Prisma and by onboarding identity resolution.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account TEXT,
  ADD COLUMN IF NOT EXISTS bank_cedula TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_type TEXT,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS signature_date TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_user_profiles_onboarding
  ON public.user_profiles (onboarding_complete)
  WHERE onboarding_complete = FALSE;

COMMENT ON COLUMN public.user_profiles.onboarding_complete
  IS 'Canonical onboarding completion state. Legacy interpreter flags must not override this value.';

-- Notification model fields seen missing from the live schema. These additions
-- retain existing rows and avoid inventing user IDs for historical notifications.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS link TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ(6) DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_category
  ON public.notifications (category);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read
  ON public.notifications (is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON public.notifications (created_at);

-- Auth.js legacy/RBAC model. The table was absent according to production logs.
-- Do not seed any accounts here; account creation/credential recovery is a separate
-- audited process and must never reset an existing user's password implicitly.
DO $types$
BEGIN
  CREATE TYPE public."RbacRole" AS ENUM ('ADMIN', 'HOLDER', 'INTERPRETER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$types$;

DO $message_status_type$
BEGIN
  CREATE TYPE public."VaultMessageStatus" AS ENUM ('PENDING_ADMIN', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$message_status_type$;

-- The current Prisma enum supports the full roleplay lifecycle. Older production
-- migrations created only PENDING/EVALUATED, which would reject newer states.
DO $roleplay_status_type$
BEGIN
  CREATE TYPE public."RoleplayStatus" AS ENUM (
    'DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED',
    'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED', 'EXPIRED', 'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$roleplay_status_type$;

ALTER TYPE public."RoleplayStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE public."RoleplayStatus" ADD VALUE IF NOT EXISTS 'INVITED';
ALTER TYPE public."RoleplayStatus" ADD VALUE IF NOT EXISTS 'STARTED';
ALTER TYPE public."RoleplayStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE public."RoleplayStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE public."RoleplayStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE public."RoleplayStatus" ADD VALUE IF NOT EXISTS 'EVALUATED';
ALTER TYPE public."RoleplayStatus" ADD VALUE IF NOT EXISTS 'PASSED';
ALTER TYPE public."RoleplayStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE public."RoleplayStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE public."RoleplayStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TABLE IF NOT EXISTS public.rbac_users (
  id TEXT NOT NULL,
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role public."RbacRole" NOT NULL DEFAULT 'INTERPRETER',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT rbac_users_pkey PRIMARY KEY (id),
  CONSTRAINT rbac_users_email_key UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS rbac_users_role_idx ON public.rbac_users (role);

CREATE TABLE IF NOT EXISTS public.vault_accounts (
  id TEXT NOT NULL,
  "platformName" TEXT NOT NULL,
  url TEXT,
  "vpnConfig" TEXT,
  credentials TEXT NOT NULL,
  notes TEXT,
  "holderId" TEXT NOT NULL,
  "interpreterId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT vault_accounts_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS vault_accounts_holderId_idx ON public.vault_accounts ("holderId");
CREATE INDEX IF NOT EXISTS vault_accounts_interpreterId_idx ON public.vault_accounts ("interpreterId");

DO $vault_account_fks$
BEGIN
  ALTER TABLE public.vault_accounts
    ADD CONSTRAINT vault_accounts_holderId_fkey
    FOREIGN KEY ("holderId") REFERENCES public.rbac_users(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$vault_account_fks$;

DO $vault_interpreter_fks$
BEGIN
  ALTER TABLE public.vault_accounts
    ADD CONSTRAINT vault_accounts_interpreterId_fkey
    FOREIGN KEY ("interpreterId") REFERENCES public.rbac_users(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$vault_interpreter_fks$;

CREATE TABLE IF NOT EXISTS public.vault_attachments (
  id TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL DEFAULT 0,
  "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "accountId" TEXT NOT NULL,
  "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT vault_attachments_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS vault_attachments_accountId_idx ON public.vault_attachments ("accountId");

DO $vault_attachment_fk$
BEGIN
  ALTER TABLE public.vault_attachments
    ADD CONSTRAINT vault_attachments_accountId_fkey
    FOREIGN KEY ("accountId") REFERENCES public.vault_accounts(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$vault_attachment_fk$;

CREATE TABLE IF NOT EXISTS public.vault_messages (
  id TEXT NOT NULL,
  content TEXT NOT NULL,
  status public."VaultMessageStatus" NOT NULL DEFAULT 'PENDING_ADMIN',
  "authorId" TEXT NOT NULL,
  "recipientId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT vault_messages_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS vault_messages_authorId_idx ON public.vault_messages ("authorId");
CREATE INDEX IF NOT EXISTS vault_messages_recipientId_idx ON public.vault_messages ("recipientId");
CREATE INDEX IF NOT EXISTS vault_messages_status_idx ON public.vault_messages (status);

DO $vault_message_fks$
BEGIN
  ALTER TABLE public.vault_messages
    ADD CONSTRAINT vault_messages_authorId_fkey
    FOREIGN KEY ("authorId") REFERENCES public.rbac_users(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$vault_message_fks$;

DO $vault_recipient_fks$
BEGIN
  ALTER TABLE public.vault_messages
    ADD CONSTRAINT vault_messages_recipientId_fkey
    FOREIGN KEY ("recipientId") REFERENCES public.rbac_users(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$vault_recipient_fks$;

-- Post-migration assertions: rollback instead of shipping a partial repair.
DO $verify$
DECLARE
  missing_column_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_column_count
  FROM (
    VALUES
      ('user_profiles', 'bank_name'),
      ('user_profiles', 'bank_account'),
      ('user_profiles', 'bank_cedula'),
      ('user_profiles', 'bank_account_type'),
      ('user_profiles', 'terms_accepted_at'),
      ('user_profiles', 'signature_date'),
      ('user_profiles', 'onboarding_complete'),
      ('notifications', 'user_id'),
      ('notifications', 'type'),
      ('notifications', 'category'),
      ('notifications', 'is_read'),
      ('notifications', 'link'),
      ('notifications', 'created_at'),
      ('rbac_users', 'id'),
      ('rbac_users', 'email'),
      ('rbac_users', 'password'),
      ('rbac_users', 'name'),
      ('rbac_users', 'role'),
      ('rbac_users', 'createdAt'),
      ('rbac_users', 'updatedAt'),
      ('vault_accounts', 'id'),
      ('vault_accounts', 'platformName'),
      ('vault_accounts', 'url'),
      ('vault_accounts', 'vpnConfig'),
      ('vault_accounts', 'credentials'),
      ('vault_accounts', 'notes'),
      ('vault_accounts', 'holderId'),
      ('vault_accounts', 'interpreterId'),
      ('vault_accounts', 'createdAt'),
      ('vault_accounts', 'updatedAt'),
      ('vault_attachments', 'id'),
      ('vault_attachments', 'fileName'),
      ('vault_attachments', 'fileUrl'),
      ('vault_attachments', 'fileSize'),
      ('vault_attachments', 'mimeType'),
      ('vault_attachments', 'accountId'),
      ('vault_attachments', 'uploadedAt'),
      ('vault_messages', 'id'),
      ('vault_messages', 'content'),
      ('vault_messages', 'status'),
      ('vault_messages', 'authorId'),
      ('vault_messages', 'recipientId'),
      ('vault_messages', 'createdAt')
  ) AS expected(table_name, column_name)
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema = 'public'
   AND actual.table_name = expected.table_name
   AND actual.column_name = expected.column_name
  WHERE actual.column_name IS NULL;

  IF missing_column_count > 0 THEN
    RAISE EXCEPTION 'Verification failed: % required schema columns are missing. Transaction will roll back.', missing_column_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'user_id' AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Verification failed: notifications.user_id must be UUID to match the Prisma model';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles'
      AND column_name = 'onboarding_complete' AND data_type = 'boolean'
  ) THEN
    RAISE EXCEPTION 'Verification failed: user_profiles.onboarding_complete must be BOOLEAN';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'RoleplayStatus'
      AND e.enumlabel IN (
        'DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED',
        'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED', 'EXPIRED', 'CANCELLED'
      )
  ) <> 11 THEN
    RAISE EXCEPTION 'Verification failed: RoleplayStatus enum does not contain all application states';
  END IF;
END
$verify$;

COMMIT;
