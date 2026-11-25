-- Safe metadata query before or after installation. No keys or account data.
WITH expected(name) AS (
  VALUES ('candidate_account_binding'),('recruitment_delivery'),
         ('provider_profile'),('provider_quota'),('provider_selection'),('provider_budget_audit')
), objects AS (
  SELECT name, to_regclass('private_email.' || name) AS object_id FROM expected
)
SELECT name, object_id IS NOT NULL AS installed,
       c.relrowsecurity AS rls, pg_get_userbyid(c.relowner) AS owner,
       CASE WHEN object_id IS NULL THEN NULL ELSE NOT EXISTS (
         SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')
           AND has_table_privilege(r.oid,object_id,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       ) END AS api_table_access_denied,
       NOT EXISTS (
         SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')
         AND has_schema_privilege(r.oid,to_regnamespace('private_email'),'USAGE,CREATE')
       ) AS api_schema_access_denied
FROM objects LEFT JOIN pg_class c ON c.oid = object_id
ORDER BY name;

-- Only after all four provider tables are installed, run the following
-- separate read-only statements (remove the comment markers).
-- SELECT provider,daily_limit,monthly_limit,daily_used,monthly_used
-- FROM private_email.provider_quota ORDER BY provider;
-- SELECT count(*) AS selections,count(profile_id) AS selected_profiles
-- FROM private_email.provider_selection;
-- SELECT count(*) AS profiles FROM private_email.provider_profile;
-- SELECT count(*) AS budget_changes FROM private_email.provider_budget_audit;
-- A fresh installation must have 2 quota rows at 50/1000 with zero usage,
-- 1 selection row with NULL profile, and zero profiles/audit changes.
-- Never interpret these as a provider's external credit balance.
