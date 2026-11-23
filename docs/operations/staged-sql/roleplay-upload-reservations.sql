-- STAGED DESIGN ONLY; deliberately outside prisma/migrations and not deployed.
-- Do NOT apply to production until a schema-only rollout and backup are approved.
-- The current POST /api/admin/roleplays does not use this table.
--
-- Future flow:
-- 1. Authenticate the admin's cookie session and any explicit Bearer identity.
-- 2. Validate all 1–25 audio declarations, generate UUID/paths server-side.
-- 3. INSERT reservation with (actor_user_id, request_key) UNIQUE, BEFORE
--    issuing even a single signed upload token.
-- 4. Duplicate request keys require scoped digest comparison/reconciliation,
--    never reissue tokens based on the key alone.
-- 5. A trusted verifier persists evidence for ALL items (real bytes + SHA).
-- 6. Publish only by atomic VERIFIED -> PUBLISHED claim inside the same
--    transaction as session/assignment creation. Never blindly retry cleanup.
-- No backfill, no data read, no role changes, no policies granting browser access.

CREATE TABLE "public"."roleplay_upload_reservations" (
  "id" UUID NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "request_key" UUID NOT NULL,
  "declaration_hash" VARCHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
  "items" JSONB NOT NULL,
  "verified_objects" JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- A server-side publication receipt. NEVER trust IDs from client JSON.
  -- Transactionally committed with the actual Roleplay session inserts.
  "published_session_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "roleplay_upload_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "roleplay_upload_reservations_actor_key" UNIQUE ("actor_user_id", "request_key"),
  CONSTRAINT "roleplay_upload_reservations_owner_check"
    CHECK (length(btrim("actor_user_id")) BETWEEN 1 AND 256),
  CONSTRAINT "roleplay_upload_reservations_digest_check"
    CHECK ("declaration_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "roleplay_upload_reservations_status_check"
    CHECK ("status" IN ('RESERVED', 'VERIFYING', 'VERIFIED', 'PUBLISHED', 'CANCELLED')),
  CONSTRAINT "roleplay_upload_reservations_expiry_check"
    CHECK ("expires_at" > "created_at"
      AND "expires_at" <= "created_at" + INTERVAL '30 minutes'),
  CONSTRAINT "roleplay_upload_reservations_items_check"
    CHECK (jsonb_typeof("items") = 'array'
      AND jsonb_array_length("items") BETWEEN 1 AND 25),
  CONSTRAINT "roleplay_upload_reservations_evidence_check"
    CHECK (jsonb_typeof("verified_objects") = 'array'
      AND jsonb_array_length("verified_objects") BETWEEN 0 AND 25
      AND (("status" NOT IN ('VERIFIED', 'PUBLISHED'))
        OR jsonb_array_length("verified_objects") = jsonb_array_length("items"))),
  CONSTRAINT "roleplay_upload_reservations_publication_receipt_check"
    CHECK (
      ("status" = 'PUBLISHED' AND
        cardinality("published_session_ids") BETWEEN 1 AND 100000 AND
        array_position("published_session_ids", NULL) IS NULL AND
        NOT ('' = ANY("published_session_ids")))
      OR
      ("status" <> 'PUBLISHED' AND
        cardinality("published_session_ids") = 0)
    )
);

-- Server-only table: no browser RLS policy and no public Data API grants.
ALTER TABLE "public"."roleplay_upload_reservations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."roleplay_upload_reservations" FROM PUBLIC;
DO $roleplay_upload_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."roleplay_upload_reservations" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."roleplay_upload_reservations" FROM authenticated;
  END IF;
END
$roleplay_upload_roles$;

COMMENT ON TABLE "public"."roleplay_upload_reservations" IS
  'Future server-only upload reservation ledger; not a Storage token or authorization grant.';
