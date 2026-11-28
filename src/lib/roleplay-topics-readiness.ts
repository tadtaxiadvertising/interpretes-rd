import { readFile } from 'node:fs/promises';
import { getRawPool } from '@/lib/prisma';

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

export async function readRoleplayTopicsReadiness() {
  const sql = await readFile('scripts/ci/roleplay-library-topics-readiness.sql', 'utf8');
  const pool = getRawPool();
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
      return {
        ...result,
        metadataReady,
        featureFlagEnabled: process.env.ROLEPLAY_LIBRARY_EDITORIAL_TOPICS_ENABLED === 'true',
        activationAuthorized: false,
        nextStep: !metadataReady ? 'Resolve missing schema or permissions in staging.' :
          'Verify actual staging CRUD and RLS before approved rollout.',
      };
    } finally {
      try { await client.query('ROLLBACK'); } finally { client.release(); }
    }
}
