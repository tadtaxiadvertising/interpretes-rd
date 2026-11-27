// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseApiRuntimeEnv } from '../../../interpreters-api/src/config/runtime-env-policy';

const base = {
  DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5432/test',
  JWT_SECRET: 'synthetic-test-only-secret-at-least-32-bytes',
  NODE_ENV: 'production',
};
describe('Express runtime JWT configuration', () => {
  it.each([['8h', 28800], ['480m', 28800], ['1s', 1], ['7d', 604800]])(
    'converts %s to seconds', (raw, seconds) => {
      expect(parseApiRuntimeEnv({ ...base, JWT_EXPIRES_IN: raw })).toMatchObject({
        success: true, data: { JWT_EXPIRES_IN: seconds },
      });
    },
  );
  it('defaults to eight hours', () => {
    expect(parseApiRuntimeEnv(base)).toMatchObject({ success: true, data: { JWT_EXPIRES_IN: 28800 } });
  });
  it.each(['3600', '0s', '-1h', '8d', '168h1m', '1.5h', '8H', ' 8h', 'secret-value'])(
    'rejects invalid or ambiguous lifetime', raw => {
      expect(parseApiRuntimeEnv({ ...base, JWT_EXPIRES_IN: raw })).toEqual({
        success: false, fields: ['JWT_EXPIRES_IN'],
      });
    },
  );
  it('rejects short or whitespace-containing production secrets without echoing values', () => {
    for (const JWT_SECRET of ['shortkey', 'x'.repeat(31), 'x'.repeat(32) + ' ']) {
      expect(parseApiRuntimeEnv({ ...base, JWT_SECRET })).toEqual({ success: false, fields: ['JWT_SECRET'] });
    }
  });
  it('keeps the existing development minimum and rejects invalid envs without disclosing values', () => {
    expect(parseApiRuntimeEnv({ ...base, NODE_ENV: 'test', JWT_SECRET: 'shortkey' })).toMatchObject({ success: true });
    expect(parseApiRuntimeEnv({ ...base, DATABASE_URL: 'synthetic-private-value' })).toEqual({ success: false, fields: ['DATABASE_URL'] });
  });
});
