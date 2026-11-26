import { z } from 'zod';

// Explicit units avoid jsonwebtoken's surprising interpretation of a bare
// numeric string as milliseconds. Convert to numeric seconds exactly once.
const units = { s: 1, m: 60, h: 3600, d: 86400 } as const;
const lifetime = z.string().default('8h').pipe(
  z.string().regex(/^[1-9][0-9]{0,6}[smhd]$/).transform(value =>
    Number(value.slice(0, -1)) * units[value.slice(-1) as keyof typeof units],
  ).refine(seconds => seconds <= 7 * 86400, 'JWT lifetime must not exceed seven days'),
);

const schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(8),
  JWT_EXPIRES_IN: lifetime,
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' &&
      (Buffer.byteLength(env.JWT_SECRET, 'utf8') < 32 || /\s/.test(env.JWT_SECRET))) {
    ctx.addIssue({
      code: 'custom', path: ['JWT_SECRET'],
      message: 'Production JWT secret must be at least 32 bytes without whitespace',
    });
  }
});

const safeFields = new Set(['DATABASE_URL', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'PORT', 'NODE_ENV']);

export function parseApiRuntimeEnv(input: Record<string, unknown>) {
  const result = schema.safeParse(input);
  if (result.success) return { success: true as const, data: result.data };
  // Never log the Zod error itself, invalid values, or arbitrary paths.
  const fields = [...new Set(result.error.issues.map(issue => {
    const field = issue.path[0];
    return typeof field === 'string' && safeFields.has(field) ? field : 'CONFIGURATION';
  }))].sort();
  return { success: false as const, fields };
}
