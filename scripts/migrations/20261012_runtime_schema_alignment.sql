-- Generated schema recovery for the Supabase project and prisma/schema.prisma as of 2026-10-12.

-- Additive/idempotent: no table drops, no row deletes, no user seeding.

-- Run with a recent backup. RLS/policies are intentionally not changed by this schema migration.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET LOCAL search_path = public, extensions;

DO $enum$ BEGIN CREATE TYPE public."AudioStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $enum$;

DO $enum$ BEGIN CREATE TYPE public."RbacRole" AS ENUM ('ADMIN', 'HOLDER', 'INTERPRETER'); EXCEPTION WHEN duplicate_object THEN NULL; END $enum$;

DO $enum$ BEGIN CREATE TYPE public."RecruitmentApplicationStatus" AS ENUM ('APPLIED', 'PROFILE_PENDING', 'DOCUMENTS_PENDING', 'LANGUAGE_PENDING', 'TECHNICAL_PENDING', 'INDUCTION_PENDING', 'ROLEPLAY_PENDING', 'ROLEPLAY_IN_PROGRESS', 'ROLEPLAY_REVIEW', 'INTERVIEW_PENDING', 'INTERVIEW_SCHEDULED', 'INTERVIEW_REVIEW', 'OFFER_PENDING', 'OFFER_SENT', 'OFFER_ACCEPTED', 'CONTRACT_PENDING', 'BANKING_PENDING', 'TECH_SETUP_PENDING', 'TRAINING_PENDING', 'READY_FOR_ACTIVATION', 'HIRING', 'HIRED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $enum$;

DO $enum$ BEGIN CREATE TYPE public."RecruitmentContractStatus" AS ENUM ('PENDING', 'SENT', 'SIGNED', 'REJECTED', 'EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $enum$;

DO $enum$ BEGIN CREATE TYPE public."RecruitmentDocumentStatus" AS ENUM ('UPLOADED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $enum$;

DO $enum$ BEGIN CREATE TYPE public."RecruitmentDocumentType" AS ENUM ('CV', 'IDENTITY', 'LANGUAGE_CERTIFICATE', 'BACKGROUND_CHECK', 'PHOTO', 'CONTRACT', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $enum$;

DO $enum$ BEGIN CREATE TYPE public."RecruitmentEventType" AS ENUM ('APPLICATION_CREATED', 'PROFILE_COMPLETED', 'DOCUMENT_UPLOADED', 'DOCUMENT_APPROVED', 'DOCUMENT_REJECTED', 'LANGUAGE_APPROVED', 'LANGUAGE_REJECTED', 'TECHNICAL_COMPLETED', 'TECHNICAL_REJECTED', 'INDUCTION_COMPLETED', 'ROLEPLAY_CREATED', 'ROLEPLAY_STARTED', 'ROLEPLAY_SUBMITTED', 'ROLEPLAY_EVALUATED', 'ROLEPLAY_PASSED', 'ROLEPLAY_FAILED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'INTERVIEW_FAILED', 'OFFER_SENT', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'CONTRACT_SIGNED', 'BANKING_COMPLETED', 'TECH_SETUP_COMPLETED', 'TRAINING_COMPLETED', 'READY_FOR_ACTIVATION', 'HIRING_STARTED', 'HIRED', 'REJECTED', 'WITHDRAWN'); EXCEPTION WHEN duplicate_object THEN NULL; END $enum$;

DO $enum$ BEGIN CREATE TYPE public."RecruitmentInterviewStatus" AS ENUM ('PENDING', 'SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $enum$;

DO $enum$ BEGIN CREATE TYPE public."RecruitmentOfferStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $enum$;

DO $enum$ BEGIN CREATE TYPE public."RecruitmentStep" AS ENUM ('APPLICATION', 'PROFILE', 'DOCUMENTS', 'LANGUAGE', 'TECHNICAL', 'INDUCTION', 'ROLEPLAY', 'ROLEPLAY_REVIEW', 'INTERVIEW', 'DECISION', 'OFFER', 'CONTRACT', 'BANKING', 'TECH_SETUP', 'TRAINING', 'READY_FOR_ACTIVATION', 'HIRING'); EXCEPTION WHEN duplicate_object THEN NULL; END $enum$;

DO $enum$ BEGIN CREATE TYPE public."RoleplayStatus" AS ENUM ('DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED', 'EXPIRED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $enum$;

DO $enum$ BEGIN CREATE TYPE public."VaultMessageStatus" AS ENUM ('PENDING_ADMIN', 'APPROVED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $enum$;

CREATE SEQUENCE IF NOT EXISTS public."accounts_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS public."call_sessions_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS public."interpreter_account_rates_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS public."interpreter_monthly_metrics_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS public."interpreter_status_logs_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS public."interpreters_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS public."payrate_audit_log_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS public."production_logs_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS public."qa_scores_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS public."recruitment_candidates_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS public."system_configs_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE TABLE IF NOT EXISTS public."accounts" (
  "id" integer DEFAULT nextval('accounts_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamp(6) with time zone DEFAULT now(),
  "updated_at" timestamp(6) with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."call_sessions" (
  "id" integer DEFAULT nextval('call_sessions_id_seq'::regclass) NOT NULL,
  "interpreter_id" integer,
  "started_at" timestamp(6) with time zone DEFAULT now(),
  "ended_at" timestamp(6) with time zone,
  "duration_seconds" integer,
  "tariff_snapshot" numeric(10,2) NOT NULL,
  "call_cost" numeric(10,2),
  "notes" text,
  "created_at" timestamp(6) with time zone DEFAULT now(),
  "is_settled" boolean DEFAULT false NOT NULL,
  "payroll_record_id" text
);

CREATE TABLE IF NOT EXISTS public."interpreter_account_rates" (
  "id" integer DEFAULT nextval('interpreter_account_rates_id_seq'::regclass) NOT NULL,
  "interpreter_id" integer,
  "account_id" integer,
  "tariff_per_hour" numeric(10,2) NOT NULL,
  "created_at" timestamp(6) with time zone DEFAULT now(),
  "updated_at" timestamp(6) with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."interpreter_monthly_metrics" (
  "id" integer DEFAULT nextval('interpreter_monthly_metrics_id_seq'::regclass) NOT NULL,
  "interpreter_id" integer NOT NULL,
  "period" text NOT NULL,
  "interpreted_minutes" integer DEFAULT 0 NOT NULL,
  "qa_score" numeric(5,2),
  "ranking_position" integer,
  "total_interpreters" integer,
  "updated_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."interpreter_status_logs" (
  "id" integer DEFAULT nextval('interpreter_status_logs_id_seq'::regclass) NOT NULL,
  "interpreter_id" integer NOT NULL,
  "previous_status" text,
  "new_status" text NOT NULL,
  "reason" text DEFAULT 'manual'::text NOT NULL,
  "changed_by" text,
  "metadata" jsonb,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."interpreters" (
  "id" integer DEFAULT nextval('interpreters_id_seq'::regclass) NOT NULL,
  "external_id" character varying(255) NOT NULL,
  "name" character varying(255) NOT NULL,
  "status" character varying(50) DEFAULT 'Activo'::character varying NOT NULL,
  "realtime_status" character varying(50) DEFAULT 'Offline'::character varying NOT NULL,
  "language_a" character varying(50) DEFAULT 'Español'::character varying NOT NULL,
  "language_b" character varying(50) DEFAULT 'Inglés'::character varying NOT NULL,
  "email_corporativo" character varying(255),
  "telefono" character varying(30),
  "pais" character varying(100),
  "tariff_per_minute" numeric(10,4) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status_reason" text DEFAULT 'initial'::text,
  "last_heartbeat" timestamp(6) with time zone,
  "last_activity" timestamp(6) with time zone,
  "last_online_at" timestamp(6) with time zone,
  "last_offline_at" timestamp(6) with time zone,
  "status_changed_at" timestamp(6) with time zone,
  "browser_tab_id" text,
  "client_ip" text,
  "campaign" text,
  "metodo_pago" text DEFAULT 'Transferencia Bancaria'::text,
  "cuenta_pago" text,
  "documentos_completo" boolean DEFAULT false,
  "notas" text,
  "banco" text,
  "tipo_cuenta" text,
  "cedula_rnc" text,
  "monthly_goal" integer DEFAULT 2000 NOT NULL,
  "payment_frequency" text DEFAULT 'Monthly'::text,
  "payment_day" text DEFAULT '1'::text,
  "shift_start" text DEFAULT '09:00'::text,
  "shift_end" text DEFAULT '17:00'::text
);

CREATE TABLE IF NOT EXISTS public."messages" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "sender_id" uuid NOT NULL,
  "receiver_id" uuid NOT NULL,
  "content" text NOT NULL,
  "is_read" boolean DEFAULT false,
  "created_at" timestamp(6) with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."notifications" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "userid" character varying(255),
  "title" character varying(500) NOT NULL,
  "message" text NOT NULL,
  "type" character varying(50) DEFAULT 'info'::character varying NOT NULL,
  "category" character varying(50) DEFAULT 'system'::character varying NOT NULL,
  "is_read" boolean DEFAULT false NOT NULL,
  "link" character varying(500),
  "createdat" timestamp with time zone DEFAULT now() NOT NULL,
  "user_id" uuid,
  "created_at" timestamp(6) with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."password_reset_tokens" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "email" text NOT NULL,
  "token" text NOT NULL,
  "expires" timestamp(6) with time zone NOT NULL,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."payrate_audit_log" (
  "id" integer DEFAULT nextval('payrate_audit_log_id_seq'::regclass) NOT NULL,
  "interpreter_id" integer,
  "old_rate" numeric(10,2),
  "new_rate" numeric(10,2) NOT NULL,
  "changed_by" text NOT NULL,
  "changed_at" timestamp(6) with time zone DEFAULT now(),
  "details" text
);

CREATE TABLE IF NOT EXISTS public."payroll_records" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "interpreter_id" integer,
  "total_minutes" integer NOT NULL,
  "gross_total" numeric(10,2) NOT NULL,
  "quality_bonus" numeric(10,2) DEFAULT 0,
  "penalidades" numeric(10,2) DEFAULT 0,
  "transfer_deduction" numeric(10,2) DEFAULT 0,
  "net_total" numeric(10,2) NOT NULL,
  "status" text DEFAULT 'Pendiente'::text,
  "payment_date" timestamp(6) with time zone,
  "created_at" timestamp(6) with time zone DEFAULT now(),
  "verified_minutes" integer,
  "incentives_total" numeric(10,2) DEFAULT 0 NOT NULL,
  "paid_at" timestamp(6) with time zone,
  "transaction_reference" text,
  "reconciliation_hash" text
);

CREATE TABLE IF NOT EXISTS public."production_logs" (
  "id" integer DEFAULT nextval('production_logs_id_seq'::regclass) NOT NULL,
  "interpreter_id" integer,
  "account_id" integer,
  "date" date NOT NULL,
  "campaign" text,
  "scheduled_hours" text,
  "login_time" timestamp(6) with time zone,
  "logout_time" timestamp(6) with time zone,
  "connected_hours" numeric(10,2),
  "interpreted_minutes" integer DEFAULT 0,
  "calls_attended" integer DEFAULT 0,
  "adherence" numeric(5,2),
  "status" text NOT NULL,
  "observaciones" text,
  "created_at" timestamp(6) with time zone DEFAULT now(),
  "verified_minutes" integer,
  "is_settled" boolean DEFAULT false NOT NULL,
  "payroll_record_id" text
);

CREATE TABLE IF NOT EXISTS public."qa_scores" (
  "id" integer DEFAULT nextval('qa_scores_id_seq'::regclass) NOT NULL,
  "production_log_id" integer,
  "interpreter_id" integer,
  "audit_date" timestamp(6) with time zone NOT NULL,
  "auditor" text,
  "call_duration" integer,
  "call_type" text,
  "protocol_score" numeric(5,2),
  "interpretation_score" numeric(5,2),
  "language_score" numeric(5,2),
  "service_score" numeric(5,2),
  "technical_score" numeric(5,2),
  "total_score" numeric(5,2),
  "critical_error" boolean DEFAULT false,
  "comentarios" text,
  "accion_requerida" text,
  "created_at" timestamp(6) with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."rbac_users" (
  "id" text NOT NULL,
  "email" text NOT NULL,
  "password" text NOT NULL,
  "name" text NOT NULL,
  "role" "RbacRole" DEFAULT 'INTERPRETER'::"RbacRole" NOT NULL,
  "createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."recruitment_access" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "application_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "invite_code" text,
  "expires_at" timestamp(6) with time zone NOT NULL,
  "last_used_at" timestamp(6) with time zone,
  "revoked_at" timestamp(6) with time zone,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."recruitment_applications" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "candidate_id" integer NOT NULL,
  "status" "RecruitmentApplicationStatus" DEFAULT 'APPLIED'::"RecruitmentApplicationStatus" NOT NULL,
  "current_step" "RecruitmentStep" DEFAULT 'APPLICATION'::"RecruitmentStep" NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "last_activity_at" timestamp(6) with time zone,
  "completed_at" timestamp(6) with time zone,
  "hired_interpreter_id" integer,
  "rejection_reason" text,
  "withdrawal_reason" text,
  "last_actor_id" text,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "currentStep" "RecruitmentStep" DEFAULT 'APPLICATION'::"RecruitmentStep" NOT NULL
);

CREATE TABLE IF NOT EXISTS public."recruitment_banking" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "application_id" text NOT NULL,
  "bank_name" text NOT NULL,
  "bank_account" text NOT NULL,
  "bank_account_type" text NOT NULL,
  "bank_cedula" text NOT NULL,
  "verified_at" timestamp(6) with time zone,
  "verified_by" text,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."recruitment_candidates" (
  "id" integer DEFAULT nextval('recruitment_candidates_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "telefono" text,
  "pais" text,
  "fuente" text,
  "english_level" text,
  "speedtest_mbps" integer,
  "status" text DEFAULT 'Aplicante'::text,
  "fecha_postulacion" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "fecha_entrevista" timestamp(6) with time zone,
  "result_roleplay" integer,
  "fecha_oferta" timestamp(6) with time zone,
  "fecha_inicio" timestamp(6) with time zone,
  "responsable" text,
  "notas" text,
  "created_at" timestamp(6) with time zone DEFAULT now(),
  "updated_at" timestamp(6) with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."recruitment_contracts" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "application_id" text NOT NULL,
  "status" "RecruitmentContractStatus" DEFAULT 'PENDING'::"RecruitmentContractStatus" NOT NULL,
  "document_path" text,
  "signed_at" timestamp(6) with time zone,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."recruitment_documents" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "application_id" text NOT NULL,
  "type" "RecruitmentDocumentType" NOT NULL,
  "storage_path" text NOT NULL,
  "mime_type" text NOT NULL,
  "size" integer NOT NULL,
  "status" "RecruitmentDocumentStatus" DEFAULT 'UPLOADED'::"RecruitmentDocumentStatus" NOT NULL,
  "reviewed_at" timestamp(6) with time zone,
  "reviewed_by" text,
  "rejection_reason" text,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."recruitment_events" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "application_id" text NOT NULL,
  "event_type" "RecruitmentEventType" NOT NULL,
  "from_status" "RecruitmentApplicationStatus",
  "to_status" "RecruitmentApplicationStatus" NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."recruitment_interviews" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "application_id" text NOT NULL,
  "scheduled_at" timestamp(6) with time zone,
  "status" "RecruitmentInterviewStatus" DEFAULT 'PENDING'::"RecruitmentInterviewStatus" NOT NULL,
  "meeting_url" text,
  "notes" text,
  "completed_at" timestamp(6) with time zone,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."recruitment_offers" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "application_id" text NOT NULL,
  "status" "RecruitmentOfferStatus" DEFAULT 'DRAFT'::"RecruitmentOfferStatus" NOT NULL,
  "sent_at" timestamp(6) with time zone,
  "accepted_at" timestamp(6) with time zone,
  "rejected_at" timestamp(6) with time zone,
  "expires_at" timestamp(6) with time zone,
  "terms_version" text,
  "document_path" text,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."recruitment_tech_setups" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "application_id" text NOT NULL,
  "hardware" jsonb,
  "connection_type" text,
  "ping" integer,
  "download" integer,
  "upload" integer,
  "jitter" integer,
  "packet_loss" double precision,
  "headset" boolean,
  "microphone" boolean,
  "browser" text,
  "softphone" text,
  "mock_call_completed" boolean DEFAULT false,
  "completed_at" timestamp(6) with time zone,
  "completed_by" text,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."recruitment_trainings" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "application_id" text NOT NULL,
  "blocks_completed" jsonb,
  "completed_at" timestamp(6) with time zone,
  "completed_by" text,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."roleplay_access" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "session_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "invite_code" text,
  "expires_at" timestamp(6) with time zone NOT NULL,
  "used_at" timestamp(6) with time zone,
  "validated_at" timestamp(6) with time zone,
  "started_at" timestamp(6) with time zone,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."roleplay_responses" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "scenario_id" text NOT NULL,
  "source_audio_url" text,
  "source_audio_path" text,
  "processed_audio_url" text,
  "processed_audio_path" text,
  "audio_status" "AudioStatus" DEFAULT 'UPLOADED'::"AudioStatus" NOT NULL,
  "processing_error" text,
  "duration_sec" integer,
  "self_score" jsonb,
  "self_notes" text,
  "submitted_at" timestamp(6) with time zone,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "selfScore" jsonb
);

CREATE TABLE IF NOT EXISTS public."roleplay_scenarios" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "session_id" text NOT NULL,
  "order" integer NOT NULL,
  "title" text NOT NULL,
  "base_audio_url" text NOT NULL,
  "duration_limit_sec" integer,
  "script_prompt" text,
  "expected_keys" text[] NOT NULL,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."roleplay_sessions" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "interpreter_id" integer,
  "recruitment_candidate_id" integer,
  "base_audio_url" text NOT NULL,
  "recorded_audio_url" text,
  "status" "RoleplayStatus" DEFAULT 'DRAFT'::"RoleplayStatus" NOT NULL,
  "evaluator_id" text,
  "qa_score_id" integer,
  "submitted_at" timestamp(6) with time zone,
  "evaluated_at" timestamp(6) with time zone,
  "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp(6) with time zone,
  "current_scenario_index" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "review_started_at" timestamp(6) with time zone,
  "review_priority" integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public."system_configs" (
  "id" integer DEFAULT nextval('system_configs_id_seq'::regclass) NOT NULL,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "description" text,
  "updated_at" timestamp(6) with time zone DEFAULT now(),
  "updated_by" text
);

CREATE TABLE IF NOT EXISTS public."user_profiles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "clerk_id" character varying(255),
  "email" character varying(255) NOT NULL,
  "display_name" character varying(255),
  "role" character varying(50) DEFAULT 'interpreter'::character varying NOT NULL,
  "interpreter_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "terms_accepted_at" timestamp with time zone,
  "signature_date" timestamp with time zone,
  "onboarding_complete" boolean DEFAULT false NOT NULL,
  "bank_name" text,
  "bank_account" text,
  "bank_cedula" text,
  "bank_account_type" text
);

CREATE TABLE IF NOT EXISTS public."vault_accounts" (
  "id" text NOT NULL,
  "platformName" text NOT NULL,
  "url" text,
  "vpnConfig" text,
  "credentials" text NOT NULL,
  "notes" text,
  "holderId" text NOT NULL,
  "interpreterId" text,
  "createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."vault_attachments" (
  "id" text NOT NULL,
  "fileName" text NOT NULL,
  "fileUrl" text NOT NULL,
  "fileSize" integer DEFAULT 0 NOT NULL,
  "mimeType" text DEFAULT 'application/octet-stream'::text NOT NULL,
  "accountId" text NOT NULL,
  "uploadedAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."vault_messages" (
  "id" text NOT NULL,
  "content" text NOT NULL,
  "status" "VaultMessageStatus" DEFAULT 'PENDING_ADMIN'::"VaultMessageStatus" NOT NULL,
  "authorId" text NOT NULL,
  "recipientId" text,
  "createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."accounts" ADD COLUMN IF NOT EXISTS "id" integer DEFAULT nextval('accounts_id_seq'::regclass);

ALTER TABLE public."accounts" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."accounts" ADD COLUMN IF NOT EXISTS "name" text;

ALTER TABLE public."accounts" ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE public."accounts" ADD COLUMN IF NOT EXISTS "description" text;

ALTER TABLE public."accounts" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."accounts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."call_sessions" ADD COLUMN IF NOT EXISTS "id" integer DEFAULT nextval('call_sessions_id_seq'::regclass);

ALTER TABLE public."call_sessions" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."call_sessions" ADD COLUMN IF NOT EXISTS "interpreter_id" integer;

ALTER TABLE public."call_sessions" ADD COLUMN IF NOT EXISTS "started_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."call_sessions" ADD COLUMN IF NOT EXISTS "ended_at" timestamp(6) with time zone;

ALTER TABLE public."call_sessions" ADD COLUMN IF NOT EXISTS "duration_seconds" integer;

ALTER TABLE public."call_sessions" ADD COLUMN IF NOT EXISTS "tariff_snapshot" numeric(10,2);

ALTER TABLE public."call_sessions" ALTER COLUMN "tariff_snapshot" SET NOT NULL;

ALTER TABLE public."call_sessions" ADD COLUMN IF NOT EXISTS "call_cost" numeric(10,2);

ALTER TABLE public."call_sessions" ADD COLUMN IF NOT EXISTS "notes" text;

ALTER TABLE public."call_sessions" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."call_sessions" ADD COLUMN IF NOT EXISTS "is_settled" boolean DEFAULT false;

ALTER TABLE public."call_sessions" ALTER COLUMN "is_settled" SET NOT NULL;

ALTER TABLE public."call_sessions" ADD COLUMN IF NOT EXISTS "payroll_record_id" text;

ALTER TABLE public."interpreter_account_rates" ADD COLUMN IF NOT EXISTS "id" integer DEFAULT nextval('interpreter_account_rates_id_seq'::regclass);

ALTER TABLE public."interpreter_account_rates" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."interpreter_account_rates" ADD COLUMN IF NOT EXISTS "interpreter_id" integer;

ALTER TABLE public."interpreter_account_rates" ADD COLUMN IF NOT EXISTS "account_id" integer;

ALTER TABLE public."interpreter_account_rates" ADD COLUMN IF NOT EXISTS "tariff_per_hour" numeric(10,2);

ALTER TABLE public."interpreter_account_rates" ALTER COLUMN "tariff_per_hour" SET NOT NULL;

ALTER TABLE public."interpreter_account_rates" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."interpreter_account_rates" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."interpreter_monthly_metrics" ADD COLUMN IF NOT EXISTS "id" integer DEFAULT nextval('interpreter_monthly_metrics_id_seq'::regclass);

ALTER TABLE public."interpreter_monthly_metrics" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."interpreter_monthly_metrics" ADD COLUMN IF NOT EXISTS "interpreter_id" integer;

ALTER TABLE public."interpreter_monthly_metrics" ALTER COLUMN "interpreter_id" SET NOT NULL;

ALTER TABLE public."interpreter_monthly_metrics" ADD COLUMN IF NOT EXISTS "period" text;

ALTER TABLE public."interpreter_monthly_metrics" ALTER COLUMN "period" SET NOT NULL;

ALTER TABLE public."interpreter_monthly_metrics" ADD COLUMN IF NOT EXISTS "interpreted_minutes" integer DEFAULT 0;

ALTER TABLE public."interpreter_monthly_metrics" ALTER COLUMN "interpreted_minutes" SET NOT NULL;

ALTER TABLE public."interpreter_monthly_metrics" ADD COLUMN IF NOT EXISTS "qa_score" numeric(5,2);

ALTER TABLE public."interpreter_monthly_metrics" ADD COLUMN IF NOT EXISTS "ranking_position" integer;

ALTER TABLE public."interpreter_monthly_metrics" ADD COLUMN IF NOT EXISTS "total_interpreters" integer;

ALTER TABLE public."interpreter_monthly_metrics" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."interpreter_monthly_metrics" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE public."interpreter_status_logs" ADD COLUMN IF NOT EXISTS "id" integer DEFAULT nextval('interpreter_status_logs_id_seq'::regclass);

ALTER TABLE public."interpreter_status_logs" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."interpreter_status_logs" ADD COLUMN IF NOT EXISTS "interpreter_id" integer;

ALTER TABLE public."interpreter_status_logs" ALTER COLUMN "interpreter_id" SET NOT NULL;

ALTER TABLE public."interpreter_status_logs" ADD COLUMN IF NOT EXISTS "previous_status" text;

ALTER TABLE public."interpreter_status_logs" ADD COLUMN IF NOT EXISTS "new_status" text;

ALTER TABLE public."interpreter_status_logs" ALTER COLUMN "new_status" SET NOT NULL;

ALTER TABLE public."interpreter_status_logs" ADD COLUMN IF NOT EXISTS "reason" text DEFAULT 'manual'::text;

ALTER TABLE public."interpreter_status_logs" ALTER COLUMN "reason" SET NOT NULL;

ALTER TABLE public."interpreter_status_logs" ADD COLUMN IF NOT EXISTS "changed_by" text;

ALTER TABLE public."interpreter_status_logs" ADD COLUMN IF NOT EXISTS "metadata" jsonb;

ALTER TABLE public."interpreter_status_logs" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."interpreter_status_logs" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "id" integer DEFAULT nextval('interpreters_id_seq'::regclass);

ALTER TABLE public."interpreters" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "external_id" character varying(255);

ALTER TABLE public."interpreters" ALTER COLUMN "external_id" SET NOT NULL;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "name" character varying(255);

ALTER TABLE public."interpreters" ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "status" character varying(50) DEFAULT 'Activo'::character varying;

ALTER TABLE public."interpreters" ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "realtime_status" character varying(50) DEFAULT 'Offline'::character varying;

ALTER TABLE public."interpreters" ALTER COLUMN "realtime_status" SET NOT NULL;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "language_a" character varying(50) DEFAULT 'Español'::character varying;

ALTER TABLE public."interpreters" ALTER COLUMN "language_a" SET NOT NULL;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "language_b" character varying(50) DEFAULT 'Inglés'::character varying;

ALTER TABLE public."interpreters" ALTER COLUMN "language_b" SET NOT NULL;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "email_corporativo" character varying(255);

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "telefono" character varying(30);

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "pais" character varying(100);

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "tariff_per_minute" numeric(10,4);

ALTER TABLE public."interpreters" ALTER COLUMN "tariff_per_minute" SET NOT NULL;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

ALTER TABLE public."interpreters" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

ALTER TABLE public."interpreters" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "status_reason" text DEFAULT 'initial'::text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "last_heartbeat" timestamp(6) with time zone;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "last_activity" timestamp(6) with time zone;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "last_online_at" timestamp(6) with time zone;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "last_offline_at" timestamp(6) with time zone;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "status_changed_at" timestamp(6) with time zone;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "browser_tab_id" text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "client_ip" text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "campaign" text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "metodo_pago" text DEFAULT 'Transferencia Bancaria'::text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "cuenta_pago" text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "documentos_completo" boolean DEFAULT false;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "notas" text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "banco" text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "tipo_cuenta" text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "cedula_rnc" text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "monthly_goal" integer DEFAULT 2000;

ALTER TABLE public."interpreters" ALTER COLUMN "monthly_goal" SET NOT NULL;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "payment_frequency" text DEFAULT 'Monthly'::text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "payment_day" text DEFAULT '1'::text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "shift_start" text DEFAULT '09:00'::text;

ALTER TABLE public."interpreters" ADD COLUMN IF NOT EXISTS "shift_end" text DEFAULT '17:00'::text;

ALTER TABLE public."messages" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."messages" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."messages" ADD COLUMN IF NOT EXISTS "sender_id" uuid;

ALTER TABLE public."messages" ALTER COLUMN "sender_id" SET NOT NULL;

ALTER TABLE public."messages" ADD COLUMN IF NOT EXISTS "receiver_id" uuid;

ALTER TABLE public."messages" ALTER COLUMN "receiver_id" SET NOT NULL;

ALTER TABLE public."messages" ADD COLUMN IF NOT EXISTS "content" text;

ALTER TABLE public."messages" ALTER COLUMN "content" SET NOT NULL;

ALTER TABLE public."messages" ADD COLUMN IF NOT EXISTS "is_read" boolean DEFAULT false;

ALTER TABLE public."messages" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."notifications" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "userid" character varying(255);

ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "title" character varying(500);

ALTER TABLE public."notifications" ALTER COLUMN "title" SET NOT NULL;

ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "message" text;

ALTER TABLE public."notifications" ALTER COLUMN "message" SET NOT NULL;

ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "type" character varying(50) DEFAULT 'info'::character varying;

ALTER TABLE public."notifications" ALTER COLUMN "type" SET NOT NULL;

ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "category" character varying(50) DEFAULT 'system'::character varying;

ALTER TABLE public."notifications" ALTER COLUMN "category" SET NOT NULL;

ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "is_read" boolean DEFAULT false;

ALTER TABLE public."notifications" ALTER COLUMN "is_read" SET NOT NULL;

ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "link" character varying(500);

ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "createdat" timestamp with time zone DEFAULT now();

ALTER TABLE public."notifications" ALTER COLUMN "createdat" SET NOT NULL;

ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "user_id" uuid;

ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."password_reset_tokens" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."password_reset_tokens" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."password_reset_tokens" ADD COLUMN IF NOT EXISTS "email" text;

ALTER TABLE public."password_reset_tokens" ALTER COLUMN "email" SET NOT NULL;

ALTER TABLE public."password_reset_tokens" ADD COLUMN IF NOT EXISTS "token" text;

ALTER TABLE public."password_reset_tokens" ALTER COLUMN "token" SET NOT NULL;

ALTER TABLE public."password_reset_tokens" ADD COLUMN IF NOT EXISTS "expires" timestamp(6) with time zone;

ALTER TABLE public."password_reset_tokens" ALTER COLUMN "expires" SET NOT NULL;

ALTER TABLE public."password_reset_tokens" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."password_reset_tokens" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."password_reset_tokens" ADD COLUMN IF NOT EXISTS "createdAt" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."password_reset_tokens" ALTER COLUMN "createdAt" SET NOT NULL;

ALTER TABLE public."payrate_audit_log" ADD COLUMN IF NOT EXISTS "id" integer DEFAULT nextval('payrate_audit_log_id_seq'::regclass);

ALTER TABLE public."payrate_audit_log" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."payrate_audit_log" ADD COLUMN IF NOT EXISTS "interpreter_id" integer;

ALTER TABLE public."payrate_audit_log" ADD COLUMN IF NOT EXISTS "old_rate" numeric(10,2);

ALTER TABLE public."payrate_audit_log" ADD COLUMN IF NOT EXISTS "new_rate" numeric(10,2);

ALTER TABLE public."payrate_audit_log" ALTER COLUMN "new_rate" SET NOT NULL;

ALTER TABLE public."payrate_audit_log" ADD COLUMN IF NOT EXISTS "changed_by" text;

ALTER TABLE public."payrate_audit_log" ALTER COLUMN "changed_by" SET NOT NULL;

ALTER TABLE public."payrate_audit_log" ADD COLUMN IF NOT EXISTS "changed_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."payrate_audit_log" ADD COLUMN IF NOT EXISTS "details" text;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."payroll_records" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "period_start" date;

ALTER TABLE public."payroll_records" ALTER COLUMN "period_start" SET NOT NULL;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "period_end" date;

ALTER TABLE public."payroll_records" ALTER COLUMN "period_end" SET NOT NULL;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "interpreter_id" integer;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "total_minutes" integer;

ALTER TABLE public."payroll_records" ALTER COLUMN "total_minutes" SET NOT NULL;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "gross_total" numeric(10,2);

ALTER TABLE public."payroll_records" ALTER COLUMN "gross_total" SET NOT NULL;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "quality_bonus" numeric(10,2) DEFAULT 0;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "penalidades" numeric(10,2) DEFAULT 0;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "transfer_deduction" numeric(10,2) DEFAULT 0;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "net_total" numeric(10,2);

ALTER TABLE public."payroll_records" ALTER COLUMN "net_total" SET NOT NULL;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'Pendiente'::text;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "payment_date" timestamp(6) with time zone;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "verified_minutes" integer;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "incentives_total" numeric(10,2) DEFAULT 0;

ALTER TABLE public."payroll_records" ALTER COLUMN "incentives_total" SET NOT NULL;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "paid_at" timestamp(6) with time zone;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "transaction_reference" text;

ALTER TABLE public."payroll_records" ADD COLUMN IF NOT EXISTS "reconciliation_hash" text;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "id" integer DEFAULT nextval('production_logs_id_seq'::regclass);

ALTER TABLE public."production_logs" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "interpreter_id" integer;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "account_id" integer;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "date" date;

ALTER TABLE public."production_logs" ALTER COLUMN "date" SET NOT NULL;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "campaign" text;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "scheduled_hours" text;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "login_time" timestamp(6) with time zone;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "logout_time" timestamp(6) with time zone;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "connected_hours" numeric(10,2);

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "interpreted_minutes" integer DEFAULT 0;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "calls_attended" integer DEFAULT 0;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "adherence" numeric(5,2);

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "status" text;

ALTER TABLE public."production_logs" ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "observaciones" text;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "verified_minutes" integer;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "is_settled" boolean DEFAULT false;

ALTER TABLE public."production_logs" ALTER COLUMN "is_settled" SET NOT NULL;

ALTER TABLE public."production_logs" ADD COLUMN IF NOT EXISTS "payroll_record_id" text;

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "id" integer DEFAULT nextval('qa_scores_id_seq'::regclass);

ALTER TABLE public."qa_scores" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "production_log_id" integer;

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "interpreter_id" integer;

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "audit_date" timestamp(6) with time zone;

ALTER TABLE public."qa_scores" ALTER COLUMN "audit_date" SET NOT NULL;

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "auditor" text;

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "call_duration" integer;

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "call_type" text;

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "protocol_score" numeric(5,2);

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "interpretation_score" numeric(5,2);

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "language_score" numeric(5,2);

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "service_score" numeric(5,2);

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "technical_score" numeric(5,2);

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "total_score" numeric(5,2);

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "critical_error" boolean DEFAULT false;

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "comentarios" text;

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "accion_requerida" text;

ALTER TABLE public."qa_scores" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."rbac_users" ADD COLUMN IF NOT EXISTS "id" text;

ALTER TABLE public."rbac_users" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."rbac_users" ADD COLUMN IF NOT EXISTS "email" text;

ALTER TABLE public."rbac_users" ALTER COLUMN "email" SET NOT NULL;

ALTER TABLE public."rbac_users" ADD COLUMN IF NOT EXISTS "password" text;

ALTER TABLE public."rbac_users" ALTER COLUMN "password" SET NOT NULL;

ALTER TABLE public."rbac_users" ADD COLUMN IF NOT EXISTS "name" text;

ALTER TABLE public."rbac_users" ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE public."rbac_users" ADD COLUMN IF NOT EXISTS "role" "RbacRole" DEFAULT 'INTERPRETER'::"RbacRole";

ALTER TABLE public."rbac_users" ALTER COLUMN "role" SET NOT NULL;

ALTER TABLE public."rbac_users" ADD COLUMN IF NOT EXISTS "createdAt" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."rbac_users" ALTER COLUMN "createdAt" SET NOT NULL;

ALTER TABLE public."rbac_users" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."rbac_users" ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE public."recruitment_access" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."recruitment_access" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."recruitment_access" ADD COLUMN IF NOT EXISTS "application_id" text;

ALTER TABLE public."recruitment_access" ALTER COLUMN "application_id" SET NOT NULL;

ALTER TABLE public."recruitment_access" ADD COLUMN IF NOT EXISTS "token_hash" text;

ALTER TABLE public."recruitment_access" ALTER COLUMN "token_hash" SET NOT NULL;

ALTER TABLE public."recruitment_access" ADD COLUMN IF NOT EXISTS "invite_code" text;

ALTER TABLE public."recruitment_access" ADD COLUMN IF NOT EXISTS "expires_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_access" ALTER COLUMN "expires_at" SET NOT NULL;

ALTER TABLE public."recruitment_access" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_access" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_access" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_access" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."recruitment_applications" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "candidate_id" integer;

ALTER TABLE public."recruitment_applications" ALTER COLUMN "candidate_id" SET NOT NULL;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "status" "RecruitmentApplicationStatus" DEFAULT 'APPLIED'::"RecruitmentApplicationStatus";

ALTER TABLE public."recruitment_applications" ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "current_step" "RecruitmentStep" DEFAULT 'APPLICATION'::"RecruitmentStep";

ALTER TABLE public."recruitment_applications" ALTER COLUMN "current_step" SET NOT NULL;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 0;

ALTER TABLE public."recruitment_applications" ALTER COLUMN "version" SET NOT NULL;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "started_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_applications" ALTER COLUMN "started_at" SET NOT NULL;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "completed_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "hired_interpreter_id" integer;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "rejection_reason" text;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "withdrawal_reason" text;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "last_actor_id" text;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_applications" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_applications" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE public."recruitment_applications" ADD COLUMN IF NOT EXISTS "currentStep" "RecruitmentStep" DEFAULT 'APPLICATION'::"RecruitmentStep";

ALTER TABLE public."recruitment_applications" ALTER COLUMN "currentStep" SET NOT NULL;

ALTER TABLE public."recruitment_banking" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."recruitment_banking" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."recruitment_banking" ADD COLUMN IF NOT EXISTS "application_id" text;

ALTER TABLE public."recruitment_banking" ALTER COLUMN "application_id" SET NOT NULL;

ALTER TABLE public."recruitment_banking" ADD COLUMN IF NOT EXISTS "bank_name" text;

ALTER TABLE public."recruitment_banking" ALTER COLUMN "bank_name" SET NOT NULL;

ALTER TABLE public."recruitment_banking" ADD COLUMN IF NOT EXISTS "bank_account" text;

ALTER TABLE public."recruitment_banking" ALTER COLUMN "bank_account" SET NOT NULL;

ALTER TABLE public."recruitment_banking" ADD COLUMN IF NOT EXISTS "bank_account_type" text;

ALTER TABLE public."recruitment_banking" ALTER COLUMN "bank_account_type" SET NOT NULL;

ALTER TABLE public."recruitment_banking" ADD COLUMN IF NOT EXISTS "bank_cedula" text;

ALTER TABLE public."recruitment_banking" ALTER COLUMN "bank_cedula" SET NOT NULL;

ALTER TABLE public."recruitment_banking" ADD COLUMN IF NOT EXISTS "verified_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_banking" ADD COLUMN IF NOT EXISTS "verified_by" text;

ALTER TABLE public."recruitment_banking" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_banking" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."recruitment_banking" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_banking" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "id" integer DEFAULT nextval('recruitment_candidates_id_seq'::regclass);

ALTER TABLE public."recruitment_candidates" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "name" text;

ALTER TABLE public."recruitment_candidates" ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "email" text;

ALTER TABLE public."recruitment_candidates" ALTER COLUMN "email" SET NOT NULL;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "telefono" text;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "pais" text;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "fuente" text;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "english_level" text;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "speedtest_mbps" integer;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'Aplicante'::text;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "fecha_postulacion" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_candidates" ALTER COLUMN "fecha_postulacion" SET NOT NULL;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "fecha_entrevista" timestamp(6) with time zone;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "result_roleplay" integer;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "fecha_oferta" timestamp(6) with time zone;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "fecha_inicio" timestamp(6) with time zone;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "responsable" text;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "notas" text;

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_candidates" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_contracts" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."recruitment_contracts" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."recruitment_contracts" ADD COLUMN IF NOT EXISTS "application_id" text;

ALTER TABLE public."recruitment_contracts" ALTER COLUMN "application_id" SET NOT NULL;

ALTER TABLE public."recruitment_contracts" ADD COLUMN IF NOT EXISTS "status" "RecruitmentContractStatus" DEFAULT 'PENDING'::"RecruitmentContractStatus";

ALTER TABLE public."recruitment_contracts" ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE public."recruitment_contracts" ADD COLUMN IF NOT EXISTS "document_path" text;

ALTER TABLE public."recruitment_contracts" ADD COLUMN IF NOT EXISTS "signed_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_contracts" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_contracts" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."recruitment_contracts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_contracts" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE public."recruitment_documents" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."recruitment_documents" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."recruitment_documents" ADD COLUMN IF NOT EXISTS "application_id" text;

ALTER TABLE public."recruitment_documents" ALTER COLUMN "application_id" SET NOT NULL;

ALTER TABLE public."recruitment_documents" ADD COLUMN IF NOT EXISTS "type" "RecruitmentDocumentType";

ALTER TABLE public."recruitment_documents" ALTER COLUMN "type" SET NOT NULL;

ALTER TABLE public."recruitment_documents" ADD COLUMN IF NOT EXISTS "storage_path" text;

ALTER TABLE public."recruitment_documents" ALTER COLUMN "storage_path" SET NOT NULL;

ALTER TABLE public."recruitment_documents" ADD COLUMN IF NOT EXISTS "mime_type" text;

ALTER TABLE public."recruitment_documents" ALTER COLUMN "mime_type" SET NOT NULL;

ALTER TABLE public."recruitment_documents" ADD COLUMN IF NOT EXISTS "size" integer;

ALTER TABLE public."recruitment_documents" ALTER COLUMN "size" SET NOT NULL;

ALTER TABLE public."recruitment_documents" ADD COLUMN IF NOT EXISTS "status" "RecruitmentDocumentStatus" DEFAULT 'UPLOADED'::"RecruitmentDocumentStatus";

ALTER TABLE public."recruitment_documents" ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE public."recruitment_documents" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_documents" ADD COLUMN IF NOT EXISTS "reviewed_by" text;

ALTER TABLE public."recruitment_documents" ADD COLUMN IF NOT EXISTS "rejection_reason" text;

ALTER TABLE public."recruitment_documents" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_documents" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."recruitment_documents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_documents" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE public."recruitment_events" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."recruitment_events" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."recruitment_events" ADD COLUMN IF NOT EXISTS "application_id" text;

ALTER TABLE public."recruitment_events" ALTER COLUMN "application_id" SET NOT NULL;

ALTER TABLE public."recruitment_events" ADD COLUMN IF NOT EXISTS "event_type" "RecruitmentEventType";

ALTER TABLE public."recruitment_events" ALTER COLUMN "event_type" SET NOT NULL;

ALTER TABLE public."recruitment_events" ADD COLUMN IF NOT EXISTS "from_status" "RecruitmentApplicationStatus";

ALTER TABLE public."recruitment_events" ADD COLUMN IF NOT EXISTS "to_status" "RecruitmentApplicationStatus";

ALTER TABLE public."recruitment_events" ALTER COLUMN "to_status" SET NOT NULL;

ALTER TABLE public."recruitment_events" ADD COLUMN IF NOT EXISTS "actor_type" text;

ALTER TABLE public."recruitment_events" ALTER COLUMN "actor_type" SET NOT NULL;

ALTER TABLE public."recruitment_events" ADD COLUMN IF NOT EXISTS "actor_id" text;

ALTER TABLE public."recruitment_events" ALTER COLUMN "actor_id" SET NOT NULL;

ALTER TABLE public."recruitment_events" ADD COLUMN IF NOT EXISTS "metadata" jsonb;

ALTER TABLE public."recruitment_events" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_events" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."recruitment_interviews" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."recruitment_interviews" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."recruitment_interviews" ADD COLUMN IF NOT EXISTS "application_id" text;

ALTER TABLE public."recruitment_interviews" ALTER COLUMN "application_id" SET NOT NULL;

ALTER TABLE public."recruitment_interviews" ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_interviews" ADD COLUMN IF NOT EXISTS "status" "RecruitmentInterviewStatus" DEFAULT 'PENDING'::"RecruitmentInterviewStatus";

ALTER TABLE public."recruitment_interviews" ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE public."recruitment_interviews" ADD COLUMN IF NOT EXISTS "meeting_url" text;

ALTER TABLE public."recruitment_interviews" ADD COLUMN IF NOT EXISTS "notes" text;

ALTER TABLE public."recruitment_interviews" ADD COLUMN IF NOT EXISTS "completed_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_interviews" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_interviews" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."recruitment_interviews" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_interviews" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE public."recruitment_offers" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."recruitment_offers" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."recruitment_offers" ADD COLUMN IF NOT EXISTS "application_id" text;

ALTER TABLE public."recruitment_offers" ALTER COLUMN "application_id" SET NOT NULL;

ALTER TABLE public."recruitment_offers" ADD COLUMN IF NOT EXISTS "status" "RecruitmentOfferStatus" DEFAULT 'DRAFT'::"RecruitmentOfferStatus";

ALTER TABLE public."recruitment_offers" ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE public."recruitment_offers" ADD COLUMN IF NOT EXISTS "sent_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_offers" ADD COLUMN IF NOT EXISTS "accepted_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_offers" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_offers" ADD COLUMN IF NOT EXISTS "expires_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_offers" ADD COLUMN IF NOT EXISTS "terms_version" text;

ALTER TABLE public."recruitment_offers" ADD COLUMN IF NOT EXISTS "document_path" text;

ALTER TABLE public."recruitment_offers" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_offers" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."recruitment_offers" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_offers" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."recruitment_tech_setups" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "application_id" text;

ALTER TABLE public."recruitment_tech_setups" ALTER COLUMN "application_id" SET NOT NULL;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "hardware" jsonb;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "connection_type" text;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "ping" integer;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "download" integer;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "upload" integer;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "jitter" integer;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "packet_loss" double precision;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "headset" boolean;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "microphone" boolean;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "browser" text;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "softphone" text;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "mock_call_completed" boolean DEFAULT false;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "completed_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "completed_by" text;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_tech_setups" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."recruitment_tech_setups" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_tech_setups" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE public."recruitment_trainings" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."recruitment_trainings" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."recruitment_trainings" ADD COLUMN IF NOT EXISTS "application_id" text;

ALTER TABLE public."recruitment_trainings" ALTER COLUMN "application_id" SET NOT NULL;

ALTER TABLE public."recruitment_trainings" ADD COLUMN IF NOT EXISTS "blocks_completed" jsonb;

ALTER TABLE public."recruitment_trainings" ADD COLUMN IF NOT EXISTS "completed_at" timestamp(6) with time zone;

ALTER TABLE public."recruitment_trainings" ADD COLUMN IF NOT EXISTS "completed_by" text;

ALTER TABLE public."recruitment_trainings" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_trainings" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."recruitment_trainings" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."recruitment_trainings" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE public."roleplay_access" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."roleplay_access" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."roleplay_access" ADD COLUMN IF NOT EXISTS "session_id" text;

ALTER TABLE public."roleplay_access" ALTER COLUMN "session_id" SET NOT NULL;

ALTER TABLE public."roleplay_access" ADD COLUMN IF NOT EXISTS "token_hash" text;

ALTER TABLE public."roleplay_access" ALTER COLUMN "token_hash" SET NOT NULL;

ALTER TABLE public."roleplay_access" ADD COLUMN IF NOT EXISTS "invite_code" text;

ALTER TABLE public."roleplay_access" ADD COLUMN IF NOT EXISTS "expires_at" timestamp(6) with time zone;

ALTER TABLE public."roleplay_access" ALTER COLUMN "expires_at" SET NOT NULL;

ALTER TABLE public."roleplay_access" ADD COLUMN IF NOT EXISTS "used_at" timestamp(6) with time zone;

ALTER TABLE public."roleplay_access" ADD COLUMN IF NOT EXISTS "validated_at" timestamp(6) with time zone;

ALTER TABLE public."roleplay_access" ADD COLUMN IF NOT EXISTS "started_at" timestamp(6) with time zone;

ALTER TABLE public."roleplay_access" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."roleplay_access" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."roleplay_responses" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "scenario_id" text;

ALTER TABLE public."roleplay_responses" ALTER COLUMN "scenario_id" SET NOT NULL;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "source_audio_url" text;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "source_audio_path" text;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "processed_audio_url" text;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "processed_audio_path" text;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "audio_status" "AudioStatus" DEFAULT 'UPLOADED'::"AudioStatus";

ALTER TABLE public."roleplay_responses" ALTER COLUMN "audio_status" SET NOT NULL;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "processing_error" text;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "duration_sec" integer;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "self_score" jsonb;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "self_notes" text;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp(6) with time zone;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."roleplay_responses" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."roleplay_responses" ADD COLUMN IF NOT EXISTS "selfScore" jsonb;

ALTER TABLE public."roleplay_scenarios" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."roleplay_scenarios" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."roleplay_scenarios" ADD COLUMN IF NOT EXISTS "session_id" text;

ALTER TABLE public."roleplay_scenarios" ALTER COLUMN "session_id" SET NOT NULL;

ALTER TABLE public."roleplay_scenarios" ADD COLUMN IF NOT EXISTS "order" integer;

ALTER TABLE public."roleplay_scenarios" ALTER COLUMN "order" SET NOT NULL;

ALTER TABLE public."roleplay_scenarios" ADD COLUMN IF NOT EXISTS "title" text;

ALTER TABLE public."roleplay_scenarios" ALTER COLUMN "title" SET NOT NULL;

ALTER TABLE public."roleplay_scenarios" ADD COLUMN IF NOT EXISTS "base_audio_url" text;

ALTER TABLE public."roleplay_scenarios" ALTER COLUMN "base_audio_url" SET NOT NULL;

ALTER TABLE public."roleplay_scenarios" ADD COLUMN IF NOT EXISTS "duration_limit_sec" integer;

ALTER TABLE public."roleplay_scenarios" ADD COLUMN IF NOT EXISTS "script_prompt" text;

ALTER TABLE public."roleplay_scenarios" ADD COLUMN IF NOT EXISTS "expected_keys" text[];

ALTER TABLE public."roleplay_scenarios" ALTER COLUMN "expected_keys" SET NOT NULL;

ALTER TABLE public."roleplay_scenarios" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."roleplay_scenarios" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "id" text DEFAULT (gen_random_uuid())::text;

ALTER TABLE public."roleplay_sessions" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "interpreter_id" integer;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "recruitment_candidate_id" integer;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "base_audio_url" text;

ALTER TABLE public."roleplay_sessions" ALTER COLUMN "base_audio_url" SET NOT NULL;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "recorded_audio_url" text;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "status" "RoleplayStatus" DEFAULT 'DRAFT'::"RoleplayStatus";

ALTER TABLE public."roleplay_sessions" ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "evaluator_id" text;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "qa_score_id" integer;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp(6) with time zone;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "evaluated_at" timestamp(6) with time zone;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "created_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."roleplay_sessions" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "completed_at" timestamp(6) with time zone;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "current_scenario_index" integer DEFAULT 0;

ALTER TABLE public."roleplay_sessions" ALTER COLUMN "current_scenario_index" SET NOT NULL;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."roleplay_sessions" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "review_started_at" timestamp(6) with time zone;

ALTER TABLE public."roleplay_sessions" ADD COLUMN IF NOT EXISTS "review_priority" integer DEFAULT 0;

ALTER TABLE public."system_configs" ADD COLUMN IF NOT EXISTS "id" integer DEFAULT nextval('system_configs_id_seq'::regclass);

ALTER TABLE public."system_configs" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."system_configs" ADD COLUMN IF NOT EXISTS "key" text;

ALTER TABLE public."system_configs" ALTER COLUMN "key" SET NOT NULL;

ALTER TABLE public."system_configs" ADD COLUMN IF NOT EXISTS "value" text;

ALTER TABLE public."system_configs" ALTER COLUMN "value" SET NOT NULL;

ALTER TABLE public."system_configs" ADD COLUMN IF NOT EXISTS "description" text;

ALTER TABLE public."system_configs" ADD COLUMN IF NOT EXISTS "updated_at" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."system_configs" ADD COLUMN IF NOT EXISTS "updated_by" text;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();

ALTER TABLE public."user_profiles" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "clerk_id" character varying(255);

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "email" character varying(255);

ALTER TABLE public."user_profiles" ALTER COLUMN "email" SET NOT NULL;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "display_name" character varying(255);

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "role" character varying(50) DEFAULT 'interpreter'::character varying;

ALTER TABLE public."user_profiles" ALTER COLUMN "role" SET NOT NULL;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "interpreter_id" integer;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

ALTER TABLE public."user_profiles" ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

ALTER TABLE public."user_profiles" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp with time zone;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "signature_date" timestamp with time zone;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "onboarding_complete" boolean DEFAULT false;

ALTER TABLE public."user_profiles" ALTER COLUMN "onboarding_complete" SET NOT NULL;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "bank_name" text;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "bank_account" text;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "bank_cedula" text;

ALTER TABLE public."user_profiles" ADD COLUMN IF NOT EXISTS "bank_account_type" text;

ALTER TABLE public."vault_accounts" ADD COLUMN IF NOT EXISTS "id" text;

ALTER TABLE public."vault_accounts" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."vault_accounts" ADD COLUMN IF NOT EXISTS "platformName" text;

ALTER TABLE public."vault_accounts" ALTER COLUMN "platformName" SET NOT NULL;

ALTER TABLE public."vault_accounts" ADD COLUMN IF NOT EXISTS "url" text;

ALTER TABLE public."vault_accounts" ADD COLUMN IF NOT EXISTS "vpnConfig" text;

ALTER TABLE public."vault_accounts" ADD COLUMN IF NOT EXISTS "credentials" text;

ALTER TABLE public."vault_accounts" ALTER COLUMN "credentials" SET NOT NULL;

ALTER TABLE public."vault_accounts" ADD COLUMN IF NOT EXISTS "notes" text;

ALTER TABLE public."vault_accounts" ADD COLUMN IF NOT EXISTS "holderId" text;

ALTER TABLE public."vault_accounts" ALTER COLUMN "holderId" SET NOT NULL;

ALTER TABLE public."vault_accounts" ADD COLUMN IF NOT EXISTS "interpreterId" text;

ALTER TABLE public."vault_accounts" ADD COLUMN IF NOT EXISTS "createdAt" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."vault_accounts" ALTER COLUMN "createdAt" SET NOT NULL;

ALTER TABLE public."vault_accounts" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."vault_accounts" ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE public."vault_attachments" ADD COLUMN IF NOT EXISTS "id" text;

ALTER TABLE public."vault_attachments" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."vault_attachments" ADD COLUMN IF NOT EXISTS "fileName" text;

ALTER TABLE public."vault_attachments" ALTER COLUMN "fileName" SET NOT NULL;

ALTER TABLE public."vault_attachments" ADD COLUMN IF NOT EXISTS "fileUrl" text;

ALTER TABLE public."vault_attachments" ALTER COLUMN "fileUrl" SET NOT NULL;

ALTER TABLE public."vault_attachments" ADD COLUMN IF NOT EXISTS "fileSize" integer DEFAULT 0;

ALTER TABLE public."vault_attachments" ALTER COLUMN "fileSize" SET NOT NULL;

ALTER TABLE public."vault_attachments" ADD COLUMN IF NOT EXISTS "mimeType" text DEFAULT 'application/octet-stream'::text;

ALTER TABLE public."vault_attachments" ALTER COLUMN "mimeType" SET NOT NULL;

ALTER TABLE public."vault_attachments" ADD COLUMN IF NOT EXISTS "accountId" text;

ALTER TABLE public."vault_attachments" ALTER COLUMN "accountId" SET NOT NULL;

ALTER TABLE public."vault_attachments" ADD COLUMN IF NOT EXISTS "uploadedAt" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."vault_attachments" ALTER COLUMN "uploadedAt" SET NOT NULL;

ALTER TABLE public."vault_messages" ADD COLUMN IF NOT EXISTS "id" text;

ALTER TABLE public."vault_messages" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE public."vault_messages" ADD COLUMN IF NOT EXISTS "content" text;

ALTER TABLE public."vault_messages" ALTER COLUMN "content" SET NOT NULL;

ALTER TABLE public."vault_messages" ADD COLUMN IF NOT EXISTS "status" "VaultMessageStatus" DEFAULT 'PENDING_ADMIN'::"VaultMessageStatus";

ALTER TABLE public."vault_messages" ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE public."vault_messages" ADD COLUMN IF NOT EXISTS "authorId" text;

ALTER TABLE public."vault_messages" ALTER COLUMN "authorId" SET NOT NULL;

ALTER TABLE public."vault_messages" ADD COLUMN IF NOT EXISTS "recipientId" text;

ALTER TABLE public."vault_messages" ADD COLUMN IF NOT EXISTS "createdAt" timestamp(6) with time zone DEFAULT now();

ALTER TABLE public."vault_messages" ALTER COLUMN "createdAt" SET NOT NULL;

ALTER TABLE IF EXISTS public.user_profiles ALTER COLUMN clerk_id DROP NOT NULL;

ALTER TABLE IF EXISTS public.notifications ALTER COLUMN userid DROP NOT NULL;

ALTER TABLE IF EXISTS public.notifications ALTER COLUMN id TYPE TEXT USING id::TEXT;

ALTER TABLE IF EXISTS public.notifications ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='accounts' AND con.conname='accounts_name_key') THEN ALTER TABLE public."accounts" ADD CONSTRAINT "accounts_name_key" UNIQUE (name); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='accounts' AND con.conname='accounts_pkey') THEN ALTER TABLE public."accounts" ADD CONSTRAINT "accounts_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='call_sessions' AND con.conname='call_sessions_interpreter_id_fkey') THEN ALTER TABLE public."call_sessions" ADD CONSTRAINT "call_sessions_interpreter_id_fkey" FOREIGN KEY (interpreter_id) REFERENCES interpreters(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='call_sessions' AND con.conname='call_sessions_payroll_record_id_fkey') THEN ALTER TABLE public."call_sessions" ADD CONSTRAINT "call_sessions_payroll_record_id_fkey" FOREIGN KEY (payroll_record_id) REFERENCES payroll_records(id) ON DELETE SET NULL; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='call_sessions' AND con.conname='call_sessions_pkey') THEN ALTER TABLE public."call_sessions" ADD CONSTRAINT "call_sessions_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreter_account_rates' AND con.conname='interpreter_account_rates_account_id_fkey') THEN ALTER TABLE public."interpreter_account_rates" ADD CONSTRAINT "interpreter_account_rates_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreter_account_rates' AND con.conname='interpreter_account_rates_interpreter_account_key') THEN ALTER TABLE public."interpreter_account_rates" ADD CONSTRAINT "interpreter_account_rates_interpreter_account_key" UNIQUE (interpreter_id, account_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreter_account_rates' AND con.conname='interpreter_account_rates_interpreter_id_fkey') THEN ALTER TABLE public."interpreter_account_rates" ADD CONSTRAINT "interpreter_account_rates_interpreter_id_fkey" FOREIGN KEY (interpreter_id) REFERENCES interpreters(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreter_account_rates' AND con.conname='interpreter_account_rates_pkey') THEN ALTER TABLE public."interpreter_account_rates" ADD CONSTRAINT "interpreter_account_rates_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreter_monthly_metrics' AND con.conname='interpreter_monthly_metrics_interpreter_id_fkey') THEN ALTER TABLE public."interpreter_monthly_metrics" ADD CONSTRAINT "interpreter_monthly_metrics_interpreter_id_fkey" FOREIGN KEY (interpreter_id) REFERENCES interpreters(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreter_monthly_metrics' AND con.conname='interpreter_monthly_metrics_pkey') THEN ALTER TABLE public."interpreter_monthly_metrics" ADD CONSTRAINT "interpreter_monthly_metrics_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreter_monthly_metrics' AND con.conname='unique_interpreter_monthly_metrics') THEN ALTER TABLE public."interpreter_monthly_metrics" ADD CONSTRAINT "unique_interpreter_monthly_metrics" UNIQUE (interpreter_id, period); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreter_status_logs' AND con.conname='interpreter_status_logs_interpreter_id_fkey') THEN ALTER TABLE public."interpreter_status_logs" ADD CONSTRAINT "interpreter_status_logs_interpreter_id_fkey" FOREIGN KEY (interpreter_id) REFERENCES interpreters(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreter_status_logs' AND con.conname='interpreter_status_logs_pkey') THEN ALTER TABLE public."interpreter_status_logs" ADD CONSTRAINT "interpreter_status_logs_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreters' AND con.conname='interpreters_email_corporativo_key') THEN ALTER TABLE public."interpreters" ADD CONSTRAINT "interpreters_email_corporativo_key" UNIQUE (email_corporativo); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreters' AND con.conname='interpreters_external_id_key') THEN ALTER TABLE public."interpreters" ADD CONSTRAINT "interpreters_external_id_key" UNIQUE (external_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreters' AND con.conname='interpreters_pkey') THEN ALTER TABLE public."interpreters" ADD CONSTRAINT "interpreters_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='interpreters' AND con.conname='interpreters_tariff_per_minute_check') THEN ALTER TABLE public."interpreters" ADD CONSTRAINT "interpreters_tariff_per_minute_check" CHECK (tariff_per_minute >= 0::numeric); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='messages' AND con.conname='messages_pkey') THEN ALTER TABLE public."messages" ADD CONSTRAINT "messages_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='notifications' AND con.conname='notifications_pkey') THEN ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='password_reset_tokens' AND con.conname='password_reset_tokens_pkey') THEN ALTER TABLE public."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='password_reset_tokens' AND con.conname='password_reset_tokens_token_key') THEN ALTER TABLE public."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_token_key" UNIQUE (token); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='payrate_audit_log' AND con.conname='payrate_audit_log_interpreter_id_fkey') THEN ALTER TABLE public."payrate_audit_log" ADD CONSTRAINT "payrate_audit_log_interpreter_id_fkey" FOREIGN KEY (interpreter_id) REFERENCES interpreters(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='payrate_audit_log' AND con.conname='payrate_audit_log_pkey') THEN ALTER TABLE public."payrate_audit_log" ADD CONSTRAINT "payrate_audit_log_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='payroll_records' AND con.conname='payroll_records_interpreter_id_fkey') THEN ALTER TABLE public."payroll_records" ADD CONSTRAINT "payroll_records_interpreter_id_fkey" FOREIGN KEY (interpreter_id) REFERENCES interpreters(id) ON DELETE RESTRICT; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='payroll_records' AND con.conname='payroll_records_period_check') THEN ALTER TABLE public."payroll_records" ADD CONSTRAINT "payroll_records_period_check" CHECK (period_end >= period_start); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='payroll_records' AND con.conname='payroll_records_pkey') THEN ALTER TABLE public."payroll_records" ADD CONSTRAINT "payroll_records_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='payroll_records' AND con.conname='payroll_records_reconciliation_hash_key') THEN ALTER TABLE public."payroll_records" ADD CONSTRAINT "payroll_records_reconciliation_hash_key" UNIQUE (reconciliation_hash); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='production_logs' AND con.conname='production_logs_account_id_fkey') THEN ALTER TABLE public."production_logs" ADD CONSTRAINT "production_logs_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='production_logs' AND con.conname='production_logs_interpreter_id_fkey') THEN ALTER TABLE public."production_logs" ADD CONSTRAINT "production_logs_interpreter_id_fkey" FOREIGN KEY (interpreter_id) REFERENCES interpreters(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='production_logs' AND con.conname='production_logs_payroll_record_id_fkey') THEN ALTER TABLE public."production_logs" ADD CONSTRAINT "production_logs_payroll_record_id_fkey" FOREIGN KEY (payroll_record_id) REFERENCES payroll_records(id) ON DELETE SET NULL; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='production_logs' AND con.conname='production_logs_pkey') THEN ALTER TABLE public."production_logs" ADD CONSTRAINT "production_logs_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='qa_scores' AND con.conname='qa_scores_interpreter_id_fkey') THEN ALTER TABLE public."qa_scores" ADD CONSTRAINT "qa_scores_interpreter_id_fkey" FOREIGN KEY (interpreter_id) REFERENCES interpreters(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='qa_scores' AND con.conname='qa_scores_pkey') THEN ALTER TABLE public."qa_scores" ADD CONSTRAINT "qa_scores_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='qa_scores' AND con.conname='qa_scores_production_log_id_fkey') THEN ALTER TABLE public."qa_scores" ADD CONSTRAINT "qa_scores_production_log_id_fkey" FOREIGN KEY (production_log_id) REFERENCES production_logs(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='qa_scores' AND con.conname='qa_scores_production_log_id_key') THEN ALTER TABLE public."qa_scores" ADD CONSTRAINT "qa_scores_production_log_id_key" UNIQUE (production_log_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='rbac_users' AND con.conname='rbac_users_email_key') THEN ALTER TABLE public."rbac_users" ADD CONSTRAINT "rbac_users_email_key" UNIQUE (email); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='rbac_users' AND con.conname='rbac_users_pkey') THEN ALTER TABLE public."rbac_users" ADD CONSTRAINT "rbac_users_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_access' AND con.conname='recruitment_access_application_id_fkey') THEN ALTER TABLE public."recruitment_access" ADD CONSTRAINT "recruitment_access_application_id_fkey" FOREIGN KEY (application_id) REFERENCES recruitment_applications(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_access' AND con.conname='recruitment_access_application_id_key') THEN ALTER TABLE public."recruitment_access" ADD CONSTRAINT "recruitment_access_application_id_key" UNIQUE (application_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_access' AND con.conname='recruitment_access_invite_code_key') THEN ALTER TABLE public."recruitment_access" ADD CONSTRAINT "recruitment_access_invite_code_key" UNIQUE (invite_code); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_access' AND con.conname='recruitment_access_pkey') THEN ALTER TABLE public."recruitment_access" ADD CONSTRAINT "recruitment_access_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_access' AND con.conname='recruitment_access_token_hash_key') THEN ALTER TABLE public."recruitment_access" ADD CONSTRAINT "recruitment_access_token_hash_key" UNIQUE (token_hash); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_applications' AND con.conname='recruitment_applications_candidate_id_fkey') THEN ALTER TABLE public."recruitment_applications" ADD CONSTRAINT "recruitment_applications_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES recruitment_candidates(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_applications' AND con.conname='recruitment_applications_candidate_id_key') THEN ALTER TABLE public."recruitment_applications" ADD CONSTRAINT "recruitment_applications_candidate_id_key" UNIQUE (candidate_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_applications' AND con.conname='recruitment_applications_hired_interpreter_id_fkey') THEN ALTER TABLE public."recruitment_applications" ADD CONSTRAINT "recruitment_applications_hired_interpreter_id_fkey" FOREIGN KEY (hired_interpreter_id) REFERENCES interpreters(id) ON DELETE SET NULL; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_applications' AND con.conname='recruitment_applications_hired_interpreter_id_key') THEN ALTER TABLE public."recruitment_applications" ADD CONSTRAINT "recruitment_applications_hired_interpreter_id_key" UNIQUE (hired_interpreter_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_applications' AND con.conname='recruitment_applications_pkey') THEN ALTER TABLE public."recruitment_applications" ADD CONSTRAINT "recruitment_applications_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_banking' AND con.conname='recruitment_banking_application_id_fkey') THEN ALTER TABLE public."recruitment_banking" ADD CONSTRAINT "recruitment_banking_application_id_fkey" FOREIGN KEY (application_id) REFERENCES recruitment_applications(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_banking' AND con.conname='recruitment_banking_application_id_key') THEN ALTER TABLE public."recruitment_banking" ADD CONSTRAINT "recruitment_banking_application_id_key" UNIQUE (application_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_banking' AND con.conname='recruitment_banking_pkey') THEN ALTER TABLE public."recruitment_banking" ADD CONSTRAINT "recruitment_banking_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_candidates' AND con.conname='recruitment_candidates_email_key') THEN ALTER TABLE public."recruitment_candidates" ADD CONSTRAINT "recruitment_candidates_email_key" UNIQUE (email); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_candidates' AND con.conname='recruitment_candidates_pkey') THEN ALTER TABLE public."recruitment_candidates" ADD CONSTRAINT "recruitment_candidates_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_contracts' AND con.conname='recruitment_contracts_application_id_fkey') THEN ALTER TABLE public."recruitment_contracts" ADD CONSTRAINT "recruitment_contracts_application_id_fkey" FOREIGN KEY (application_id) REFERENCES recruitment_applications(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_contracts' AND con.conname='recruitment_contracts_application_id_key') THEN ALTER TABLE public."recruitment_contracts" ADD CONSTRAINT "recruitment_contracts_application_id_key" UNIQUE (application_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_contracts' AND con.conname='recruitment_contracts_pkey') THEN ALTER TABLE public."recruitment_contracts" ADD CONSTRAINT "recruitment_contracts_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_documents' AND con.conname='recruitment_documents_application_id_fkey') THEN ALTER TABLE public."recruitment_documents" ADD CONSTRAINT "recruitment_documents_application_id_fkey" FOREIGN KEY (application_id) REFERENCES recruitment_applications(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_documents' AND con.conname='recruitment_documents_pkey') THEN ALTER TABLE public."recruitment_documents" ADD CONSTRAINT "recruitment_documents_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_events' AND con.conname='recruitment_events_application_id_fkey') THEN ALTER TABLE public."recruitment_events" ADD CONSTRAINT "recruitment_events_application_id_fkey" FOREIGN KEY (application_id) REFERENCES recruitment_applications(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_events' AND con.conname='recruitment_events_pkey') THEN ALTER TABLE public."recruitment_events" ADD CONSTRAINT "recruitment_events_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_interviews' AND con.conname='recruitment_interviews_application_id_fkey') THEN ALTER TABLE public."recruitment_interviews" ADD CONSTRAINT "recruitment_interviews_application_id_fkey" FOREIGN KEY (application_id) REFERENCES recruitment_applications(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_interviews' AND con.conname='recruitment_interviews_pkey') THEN ALTER TABLE public."recruitment_interviews" ADD CONSTRAINT "recruitment_interviews_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_offers' AND con.conname='recruitment_offers_application_id_fkey') THEN ALTER TABLE public."recruitment_offers" ADD CONSTRAINT "recruitment_offers_application_id_fkey" FOREIGN KEY (application_id) REFERENCES recruitment_applications(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_offers' AND con.conname='recruitment_offers_pkey') THEN ALTER TABLE public."recruitment_offers" ADD CONSTRAINT "recruitment_offers_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_tech_setups' AND con.conname='recruitment_tech_setups_application_id_fkey') THEN ALTER TABLE public."recruitment_tech_setups" ADD CONSTRAINT "recruitment_tech_setups_application_id_fkey" FOREIGN KEY (application_id) REFERENCES recruitment_applications(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_tech_setups' AND con.conname='recruitment_tech_setups_application_id_key') THEN ALTER TABLE public."recruitment_tech_setups" ADD CONSTRAINT "recruitment_tech_setups_application_id_key" UNIQUE (application_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_tech_setups' AND con.conname='recruitment_tech_setups_pkey') THEN ALTER TABLE public."recruitment_tech_setups" ADD CONSTRAINT "recruitment_tech_setups_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_trainings' AND con.conname='recruitment_trainings_application_id_fkey') THEN ALTER TABLE public."recruitment_trainings" ADD CONSTRAINT "recruitment_trainings_application_id_fkey" FOREIGN KEY (application_id) REFERENCES recruitment_applications(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_trainings' AND con.conname='recruitment_trainings_application_id_key') THEN ALTER TABLE public."recruitment_trainings" ADD CONSTRAINT "recruitment_trainings_application_id_key" UNIQUE (application_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='recruitment_trainings' AND con.conname='recruitment_trainings_pkey') THEN ALTER TABLE public."recruitment_trainings" ADD CONSTRAINT "recruitment_trainings_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_access' AND con.conname='roleplay_access_invite_code_key') THEN ALTER TABLE public."roleplay_access" ADD CONSTRAINT "roleplay_access_invite_code_key" UNIQUE (invite_code); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_access' AND con.conname='roleplay_access_pkey') THEN ALTER TABLE public."roleplay_access" ADD CONSTRAINT "roleplay_access_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_access' AND con.conname='roleplay_access_session_id_fkey') THEN ALTER TABLE public."roleplay_access" ADD CONSTRAINT "roleplay_access_session_id_fkey" FOREIGN KEY (session_id) REFERENCES roleplay_sessions(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_access' AND con.conname='roleplay_access_session_id_key') THEN ALTER TABLE public."roleplay_access" ADD CONSTRAINT "roleplay_access_session_id_key" UNIQUE (session_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_access' AND con.conname='roleplay_access_token_hash_key') THEN ALTER TABLE public."roleplay_access" ADD CONSTRAINT "roleplay_access_token_hash_key" UNIQUE (token_hash); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_responses' AND con.conname='roleplay_responses_pkey') THEN ALTER TABLE public."roleplay_responses" ADD CONSTRAINT "roleplay_responses_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_responses' AND con.conname='roleplay_responses_scenario_id_fkey') THEN ALTER TABLE public."roleplay_responses" ADD CONSTRAINT "roleplay_responses_scenario_id_fkey" FOREIGN KEY (scenario_id) REFERENCES roleplay_scenarios(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_scenarios' AND con.conname='roleplay_scenarios_pkey') THEN ALTER TABLE public."roleplay_scenarios" ADD CONSTRAINT "roleplay_scenarios_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_scenarios' AND con.conname='roleplay_scenarios_session_id_fkey') THEN ALTER TABLE public."roleplay_scenarios" ADD CONSTRAINT "roleplay_scenarios_session_id_fkey" FOREIGN KEY (session_id) REFERENCES roleplay_sessions(id) ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_sessions' AND con.conname='roleplay_session_xor_subject') THEN ALTER TABLE public."roleplay_sessions" ADD CONSTRAINT "roleplay_session_xor_subject" CHECK (((interpreter_id IS NOT NULL)::integer + (recruitment_candidate_id IS NOT NULL)::integer) = 1); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_sessions' AND con.conname='roleplay_sessions_candidate_id_fkey') THEN ALTER TABLE public."roleplay_sessions" ADD CONSTRAINT "roleplay_sessions_candidate_id_fkey" FOREIGN KEY (recruitment_candidate_id) REFERENCES recruitment_candidates(id) ON DELETE SET NULL; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_sessions' AND con.conname='roleplay_sessions_interpreter_id_fkey') THEN ALTER TABLE public."roleplay_sessions" ADD CONSTRAINT "roleplay_sessions_interpreter_id_fkey" FOREIGN KEY (interpreter_id) REFERENCES interpreters(id) ON DELETE SET NULL; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_sessions' AND con.conname='roleplay_sessions_pkey') THEN ALTER TABLE public."roleplay_sessions" ADD CONSTRAINT "roleplay_sessions_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_sessions' AND con.conname='roleplay_sessions_qa_score_id_fkey') THEN ALTER TABLE public."roleplay_sessions" ADD CONSTRAINT "roleplay_sessions_qa_score_id_fkey" FOREIGN KEY (qa_score_id) REFERENCES qa_scores(id) ON DELETE SET NULL; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='roleplay_sessions' AND con.conname='roleplay_sessions_qa_score_id_key') THEN ALTER TABLE public."roleplay_sessions" ADD CONSTRAINT "roleplay_sessions_qa_score_id_key" UNIQUE (qa_score_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='system_configs' AND con.conname='system_configs_key_key') THEN ALTER TABLE public."system_configs" ADD CONSTRAINT "system_configs_key_key" UNIQUE (key); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='system_configs' AND con.conname='system_configs_pkey') THEN ALTER TABLE public."system_configs" ADD CONSTRAINT "system_configs_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='user_profiles' AND con.conname='fk_user_interpreter') THEN ALTER TABLE public."user_profiles" ADD CONSTRAINT "fk_user_interpreter" FOREIGN KEY (interpreter_id) REFERENCES interpreters(id) ON DELETE SET NULL; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='user_profiles' AND con.conname='user_profiles_clerk_id_key') THEN ALTER TABLE public."user_profiles" ADD CONSTRAINT "user_profiles_clerk_id_key" UNIQUE (clerk_id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='user_profiles' AND con.conname='user_profiles_email_key') THEN ALTER TABLE public."user_profiles" ADD CONSTRAINT "user_profiles_email_key" UNIQUE (email); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='user_profiles' AND con.conname='user_profiles_pkey') THEN ALTER TABLE public."user_profiles" ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='vault_accounts' AND con.conname='vault_accounts_holderid_fkey') THEN ALTER TABLE public."vault_accounts" ADD CONSTRAINT "vault_accounts_holderid_fkey" FOREIGN KEY ("holderId") REFERENCES rbac_users(id) ON UPDATE CASCADE ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='vault_accounts' AND con.conname='vault_accounts_interpreterid_fkey') THEN ALTER TABLE public."vault_accounts" ADD CONSTRAINT "vault_accounts_interpreterid_fkey" FOREIGN KEY ("interpreterId") REFERENCES rbac_users(id) ON UPDATE CASCADE ON DELETE SET NULL; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='vault_accounts' AND con.conname='vault_accounts_pkey') THEN ALTER TABLE public."vault_accounts" ADD CONSTRAINT "vault_accounts_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='vault_attachments' AND con.conname='vault_attachments_accountid_fkey') THEN ALTER TABLE public."vault_attachments" ADD CONSTRAINT "vault_attachments_accountid_fkey" FOREIGN KEY ("accountId") REFERENCES vault_accounts(id) ON UPDATE CASCADE ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='vault_attachments' AND con.conname='vault_attachments_pkey') THEN ALTER TABLE public."vault_attachments" ADD CONSTRAINT "vault_attachments_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='vault_messages' AND con.conname='vault_messages_authorid_fkey') THEN ALTER TABLE public."vault_messages" ADD CONSTRAINT "vault_messages_authorid_fkey" FOREIGN KEY ("authorId") REFERENCES rbac_users(id) ON UPDATE CASCADE ON DELETE CASCADE; END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='vault_messages' AND con.conname='vault_messages_pkey') THEN ALTER TABLE public."vault_messages" ADD CONSTRAINT "vault_messages_pkey" PRIMARY KEY (id); END IF; END $constraint$;

