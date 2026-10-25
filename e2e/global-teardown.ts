import { Client } from 'pg';

/**
 * Destructive cleanup is deliberately opt-in and uses a dedicated E2E database
 * URL. Never fall back to DATABASE_URL/DIRECT_URL: those commonly point at a
 * shared or production database.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_ALLOW_DB_CLEANUP !== 'true') {
    console.warn('[e2e teardown] Cleanup disabled; set E2E_ALLOW_DB_CLEANUP=true to opt in');
    return;
  }

  const connectionString = process.env.E2E_DATABASE_URL;
  if (!connectionString) {
    throw new Error('[e2e teardown] Cleanup is enabled but E2E_DATABASE_URL is missing');
  }

  const client = new Client({
    connectionString,
    ssl: process.env.E2E_DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  try {
    const result = await client.query(
      "delete from recruitment_candidates where email like 'e2e-dupesubmit-%@example.com' returning id",
    );
    console.log(`[e2e teardown] Removed ${result.rowCount ?? 0} test candidate(s) from the dedicated E2E database`);
  } finally {
    await client.end();
  }
}
