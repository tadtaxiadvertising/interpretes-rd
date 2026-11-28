import { getRawPool } from '../src/lib/prisma';
import { readRoleplayTopicsReadiness } from '../src/lib/roleplay-topics-readiness';

async function main() {
  try {
    const result = await readRoleplayTopicsReadiness();
    console.log(JSON.stringify(result, null, 2));
    if (!result.metadataReady) process.exitCode = 1;
  } finally { await getRawPool().end(); }
}
main().catch(() => {
  console.error('Editorial topics readiness unavailable. Check server configuration.');
  process.exitCode = 1;
});
