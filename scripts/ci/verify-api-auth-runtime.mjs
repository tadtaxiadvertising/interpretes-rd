// Runs only inside the disposable API CI container. Never use production data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

const expectedDb = 'postgresql://postgres:postgres@127.0.0.1:5432/interpreters_e2e';
const expectedSecret = 'synthetic-api-auth-ci-only-not-production-2026';
if (process.env.CI !== 'true' || process.env.API_AUTH_SMOKE !== 'true' ||
    process.env.DATABASE_URL !== expectedDb || process.env.JWT_SECRET !== expectedSecret) {
  throw new Error('Refusing API auth smoke outside disposable CI context');
}

const { default: app } = await import('./dist/app.js');
const { prisma } = await import('./dist/lib/prisma.js');
const { default: bcrypt } = await import('bcrypt');
const { default: jwt } = await import('jsonwebtoken');
const { withPasswordWork } = await import('./dist/lib/password-work-gate.js');
const nonce = randomUUID();
const legacyEmail = 'legacy-' + nonce + '@example.test';
const newEmail = 'new-' + nonce + '@example.test';
const managedEmail = 'managed-' + nonce + '@example.test';
const boundaryEmail = 'boundary-' + nonce + '@example.test';
const longLegacyEmail = 'long-legacy-' + nonce + '@example.test';
const rejectedEmail = 'rejected-' + nonce + '@example.test';
const password = 'Synthetic-Auth-Compatibility-2026!';
let server;

