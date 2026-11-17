ALTER TABLE "public"."account_platforms"
  ADD COLUMN "vpn_provider" TEXT,
  ADD COLUMN "vpn_app" TEXT,
  ADD COLUMN "vpn_username_hint" TEXT,
  ADD COLUMN "vpn_secret_ref" TEXT,
  ADD COLUMN "vpn_country" TEXT,
  ADD COLUMN "vpn_region" TEXT,
  ADD COLUMN "vpn_server" TEXT,
  ADD COLUMN "vpn_exit_ip" TEXT,
  ADD COLUMN "vpn_profile" TEXT,
  ADD COLUMN "vpn_protocol" TEXT,
  ADD COLUMN "vpn_port" INTEGER;

ALTER TABLE "public"."account_platforms"
  ADD CONSTRAINT "account_platforms_vpn_port_range"
  CHECK ("vpn_port" IS NULL OR ("vpn_port" >= 1 AND "vpn_port" <= 65535));
