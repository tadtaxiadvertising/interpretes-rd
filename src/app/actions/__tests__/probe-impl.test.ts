import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: async () => ({ user: null, profile: null }) }));
vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: async (cb: any) => cb({ roleplayScenario: { findFirst: m.findFirst } }),
  },
}));

import { confirmRoleplayResponse } from '@/app/actions/roleplay';

describe('probe impl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findFirst.mockImplementation(async () => ({ id: 'scn-0' }));
  });

  it('test impl sticks', async () => {
    const r = await m.findFirst();
    console.log('RETURNED', JSON.stringify(r));
    expect(r.id).toBe('scn-0');
  });
}
);

m.findFirst.mockImplementation(async () => ({ id: 'scn-1' }));
console.log('AFTER TEST', m.findFirst());
