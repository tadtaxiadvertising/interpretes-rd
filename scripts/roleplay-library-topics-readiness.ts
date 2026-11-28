import { readFile } from 'node:fs/promises';
import { getRawPool } from '../src/lib/prisma';

type Readiness = {
  tableExists: boolean;
  rlsEnabled: boolean;
  columnsMatch: boolean;
  fingerprintPrimaryKey: boolean;
  externalRolesPresent: boolean;
  externalAccessDenied: boolean;
  serverDmlGranted: boolean;
  rlsActiveForServer: boolean;
};

async function main() {
  const sql = await readFile('scripts/ci/roleplay-library-topics-readiness.sql', 'utf8');
  const pool = getRawPool();
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5s'");
      const { rows } = await client.query<{ result: Readiness }>(sql);
      const result = rows[0]?.result;
      if (!result) throw new Error('Missing catalog result');
      const metadataReady = result.tableExists === true && result.rlsEnabled === true &&
        result.columnsMatch === true && result.fingerprintPrimaryKey === true &&
        result.externalRolesPresent === true && result.externalAccessDenied === true &&
        result.serverDmlGranted === true;
      console.log(JSON.stringify({
        ...result,
        metadataReady,
        featureFlagEnabled: process.env.ROLEPLAY_LIBRARY_EDITORIAL_TOPICS_ENABLED === 'true',
        activationAuthorized: false,
        nextStep: !metadataReady ? 'Resolve missing schema or permissions in staging.' :
          'Verify actual staging CRUD and RLS before approved rollout.',
      }, null, 2));
      if (!metadataReady) process.exitCode = 1;
    } finally {
      try { await client.query('ROLLBACK'); } finally { client.release(); }
    }
  } finally { await pool.end(); }
}
main().catch(() => {
  // Never expose connection strings, credentials, database error details or rows.
  console.error('Editorial topics readiness unavailable. Check server configuration.');
  process.exitCode = 1;
});
