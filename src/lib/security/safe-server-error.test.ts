import { describe, expect, it } from 'vitest';
import { safeServerErrorCategory } from './safe-server-error';

describe('safe server error categories', () => {
  it('does not include secret content from error messages, stacks or custom names', () => {
    const error = new Error('postgresql://private:PRIVATE_PASSWORD@internal.invalid');
    error.name = 'Bearer PRIVATE_AUTH_TOKEN';
    error.stack = 'https://storage.invalid?token=PRIVATE_AUDIO_TOKEN';
    expect(safeServerErrorCategory(error)).toBe('Error');
    expect(safeServerErrorCategory(error)).not.toMatch(/PRIVATE_|postgresql|storage\.invalid/);
  });

  it('redacts authentication-provider errors containing account identifiers and reset tokens', () => {
    const error = new Error('Failed for private.user@example.test; token=PRIVATE_RESET_TOKEN');
    error.name = 'AuthError:PRIVATE_RESET_TOKEN';
    const category = safeServerErrorCategory(error);
    expect(category).toBe('Error');
    expect(category).not.toContain('private.user@example.test');
    expect(category).not.toContain('PRIVATE_RESET_TOKEN');
    expect(category).not.toContain('AuthError:');
  });

  it('does not serialize arbitrary thrown objects', () => {
    expect(safeServerErrorCategory({ message: 'PRIVATE_DATABASE_PASSWORD' }))
      .toBe('UnknownError');
    expect(safeServerErrorCategory('PRIVATE_DATABASE_PASSWORD')).toBe('UnknownError');
    expect(safeServerErrorCategory(null)).toBe('UnknownError');
  });
});
