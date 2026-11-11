import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actorFromBearer, requireApiActor } from '../api-auth';

const { supabaseGetUser, createSupabaseClient, getCurrentActor } = vi.hoisted(() => ({
  supabaseGetUser: vi.fn(),
  createSupabaseClient: vi.fn(),
  getCurrentActor: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createSupabaseClient,
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    userProfile: { findUnique: vi.fn() },
    interpreter: { findFirst: vi.fn() },
    recruitmentCandidate: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/auth/current-actor', () => ({
  getCurrentActor,
  resolveRecruitmentIdentity: async (email: string, fallbackRole: string, fallbackInterpreterId: number | null) => {
    const { default: prisma } = await import('@/lib/prisma');
    const candidate = await prisma.recruitmentCandidate.findUnique({
      where: { email },
      select: {
        id: true,
        applications: {
          select: { status: true, hiredInterpreterId: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    const application = candidate?.applications[0];
    if (fallbackRole === 'admin') {
      return { role: 'admin', candidateId: candidate?.id ?? null, interpreterId: null };
    }
    if (candidate && application?.status !== 'HIRED') {
      return { role: 'candidate', candidateId: candidate.id, interpreterId: null };
    }
    if (candidate && application?.status === 'HIRED') {
      return {
        role: 'interpreter',
        candidateId: candidate.id,
        interpreterId: application.hiredInterpreterId ?? fallbackInterpreterId,
      };
    }
    return { role: fallbackRole, candidateId: null, interpreterId: fallbackInterpreterId };
  },
}));

import prisma from '@/lib/prisma';

describe('API bearer identity resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    createSupabaseClient.mockReturnValue({ auth: { getUser: supabaseGetUser } });
    supabaseGetUser.mockResolvedValue({
      data: { user: { id: 'candidate-auth-id', email: 'candidate@example.com' } },
      error: null,
    });
    (prisma.userProfile.findUnique as any).mockResolvedValue(null);
    (prisma.interpreter.findFirst as any).mockResolvedValue(null);
    (prisma.recruitmentCandidate.findUnique as any).mockResolvedValue({
      id: 27,
      applications: [{ status: 'ROLEPLAY_PENDING', hiredInterpreterId: null }],
    });
    getCurrentActor.mockResolvedValue(null);
  });

  it('keeps an applicant without a profile classified as candidate for bearer APIs', async () => {
    const actor = await actorFromBearer(new Request('https://example.com/api/private', {
      headers: { authorization: 'Bearer valid-access-token' },
    }));

    expect(actor).toMatchObject({
      userId: 'candidate-auth-id',
      role: 'candidate',
      candidateId: 27,
      interpreterId: null,
    });
  });

  it('does not grant interpreter API access to an unapproved applicant', async () => {
    await expect(requireApiActor(new Request('https://example.com/api/private', {
      headers: { authorization: 'Bearer valid-access-token' },
    }), 'interpreter')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('restores interpreter identity only after recruitment marks the applicant hired', async () => {
    (prisma.userProfile.findUnique as any).mockResolvedValue({
      id: 'candidate-auth-id',
      role: 'candidate',
      interpreterId: null,
      email: 'candidate@example.com',
    });
    (prisma.recruitmentCandidate.findUnique as any).mockResolvedValue({
      id: 27,
      applications: [{ status: 'HIRED', hiredInterpreterId: 91 }],
    });

    const actor = await requireApiActor(new Request('https://example.com/api/private', {
      headers: { authorization: 'Bearer valid-access-token' },
    }), 'interpreter');

    expect(actor).toMatchObject({
      role: 'interpreter',
      candidateId: 27,
      interpreterId: 91,
    });
  });
});
