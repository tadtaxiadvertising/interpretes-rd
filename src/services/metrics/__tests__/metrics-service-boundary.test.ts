import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('private metrics service boundary', () => {
  it('never registers unauthenticated database mutations as exported Server Actions', () => {
    const source = readFileSync('src/services/metrics/metrics-service.ts', 'utf8');
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .trimStart();
    expect(withoutComments).not.toMatch(/^(['"])use server\1\s*;/);
    // The service still exposes trusted internal data mutations. They must
    // only be reachable through an explicitly authenticated API or action.
    expect(source).toContain('export async function updateInterpreterMetrics');
    expect(source).toContain('export async function recalculateRankings');
    expect(source).toContain('export async function refreshAllMetrics');
  });
});
