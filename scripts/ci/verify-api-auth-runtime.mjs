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
const nonce = randomUUID();
const legacyEmail = 'legacy-' + nonce + '@example.test';
const newEmail = 'new-' + nonce + '@example.test';
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
  async function request(path, { body, token, status = 200 } = {}) {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    assert.equal(response.status, status, path + ' unexpected HTTP status');
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
  // Changing permissions must not silently upgrade an existing token.
  await prisma.rbacUser.update({ where: { id: registered.data.id }, data: { role: 'ADMIN' } });
  await request('/api/auth/me', { token: login.data.token, status: 401 });
  await request('/api/v1/users', { token: login.data.token, status: 401 });
  const admin = await request('/api/auth/login', { body: { email: newEmail, password } });
  assert.equal(admin.data.user.role, 'ADMIN');
  assert.equal((await request('/api/auth/me', { token: admin.data.token })).data.role, 'ADMIN');
  // Demotion invalidates an administrator token before protected routes execute.
  await prisma.rbacUser.update({ where: { id: registered.data.id }, data: { role: 'INTERPRETER' } });
  await request('/api/v1/users', { token: admin.data.token, status: 401 });
  const renewed = await request('/api/auth/login', { body: { email: newEmail, password } });
  await request('/api/v1/users', { token: renewed.data.token, status: 403 });
  await prisma.rbacUser.delete({ where: { id: registered.data.id } });
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
    await prisma.rbacUser.deleteMany({ where: { email: { in: [legacyEmail, newEmail, rejectedEmail] } } });
  } finally {
    await prisma.$disconnect();
  }
}
