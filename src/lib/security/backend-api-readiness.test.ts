// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createCachedReadinessProbe } from '../../../interpreters-api/src/lib/readiness';

describe('dedicated Express API database readiness', () => {
  it('reports failure and recovers when PostgreSQL becomes reachable', async () => {
    let time = 10_000;
    const check = vi.fn().mockRejectedValueOnce(new Error('synthetic unavailable'))
      .mockResolvedValue(undefined);
    const ready = createCachedReadinessProbe(check, () => time);
    expect(await ready()).toBe(false);
    expect(await ready()).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
    time += 2_001;
    expect(await ready()).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('caches healthy results for 10s but detects subsequent database failures', async () => {
    let time = 0;
    const check = vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('synthetic disconnect'));
    const ready = createCachedReadinessProbe(check, () => time);
    expect(await ready()).toBe(true);
    time = 9_999;
    expect(await ready()).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    time = 10_000;
    expect(await ready()).toBe(false);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent readiness calls into one database query', async () => {
    let finish: (() => void) | undefined;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const check = vi.fn(() => blocked);
    const ready = createCachedReadinessProbe(check);
    const first = ready();
    const second = ready();
    expect(first).toBe(second);
    await Promise.resolve();
    expect(check).toHaveBeenCalledTimes(1);
    finish?.();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(await ready()).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('recovers safely if the system clock moves backward', async () => {
    let now = 50_000;
    const check = vi.fn().mockResolvedValue(undefined);
    const ready = createCachedReadinessProbe(check, () => now);
    expect(await ready()).toBe(true);
    now = 12_000;
    expect(await ready()).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('Docker/Easypanel uses readiness, not a misleading liveness check', () => {
    const docker = readFileSync('Dockerfile.api', 'utf8');
    const app = readFileSync('interpreters-api/src/app.ts', 'utf8');
    expect(docker).toMatch(/HEALTHCHECK[^\n]*start-period=60s/);
    expect(docker).toContain('/ready');
    expect(docker).not.toMatch(/HEALTHCHECK[^\n]*\n\s*CMD[^\n]*\/health/);
    expect(app).toContain("app.get('/health'");
    // Keep the preexisting monitor payload stable while splitting readiness.
    const liveness = app.split("app.get('/health'")[1].split("app.get('/ready'")[0];
    expect(liveness).toContain("status: 'ok'");
    expect(liveness).toContain('timestamp: new Date().toISOString()');
    expect(liveness).toContain('uptime: Math.floor(process.uptime())');
    expect(app).toContain("app.get('/ready'");
    expect(app).toContain('await prisma.$queryRaw`SELECT 1`');
    expect(app).toContain('res.status(ready ? 200 : 503)');
    expect(app).not.toContain('_req.originalUrl} not found');
  });
});
