import { Client } from 'pg';

export default async function globalTeardown(): Promise<void> {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn('[e2e teardown] No DIRECT_URL/DATABASE_URL; skipping candidate cleanup');
    return;
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const result = await client.query(
      "delete from recruitment_candidates where email like 'e2e-dupesubmit-%@example.com' returning id",
    );
    console.log(`[e2e teardown] Removed ${result.rowCount ?? 0} test candidate(s)`);
  } finally {
    await client.end();
  }
}
