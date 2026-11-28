# Editorial roleplay library topics: rollout gates

Status: proposal only. Keep ROLEPLAY_LIBRARY_EDITORIAL_TOPICS_ENABLED off until the following gates pass.

1. Run the isolated PostgreSQL workflow. It executes the unchanged staged SQL using simulated default grants, validates RLS and revocation (including a BYPASSRLS service role), tests non-overwriting insertion, manual upsert and clearing, and demonstrates the difference between owner and non-owner server access.
2. Identify the actual server-side Prisma database role using the same connection configuration as the application, without exposing connection strings or credentials. Verify role membership and ownership in a non-production environment. Never grant access to anon, authenticated, service_role or PUBLIC to fix an application permission problem.
3. Review the exact production migration and privileges for the identified server-only role separately. Fixture roles and policies in CI are not production SQL. Verify effective privileges and RLS, including no browser Data API access. Do not enable the flag if the server role cannot read and write or if public roles can access the table.
4. In staging with the actual application role, verify create -> category save -> library filters, manual changes, retry, repeated saves without overwriting, clear and archived entries. Verify the flag-off behavior and existing publication flow without the table.
5. Obtain approval for the migration and rollout, apply the reviewed schema, then enable the server flag and run an administrative smoke test. Do not change fingerprint or archive behavior. If classification fails, disable the flag; the existing sessions and saved category rows should be retained. Do not drop the table as an initial rollback.

This workflow does not prove real production permissions or deploy a migration. Bulk and recovered publication flows are not covered by automatic category saving.
