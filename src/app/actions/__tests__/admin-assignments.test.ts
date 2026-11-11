import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInterpreterAssignment } from '../admin-assignments';

const { prismaMock, getCurrentProfileMock } = vi.hoisted(() => ({
  prismaMock: {
    interpreter: { findFirst: vi.fn() },
    interpreterAccountAssignment: { create: vi.fn() },
  },
  getCurrentProfileMock: vi.fn(),
}));

vi.mock('@/app/actions/auth', () => ({ getCurrentProfile: getCurrentProfileMock }));
vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

function makeForm(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

const validForm = () => makeForm({
  interpreterId: '7',
  accountId: '12',
  startsAt: '2026-11-11',
  endsAt: '',
  notes: 'Production assignment',
});

describe('interpreter account assignment authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentProfileMock.mockResolvedValue({ id: 'admin-profile', role: 'admin' });
    prismaMock.interpreter.findFirst.mockResolvedValue({ id: 7 });
    prismaMock.interpreterAccountAssignment.create.mockResolvedValue({ id: 1 });
  });

  it('rejects non-admin users before querying or creating assignments', async () => {
    getCurrentProfileMock.mockResolvedValue(null);

    const result = await createInterpreterAssignment(validForm());

    expect(result.success).toBe(false);
    expect(prismaMock.interpreter.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.interpreterAccountAssignment.create).not.toHaveBeenCalled();
  });

  it('rejects candidates and inactive interpreter profiles', async () => {
    prismaMock.interpreter.findFirst.mockResolvedValue(null);

    const result = await createInterpreterAssignment(validForm());

    expect(result).toMatchObject({
      success: false,
      error: 'Solo se pueden asignar intérpretes activos. Los candidatos aún no están habilitados para producción.',
    });
    expect(prismaMock.interpreter.findFirst).toHaveBeenCalledWith({
      where: { id: 7, status: 'Activo' },
      select: { id: true },
    });
    expect(prismaMock.interpreterAccountAssignment.create).not.toHaveBeenCalled();
  });

  it('creates an assignment for an active interpreter with normalized date values', async () => {
    const result = await createInterpreterAssignment(validForm());

    expect(result.success).toBe(true);
    expect(prismaMock.interpreterAccountAssignment.create).toHaveBeenCalledWith({
      data: {
        interpreterId: 7,
        accountId: 12,
        startsAt: new Date('2026-11-11T00:00:00.000Z'),
        endsAt: null,
        notes: 'Production assignment',
      },
    });
  });

  it('rejects an end date earlier than the start date', async () => {
    const result = await createInterpreterAssignment(makeForm({
      interpreterId: '7',
      accountId: '12',
      startsAt: '2026-11-12',
      endsAt: '2026-11-11',
      notes: '',
    }));

    expect(result.success).toBe(false);
    expect(prismaMock.interpreter.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.interpreterAccountAssignment.create).not.toHaveBeenCalled();
  });
});
