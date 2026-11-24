// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => ({
  mkdtemp: mocks.mkdtemp,
  writeFile: mocks.writeFile,
  rm: mocks.rm,
}));

const config = {
  OPERATIONAL_EMAIL_ENABLED: 'true',
  OPERATIONAL_SMTP_HOST: 'smtp.example.test',
  OPERATIONAL_SMTP_PORT: '587',
  OPERATIONAL_SMTP_USER: 'office@example.test',
  OPERATIONAL_SMTP_PASSWORD: 'test-only-secret',
  OPERATIONAL_EMAIL_FROM: 'office@example.test',
};

function simulateCurl(exitCode: number) {
  const child = new EventEmitter();
  const stdin = new EventEmitter();
  const end = vi.fn(() => queueMicrotask(() => child.emit('close', exitCode)));
  mocks.spawn.mockReturnValue(Object.assign(child, {
    stdin: Object.assign(stdin, { end }),
    kill: vi.fn(),
  }));
  return end;
}

describe('controlled SMTP test process', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    for (const [key, value] of Object.entries(config)) vi.stubEnv(key, value);
    vi.stubEnv('OPERATIONAL_EMAIL_REPLY_TO', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'unrelated-private-value');
    mocks.mkdtemp.mockResolvedValue('/tmp/ird-mail-test-example');
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses an explicit minimal environment, TLS and stdin credentials', async () => {
    const end = simulateCurl(0);
    const { sendOperationalMailTest } = await import('./smtp-test');
    expect(await sendOperationalMailTest()).toBe('accepted');
    const [command, args, options] = mocks.spawn.mock.calls[0];
    expect(command).toBe('curl');
    expect(args).toEqual(expect.arrayContaining(['-q', '--config', '-', '--ssl-reqd', '--noproxy', '*']));
    expect(options.env).toEqual({ PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production' });
    expect(options.shell).toBe(false);
    expect(JSON.stringify([args, options])).not.toContain(config.OPERATIONAL_SMTP_PASSWORD);
    expect(JSON.stringify(options)).not.toContain('unrelated-private-value');
    expect(end).toHaveBeenCalledWith(expect.stringContaining(config.OPERATIONAL_SMTP_PASSWORD));
    expect(mocks.writeFile).toHaveBeenCalledWith(expect.any(String), expect.any(String), { mode: 0o600, flag: 'wx' });
    expect(mocks.rm).toHaveBeenCalledWith('/tmp/ird-mail-test-example', { recursive: true, force: true });
    expect(await sendOperationalMailTest()).toBe('rate_limited');
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('reports a nonzero exit as unconfirmed and removes the temporary message', async () => {
    simulateCurl(1);
    const { sendOperationalMailTest } = await import('./smtp-test');
    expect(await sendOperationalMailTest()).toBe('unconfirmed');
    expect(mocks.rm).toHaveBeenCalledTimes(1);
  });

  it('does not start a process when sending is disabled', async () => {
    vi.stubEnv('OPERATIONAL_EMAIL_ENABLED', 'false');
    const { sendOperationalMailTest } = await import('./smtp-test');
    expect(await sendOperationalMailTest()).toBe('disabled');
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.mkdtemp).not.toHaveBeenCalled();
  });
});
