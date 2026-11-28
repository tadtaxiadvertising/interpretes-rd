# Editorial roleplay library topics: rollout gates

Status: proposal only. Keep ROLEPLAY_LIBRARY_EDITORIAL_TOPICS_ENABLED off until the following gates pass.

1. Run the isolated PostgreSQL workflow. It executes the unchanged staged SQL using simulated default grants, validates RLS and revocation (including a BYPASSRLS service role), tests non-overwriting insertion, manual upsert and clearing, and demonstrates the difference between owner and non-owner server access.
2. Identify the actual server-side Prisma database role using the same connection configuration as the application, without exposing connection strings or credentials. Verify role membership and ownership in a non-production environment. Never grant access to anon, authenticated, service_role or PUBLIC to fix an application permission problem.
3. Review the exact production migration and privileges for the identified server-only role separately. Fixture roles and policies in CI are not production SQL. Verify effective privileges and RLS, including no browser Data API access. Do not enable the flag if the server role cannot read and write or if public roles can access the table.
4. In staging with the actual application role, verify create -> category save -> library filters, manual changes, retry, repeated saves without overwriting, clear and archived entries. Verify the flag-off behavior and existing publication flow without the table.
5. Obtain approval for the migration and rollout, apply the reviewed schema, then enable the server flag and run an administrative smoke test. Do not change fingerprint or archive behavior. If classification fails, disable the flag; the existing sessions and saved category rows should be retained. Do not drop the table as an initial rollback.

This workflow does not prove real production permissions or deploy a migration. Bulk and recovered publication flows are not covered by automatic category saving.

## Read-only readiness command

From the application checkout with the same DATABASE_URL and trusted CA configuration as the Next.js service, run `npm run roleplay:topics-readiness`. It uses the existing runtime pool and a read-only transaction with a statement timeout. Output contains only metadata booleans and flag state; no role names, connection strings, or application rows. Nonzero exit means catalog checks are incomplete or the connection is unavailable. `metadataReady: true` is not permission to activate: verify actual CRUD and RLS in staging, obtain rollout approval, then perform the approved migration and smoke test. A non-owner server with active RLS requires particular attention to policies. Do not add a production grant based solely on this report.

### Administrator interface

After deployment, open Biblioteca de roleplays → Diagnóstico de categorías permanentes → Comprobar configuración. This requests the same metadata-only check as the terminal command, even while the feature flag is off. It does not perform schema changes, writes, or authorize activation. The standalone build must include the traced SQL file. A positive report still requires staging CRUD validation.

## Atomic installation rehearsal

The disposable PostgreSQL job now rehearses the exact proposed SQL with its outer COMMIT replaced by ROLLBACK, injects a deliberate late failure before COMMIT, and verifies that neither attempt leaves the table behind. It then installs the unchanged proposal in the disposable database and checks that a second installation fails without modifying a saved category or its access configuration. This intentionally preserves the proposal's fail-closed behavior; do not add DROP TABLE, CREATE TABLE IF NOT EXISTS or broad grants to recover from a collision.

The production plan remains separate from the automatic Prisma migrations. Before a reviewed installation, identify the migration owner and actual application role in staging. Confirm the expected schema is absent (if present, diagnose drift instead of reinstalling), use the reviewed transaction, and verify access using the application connection. Keep the feature flag disabled until the end-to-end staging and rollout gates above are satisfied. Rollback of activation is flag-off, not deletion of saved metadata.