DO $constraint$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class r ON r.oid=con.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='vault_messages' AND con.conname='vault_messages_recipientid_fkey') THEN ALTER TABLE public."vault_messages" ADD CONSTRAINT "vault_messages_recipientid_fkey" FOREIGN KEY ("recipientId") REFERENCES rbac_users(id) ON UPDATE CASCADE ON DELETE SET NULL; END IF; END $constraint$;

ALTER SEQUENCE public."accounts_id_seq" OWNED BY public."accounts"."id";

ALTER SEQUENCE public."call_sessions_id_seq" OWNED BY public."call_sessions"."id";

ALTER SEQUENCE public."interpreter_account_rates_id_seq" OWNED BY public."interpreter_account_rates"."id";

ALTER SEQUENCE public."interpreter_monthly_metrics_id_seq" OWNED BY public."interpreter_monthly_metrics"."id";

ALTER SEQUENCE public."interpreter_status_logs_id_seq" OWNED BY public."interpreter_status_logs"."id";

ALTER SEQUENCE public."interpreters_id_seq" OWNED BY public."interpreters"."id";

ALTER SEQUENCE public."payrate_audit_log_id_seq" OWNED BY public."payrate_audit_log"."id";

ALTER SEQUENCE public."production_logs_id_seq" OWNED BY public."production_logs"."id";

