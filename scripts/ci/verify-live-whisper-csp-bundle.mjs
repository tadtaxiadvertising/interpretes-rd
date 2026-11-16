import { existsSync, readFileSync, readdirSync, cpSync, mkdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const WORKER_NAME = /^live-whisper-asr-worker-[a-f0-9]+\.js$/;
const EXPECTED_SOURCE = '/_next/static/chunks/live-whisper-asr-worker-:hash([a-f0-9]+).js';
const MODEL_ORIGINS = ['https://huggingface.co', 'https://us.aws.cdn.hf.co'];
const PORT = 4186;
const ORIGIN = 'http://127.0.0.1:' + PORT;

function fail(message) { throw new Error('LOCAL_WHISPER_CSP_CONTRACT: ' + message); }
function listFiles(root) {
  if (!existsSync(root)) fail('missing Next.js static asset directory: ' + root);
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(target));
    else if (entry.isFile()) output.push(target);
  }
  return output;
}
function assert(condition, message) { if (!condition) fail(message); }

async function main() {
  assert(process.env.NEXT_PUBLIC_LIVE_WHISPER_PILOT_ENABLED === 'true',
    'build must explicitly enable pilot for this isolated CI check');
  const root = resolve('.next/static/chunks');
  const files = listFiles(root);
  const workers = files.filter(file => WORKER_NAME.test(relative(root, file)));
  if (workers.length !== 1) {
    // Print only candidate filenames; never include model, app or session data.
    const candidates = listFiles(resolve('.next/static')).filter(file => {
      if (!file.endsWith('.js')) return false;
      const rel = relative(resolve('.next/static'), file);
      if (/whisper|worker/i.test(rel)) return true;
      const source = readFileSync(file, 'utf8');
      return source.includes('LOCAL_WHISPER_MODEL_LOAD_FAILED') ||
        source.includes('free-interpreters-whisper-tiny') ||
        source.includes('onnx-community/whisper-tiny');
    });
    console.error('Generated Worker-like static asset names: ' +
      JSON.stringify(candidates.slice(0, 24).map(file =>
        relative(resolve('.next/static'), file))));
    fail('expected exactly one named Whisper Worker output, found ' + workers.length);
  }

  const publicPath = '/_next/static/chunks/' + relative(root, workers[0]).replaceAll('\\', '/');
  const manifest = JSON.parse(readFileSync('.next/routes-manifest.json', 'utf8'));
  const headers = manifest.headers || [];
  const policy = headers.find(item => item.source === EXPECTED_SOURCE);
  assert(policy && new RegExp(policy.regex).test(publicPath),
    'generated Worker path not covered by its scoped Next header rule');
  const csp = policy.headers.find(h => h.key.toLowerCase() === 'content-security-policy')?.value;
  assert(csp, 'missing scoped Worker CSP');
  for (const host of MODEL_ORIGINS) assert(csp.includes(host), 'missing permitted host ' + host);
  assert(!headers.some(item => item.source === '/live' &&
    item.headers.some(h => h.value.includes('huggingface.co'))),
    'document must not get external model download permissions');
  assert(!headers.some(item => item.source === '/_next/static/chunks/:path*' &&
    item.headers.some(h => h.value.includes('huggingface.co'))),
    'shared chunks folder must not get model download permissions');

  // Exercise the actual built standalone HTTP response rather than only
  // trusting the route manifest and unit tests. No database writes or audio.
  mkdirSync('.next/standalone/.next', { recursive: true });
  cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
  if (existsSync('public')) cpSync('public', '.next/standalone/public', { recursive: true });
  const child = spawn(process.execPath, ['.next/standalone/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', value => { stderr = (stderr + String(value)).slice(-2000); });
  try {
    let response;
    for (let i = 0; i < 100; i += 1) {
      if (child.exitCode !== null) fail('standalone server exited: ' + stderr);
      try {
        response = await fetch(ORIGIN + publicPath, {
          method: 'HEAD', signal: AbortSignal.timeout(1500),
        });
        if (response.status === 200) break;
      } catch { /* server still starting */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(response?.status === 200, 'Worker asset not served with HTTP 200');
    const observed = response.headers.get('content-security-policy') ?? '';
    for (const host of MODEL_ORIGINS) {
      assert(observed.includes(host), 'HTTP Worker CSP lacks ' + host);
    }
    const unrelated = files.find(file => file.endsWith('.js') &&
      !WORKER_NAME.test(relative(root, file)));
    assert(unrelated, 'no unrelated Next static bundle found for isolation check');
    const unrelatedPath = '/_next/static/chunks/' + relative(root, unrelated).replaceAll('\\', '/');
    const unrelatedResponse = await fetch(ORIGIN + unrelatedPath, {
      method: 'HEAD', signal: AbortSignal.timeout(5000),
    });
    assert(unrelatedResponse.status === 200, 'unrelated bundle unavailable');
    const unrelatedCsp = unrelatedResponse.headers.get('content-security-policy') ?? '';
    assert(!unrelatedCsp.includes('huggingface.co') &&
      !unrelatedCsp.includes('us.aws.cdn.hf.co'),
      'unrelated bundle incorrectly inherits model download origins');

    console.log('PASS: hashed Whisper entry bundle exists and is served under its exact CSP.');
    console.log('PASS: real Next standalone HTTP headers allow model hosts only on the Worker.');
    console.log('PASS: unrelated Next chunks and /live document retain strict site CSP.');
    console.log('NOTE: this checks built CSP scope, not WebAssembly inference accuracy.');
  } finally {
    child.kill('SIGTERM');
  }
}
main().catch(error => { console.error(String(error)); process.exitCode = 1; });
