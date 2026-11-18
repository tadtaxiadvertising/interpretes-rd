// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_REGISTRATION_ROLE,
  registerSchema,
} from '../../../interpreters-api/src/modules/auth/auth.schemas';

const valid = {
  email: 'synthetic.person@example.test',
  password: 'SyntheticSafePassword2026!',
  name: 'Synthetic Applicant',
};

describe('public registration cannot mint privileged RBAC identities', () => {
  it('accepts a normal applicant without role and defaults privilege on the server', () => {
    expect(PUBLIC_REGISTRATION_ROLE).toBe('INTERPRETER');
    const result = registerSchema.safeParse({ body: valid });
    expect(result.success).toBe(true);
  });

  it('preserves explicit INTERPRETER for existing signup clients', () => {
    expect(registerSchema.safeParse({
      body: { ...valid, role: 'INTERPRETER' },
    }).success).toBe(true);
  });

  it.each(['ADMIN', 'HOLDER', 'admin', 'holder', 'OWNER', 'SUPERADMIN', ''])(
    'rejects requested privileged or unknown role %s', role => {
      expect(registerSchema.safeParse({ body: { ...valid, role } }).success).toBe(false);
    },
  );

  it('cannot grant ADMIN by bypassing request validation', () => {
    // The controller passes req.body without replacing it with Zod's parsed
    // result. The service therefore MUST ignore any client-supplied role even
    // if another caller accidentally skips the validation middleware.
    const service = readFileSync('interpreters-api/src/modules/auth/auth.service.ts', 'utf8');
    const createBody = service.split('static async register(')[1];
    expect(createBody).toBeTruthy();
    expect(createBody).toMatch(/role:\s*PUBLIC_REGISTRATION_ROLE/);
    expect(createBody).not.toMatch(/role:\s*role\s+as\s+any/);
    expect(createBody).not.toMatch(/const\s*{\s*email,\s*password,\s*name,\s*role\s*}/);
  });

  it('keeps the public endpoint unauthenticated but does not give it admin role options', () => {
    const routes = readFileSync('interpreters-api/src/modules/auth/auth.routes.ts', 'utf8');
    const schema = readFileSync('interpreters-api/src/modules/auth/auth.schemas.ts', 'utf8');
    expect(routes).toContain("router.post('/register', validate(registerSchema), AuthController.register)");
    expect(schema).toContain('z.literal(PUBLIC_REGISTRATION_ROLE).optional()');
    expect(schema).not.toContain("z.enum(['ADMIN', 'INTERPRETER', 'HOLDER']).default('INTERPRETER')");
  });
});