ALTER SEQUENCE public."qa_scores_id_seq" OWNED BY public."qa_scores"."id";

ALTER SEQUENCE public."recruitment_candidates_id_seq" OWNED BY public."recruitment_candidates"."id";

ALTER SEQUENCE public."system_configs_id_seq" OWNED BY public."system_configs"."id";

CREATE INDEX IF NOT EXISTS idx_call_sessions_interpreter_id ON public.call_sessions USING btree (interpreter_id);

CREATE INDEX IF NOT EXISTS idx_call_sessions_started_at ON public.call_sessions USING btree (started_at);

CREATE UNIQUE INDEX IF NOT EXISTS unique_active_call ON public.call_sessions USING btree (interpreter_id) WHERE (ended_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_interpreter_account_rates_account ON public.interpreter_account_rates USING btree (account_id);

CREATE INDEX IF NOT EXISTS idx_interpreter_account_rates_interpreter ON public.interpreter_account_rates USING btree (interpreter_id);

CREATE INDEX IF NOT EXISTS idx_monthly_metrics_period ON public.interpreter_monthly_metrics USING btree (period);

CREATE INDEX IF NOT EXISTS idx_monthly_metrics_ranking ON public.interpreter_monthly_metrics USING btree (ranking_position);

CREATE INDEX IF NOT EXISTS idx_status_logs_created_at ON public.interpreter_status_logs USING btree (created_at);

CREATE INDEX IF NOT EXISTS idx_status_logs_interpreter_time ON public.interpreter_status_logs USING btree (interpreter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_created_at_idx ON public.messages USING btree (created_at);

CREATE INDEX IF NOT EXISTS messages_receiver_id_idx ON public.messages USING btree (receiver_id);

CREATE INDEX IF NOT EXISTS messages_sender_id_idx ON public.messages USING btree (sender_id);

CREATE INDEX IF NOT EXISTS idx_notifications_category ON public.notifications USING btree (category);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications USING btree (created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications USING btree (is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications USING btree (user_id);

CREATE INDEX IF NOT EXISTS password_reset_tokens_email_idx ON public.password_reset_tokens USING btree (email);

CREATE INDEX IF NOT EXISTS idx_payroll_records_interpreter ON public.payroll_records USING btree (interpreter_id);

CREATE INDEX IF NOT EXISTS idx_payroll_records_period ON public.payroll_records USING btree (period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_payroll_records_status ON public.payroll_records USING btree (status);

CREATE UNIQUE INDEX IF NOT EXISTS unique_payroll_per_interpreter_period ON public.payroll_records USING btree (interpreter_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_production_logs_date ON public.production_logs USING btree (date);

CREATE INDEX IF NOT EXISTS idx_production_logs_interpreter_date ON public.production_logs USING btree (interpreter_id, date);

CREATE INDEX IF NOT EXISTS idx_production_logs_status ON public.production_logs USING btree (status);

CREATE UNIQUE INDEX IF NOT EXISTS unique_manual_log_per_day ON public.production_logs USING btree (interpreter_id, date) WHERE (status = 'Manual'::text);

CREATE INDEX IF NOT EXISTS idx_qa_scores_audit_date ON public.qa_scores USING btree (audit_date);

CREATE INDEX IF NOT EXISTS idx_qa_scores_interpreter_id ON public.qa_scores USING btree (interpreter_id);

CREATE INDEX IF NOT EXISTS rbac_users_role_idx ON public.rbac_users USING btree (role);

CREATE INDEX IF NOT EXISTS idx_recruitment_access_expires ON public.recruitment_access USING btree (expires_at);

CREATE INDEX IF NOT EXISTS idx_recruitment_access_invite_code ON public.recruitment_access USING btree (invite_code);

CREATE INDEX IF NOT EXISTS idx_recruitment_access_token_hash ON public.recruitment_access USING btree (token_hash);

CREATE INDEX IF NOT EXISTS idx_recruitment_application_created_at ON public.recruitment_applications USING btree (created_at);

CREATE INDEX IF NOT EXISTS idx_recruitment_application_last_activity ON public.recruitment_applications USING btree (last_activity_at);

CREATE INDEX IF NOT EXISTS idx_recruitment_application_status_step ON public.recruitment_applications USING btree (status, current_step);

CREATE INDEX IF NOT EXISTS idx_recruitment_candidates_fecha_postulacion ON public.recruitment_candidates USING btree (fecha_postulacion);

CREATE INDEX IF NOT EXISTS idx_recruitment_candidates_status ON public.recruitment_candidates USING btree (status);

CREATE INDEX IF NOT EXISTS idx_recruitment_document_application_status ON public.recruitment_documents USING btree (application_id, status);

CREATE INDEX IF NOT EXISTS idx_recruitment_document_application_type ON public.recruitment_documents USING btree (application_id, type);

CREATE INDEX IF NOT EXISTS idx_recruitment_event_actor ON public.recruitment_events USING btree (actor_id);

CREATE INDEX IF NOT EXISTS idx_recruitment_event_application_time ON public.recruitment_events USING btree (application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recruitment_event_type ON public.recruitment_events USING btree (event_type);

CREATE INDEX IF NOT EXISTS idx_recruitment_interview_application_status ON public.recruitment_interviews USING btree (application_id, status);

CREATE INDEX IF NOT EXISTS idx_recruitment_interview_scheduled_at ON public.recruitment_interviews USING btree (scheduled_at);

CREATE INDEX IF NOT EXISTS idx_recruitment_offer_application_status ON public.recruitment_offers USING btree (application_id, status);

CREATE INDEX IF NOT EXISTS idx_roleplay_access_expires ON public.roleplay_access USING btree (expires_at);

CREATE INDEX IF NOT EXISTS idx_roleplay_access_invite_code ON public.roleplay_access USING btree (invite_code);

CREATE INDEX IF NOT EXISTS idx_roleplay_access_token_hash ON public.roleplay_access USING btree (token_hash);

CREATE INDEX IF NOT EXISTS idx_roleplay_scenarios_session_order ON public.roleplay_scenarios USING btree (session_id, "order");

CREATE INDEX IF NOT EXISTS idx_roleplay_candidate_status ON public.roleplay_sessions USING btree (recruitment_candidate_id, status);

CREATE INDEX IF NOT EXISTS idx_roleplay_interpreter_status ON public.roleplay_sessions USING btree (interpreter_id, status);

CREATE INDEX IF NOT EXISTS idx_roleplay_review_priority ON public.roleplay_sessions USING btree (review_priority);

CREATE INDEX IF NOT EXISTS idx_roleplay_status_created ON public.roleplay_sessions USING btree (status, created_at);

CREATE INDEX IF NOT EXISTS idx_roleplay_status_submitted ON public.roleplay_sessions USING btree (status, submitted_at);

CREATE INDEX IF NOT EXISTS idx_user_profiles_clerk ON public.user_profiles USING btree (clerk_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_interpreter ON public.user_profiles USING btree (interpreter_id) WHERE (interpreter_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_user_profiles_onboarding ON public.user_profiles USING btree (onboarding_complete) WHERE (onboarding_complete = false);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles USING btree (role);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_interpreter_id_key ON public.user_profiles USING btree (interpreter_id) WHERE (interpreter_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS vault_accounts_holderid_idx ON public.vault_accounts USING btree ("holderId");

CREATE INDEX IF NOT EXISTS vault_accounts_interpreterid_idx ON public.vault_accounts USING btree ("interpreterId");

CREATE INDEX IF NOT EXISTS vault_attachments_accountid_idx ON public.vault_attachments USING btree ("accountId");

CREATE INDEX IF NOT EXISTS vault_messages_authorid_idx ON public.vault_messages USING btree ("authorId");

CREATE INDEX IF NOT EXISTS vault_messages_recipientid_idx ON public.vault_messages USING btree ("recipientId");

CREATE INDEX IF NOT EXISTS vault_messages_status_idx ON public.vault_messages USING btree (status);

COMMIT;