try {
  await prisma.rbacUser.create({
    data: {
      email: legacyEmail, name: 'Synthetic Legacy', role: 'INTERPRETER',
      password: '$2a$10$abcdefghijklmnopqrstuuVXbUTOOH4bACvrZgQpeM.CiieeH/v02',
    },
  });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  async function request(path, { body, token, status = 200, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    assert.equal(response.status, status, path + ' unexpected HTTP status');
    if (status === 204) return;
    return response.json();
  }
  const expectedBuild = process.env.EXPECTED_API_BUILD_SHA;
  assert.match(expectedBuild ?? '', /^[a-f0-9]{40}$/i);
  const version = await fetch(origin + '/api/version', { signal: AbortSignal.timeout(10000) });
  assert.equal(version.status, 200);
  assert.match(version.headers.get('cache-control') ?? '', /no-store/);
  assert.deepEqual(await version.json(), { service: 'interpreters-api', buildId: expectedBuild.toLowerCase() });
  assert.notEqual(process.env.GIT_SHA, expectedBuild);
  assert.equal((await request('/ready')).status, 'ready');
  const legacy = await request('/api/auth/login', { body: { email: legacyEmail, password } });
  assert.equal(legacy.success, true);
  assert.equal(legacy.data.user.role, 'INTERPRETER');
  assert.ok(!Object.hasOwn(legacy.data.user, 'password'));
  assert.equal(typeof legacy.data.token, 'string');
  assert.equal((await request('/api/auth/me', { token: legacy.data.token })).data.email, legacyEmail);
  await request('/api/auth/login', { body: { email: legacyEmail, password: 'incorrect' }, status: 401 });
  await request('/api/auth/me', { status: 401 });
  await request('/api/auth/me', { token: 'invalid-token', status: 401 });
  await request('/api/auth/register', {
    body: { email: rejectedEmail, password, name: 'Synthetic Rejected', role: 'ADMIN' }, status: 400,
  });
  assert.equal(await prisma.rbacUser.count({ where: { email: rejectedEmail } }), 0);
  // UTF-8 byte boundary: 36 accented characters = 72 bytes.
  const boundaryPassword = 'é'.repeat(36);
  for (const overLimit of ['x'.repeat(73), 'é'.repeat(37), '😀'.repeat(19)]) {
    await request('/api/auth/register', {
      body: { email: boundaryEmail, password: overLimit, name: 'Synthetic Boundary' }, status: 400,
    });
  }
  assert.equal(await prisma.rbacUser.count({ where: { email: boundaryEmail } }), 0);
  await request('/api/auth/register', {
    body: { email: boundaryEmail, password: boundaryPassword, name: 'Synthetic Boundary' }, status: 201,
  });
  await request('/api/auth/login', { body: { email: boundaryEmail, password: boundaryPassword } });
  // Existing credentials may have been created under the former 128-character
  // policy. Do not invalidate them during this new-account-only hardening.
  const historicalPassword = 'x'.repeat(72) + 'legacy-suffix';
  await prisma.rbacUser.create({ data: {
    email: longLegacyEmail, name: 'Synthetic Historical', role: 'INTERPRETER',
    password: await bcrypt.hash(historicalPassword, 10),
  } });
  await request('/api/auth/login', { body: { email: longLegacyEmail, password: historicalPassword } });
  const registered = await request('/api/auth/register', {
    body: { email: newEmail, password, name: 'Synthetic New' }, status: 201,
  });
  assert.equal(registered.data.role, 'INTERPRETER');
  assert.ok(!Object.hasOwn(registered.data, 'password'));
  const stored = await prisma.rbacUser.findUniqueOrThrow({ where: { email: newEmail }, select: { password: true } });
  assert.notEqual(stored.password, password);
  assert.equal(bcrypt.getRounds(stored.password), 10);
  assert.equal(await bcrypt.compare(password, stored.password), true);
  const login = await request('/api/auth/login', { body: { email: newEmail, password } });
  assert.equal(login.data.user.id, registered.data.id);
  assert.equal((await request('/api/auth/me', { token: login.data.token })).data.role, 'INTERPRETER');
  await request('/api/auth/register', {
    body: { email: newEmail, password, name: 'Synthetic Duplicate' }, status: 409,
  });
  // A regular account cannot list administrator-only user records.
  await request('/api/v1/users', { token: login.data.token, status: 403 });
  // Legacy Express writer must never reach a production mutation.
  const legacyProductionPath = '/api/v1/production/manual-entry';
  const legacyProductionBody = { interpreterId: 2147483647, date: '2026-01-01', interpreted_minutes: 1 };
  await request(legacyProductionPath, { body: legacyProductionBody, status: 401 });
  await request(legacyProductionPath, { body: legacyProductionBody, token: 'invalid-token', status: 401 });
  await request(legacyProductionPath, { body: legacyProductionBody, token: login.data.token, status: 403 });
  // This retired route cannot authenticate a legacy shared secret or mutate
  // any call, production or ledger row, regardless of caller credentials.
  const oldCallPath = '/api/v1/calls/manual';
  const oldCallBody = { interpreterId: 'synthetic-' + nonce, minutes: 1 };
  const before = await Promise.all([
    prisma.callSession.count(), prisma.productionLog.count(), prisma.callProductionEntry.count(),
  ]);
  for (const token of [undefined, 'synthetic-obsolete-key', login.data.token]) {
    const retiredCall = await request(oldCallPath, { body: oldCallBody, token, status: 410 });
    assert.deepEqual(retiredCall, {
      success: false, code: 'LEGACY_MANUAL_CALL_DISABLED',
      error: 'Utiliza el flujo autorizado de registro de llamadas de la plataforma.',
    });
  }
  await request(oldCallPath, { body: {}, status: 410 });
  assert.deepEqual(await Promise.all([
    prisma.callSession.count(), prisma.productionLog.count(), prisma.callProductionEntry.count(),
  ]), before);
  console.log('Legacy Express manual call writer retired without call, production or ledger writes.');
  // Changing permissions must not silently upgrade an existing token.
  await prisma.rbacUser.update({ where: { id: registered.data.id }, data: { role: 'ADMIN' } });
  await request('/api/auth/me', { token: login.data.token, status: 401 });
  await request('/api/v1/users', { token: login.data.token, status: 401 });
  const admin = await request('/api/auth/login', { body: { email: newEmail, password } });
  assert.equal(admin.data.user.role, 'ADMIN');
  assert.equal((await request('/api/auth/me', { token: admin.data.token })).data.role, 'ADMIN');
  // Occupy both real gate slots deterministically, without CPU stress or timers.
  // Every password path shares this process-local budget.
  let releasePasswordWork;
  const pendingWork = new Promise(resolve => { releasePasswordWork = resolve; });
  const busy = [withPasswordWork(() => pendingWork), withPasswordWork(() => pendingWork)];
  try {
    await request('/api/auth/login', { body: { email: newEmail, password }, status: 503 });
    await request('/api/auth/register', {
      body: { email: rejectedEmail, password, name: 'Synthetic Busy' }, status: 503,
    });
    await request('/api/v1/users', {
      token: admin.data.token, status: 503,
      body: { email: managedEmail, password, name: 'Synthetic Busy' },
    });
    assert.equal(await prisma.rbacUser.count({ where: { email: { in: [rejectedEmail, managedEmail] } } }), 0);
    assert.equal((await request('/health')).status, 'ok');
  } finally {
    releasePasswordWork();
    await Promise.all(busy);
  }
  await request('/api/auth/login', { body: { email: newEmail, password } });
  console.log('API password work saturation passed: shared limit, no rejected writes, recovery and liveness.');
  // Exercise admin CRUD with the actual Prisma-generated identifier.
  for (const overLimit of ['x'.repeat(73), 'é'.repeat(37)]) {
    await request('/api/v1/users', {
      token: admin.data.token, status: 400,
      body: { email: managedEmail, password: overLimit, name: 'Synthetic Managed' },
    });
  }
  assert.equal(await prisma.rbacUser.count({ where: { email: managedEmail } }), 0);
  console.log('API new bcrypt password UTF-8 boundary and legacy login passed.');
  const managed = await request('/api/v1/users', {
    token: admin.data.token, status: 201,
    body: { email: managedEmail, password, name: 'Synthetic Managed' },
  });
  assert.equal(managed.data.role, 'INTERPRETER');
  assert.ok(!Object.hasOwn(managed.data, 'password'));
  const managedPath = '/api/v1/users/' + managed.data.id;
  assert.equal((await request(managedPath, { token: admin.data.token })).data.id, managed.data.id);
  await request(managedPath, { token: login.data.token, status: 401 });
  const initialManaged = await prisma.rbacUser.findUniqueOrThrow({ where: { id: managed.data.id } });
  for (const extra of [{ password: 'unhashed-value' }, { email: rejectedEmail }, { id: randomUUID() }, { createdAt: '2000-01-01T00:00:00Z' }]) {
    await request(managedPath, {
      method: 'PUT', token: admin.data.token, status: 400,
      body: { name: 'Must Not Change', ...extra },
    });
  }
  assert.deepEqual(await prisma.rbacUser.findUniqueOrThrow({ where: { id: managed.data.id } }), initialManaged);
  const edited = await request(managedPath, {
    method: 'PUT', token: admin.data.token, body: { name: 'Synthetic Updated', role: 'HOLDER' },
  });
  assert.equal(edited.data.name, 'Synthetic Updated');
  assert.equal(edited.data.role, 'HOLDER');
  assert.ok(!Object.hasOwn(edited.data, 'password'));
  await request(managedPath, { method: 'DELETE', token: admin.data.token, status: 204 });
  await request(managedPath, { token: admin.data.token, status: 404 });
  console.log('API admin CRUD passed: CUID, default role, strict mutation allowlist and deletion.');
  const retired = await request(legacyProductionPath, { body: legacyProductionBody, token: admin.data.token, status: 410 });
  assert.equal(retired.code, 'LEGACY_PRODUCTION_ENTRY_DISABLED');
  // Even administrator requests with malformed input get the retired contract.
  await request(legacyProductionPath, { body: {}, token: admin.data.token, status: 410 });
  // Demotion invalidates an administrator token before protected routes execute.
  await prisma.rbacUser.update({ where: { id: registered.data.id }, data: { role: 'INTERPRETER' } });
  await request('/api/v1/users', { token: admin.data.token, status: 401 });
  await request(legacyProductionPath, { body: legacyProductionBody, token: admin.data.token, status: 401 });
  console.log('Legacy Express production writer denied for anonymous, regular, admin and stale tokens.');
  // A role restored to its original value must not resurrect the old token.
  await request('/api/auth/me', { token: login.data.token, status: 401 });
  const renewed = await request('/api/auth/login', { body: { email: newEmail, password } });
  await request('/api/v1/users', { token: renewed.data.token, status: 403 });
  const session = await request('/api/auth/me', { token: renewed.data.token });
  assert.ok(!Object.hasOwn(session.data, 'password'));
  assert.ok(!Object.hasOwn(session.data, 'revision'));
  const oldRow = await prisma.rbacUser.findUniqueOrThrow({ where: { id: registered.data.id } });
  const replacement = 'Synthetic-Rotated-Password-2026!';
  // Even a password replacement preserving updatedAt invalidates the token.
  await prisma.rbacUser.update({
    where: { id: registered.data.id },
    data: { password: await bcrypt.hash(replacement, 10), updatedAt: oldRow.updatedAt },
  });
  await request('/api/auth/me', { token: renewed.data.token, status: 401 });
  await request('/api/auth/login', { body: { email: newEmail, password }, status: 401 });
  const rotated = await request('/api/auth/login', { body: { email: newEmail, password: replacement } });
  assert.equal((await request('/api/auth/me', { token: rotated.data.token })).data.id, registered.data.id);
  const oldFormat = jwt.sign({ id: registered.data.id, email: newEmail, role: 'INTERPRETER' },
    expectedSecret, { expiresIn: '8h' });
  await request('/api/auth/me', { token: oldFormat, status: 401 });
  await prisma.rbacUser.delete({ where: { id: registered.data.id } });
  await request('/api/auth/me', { token: rotated.data.token, status: 401 });
  console.log('API session revision checks passed: role restoration, password rotation and old-format token rejection.');
  await request('/api/auth/me', { token: renewed.data.token, status: 401 });
  await request('/api/v1/users', { token: admin.data.token, status: 401 });
  console.log('API live RBAC token checks passed: promotion, demotion and account deletion.');
  console.log('API HTTP auth smoke passed: legacy and new login, JWT, registration, RBAC, duplicate and bad credentials.');
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  try {
    await prisma.rbacUser.deleteMany({ where: { email: { in: [legacyEmail, newEmail, rejectedEmail, managedEmail, boundaryEmail, longLegacyEmail] } } });
  } finally {
    await prisma.$disconnect();
  }
}
