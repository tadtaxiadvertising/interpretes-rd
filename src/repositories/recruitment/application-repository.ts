import prisma from '@/lib/prisma';
import type { RecruitmentEventType } from '@/lib/prisma-types';

const db = prisma;

export const applicationRepository = {
  async findByCandidateId(candidateId: number) {
    return db.recruitmentApplication.findUnique({
      where: { candidateId },
      include: {
        access: true,
        documents: true,
        interviews: true,
        offers: true,
        contracts: true,
        banking: true,
        techSetup: true,
        training: true,
      },
    });
  },

  async findById(id: string) {
    return db.recruitmentApplication.findUnique({
      where: { id },
      include: {
        access: true,
        documents: true,
        interviews: true,
        offers: true,
        contracts: true,
        banking: true,
        techSetup: true,
        training: true,
        hiredInterpreter: true,
      },
    });
  },

  async getOrCreate(candidateId: number) {
    // Try to find existing active application
    let application = await db.recruitmentApplication.findUnique({
      where: { candidateId },
    });

    if (application) {
      return application;
    }

    // Create new application
    application = await db.recruitmentApplication.create({
      data: {
        candidateId,
        status: 'APPLIED',
        currentStep: 'APPLICATION',
        version: 1,
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });

    // Create access token
    const { randomBytes, createHash } = await import('crypto');
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await db.recruitmentAccess.create({
      data: {
        applicationId: application.id,
        tokenHash,
        expiresAt,
      },
    });

    // Log event
    await db.recruitmentEvent.create({
      data: {
        applicationId: application.id,
        eventType: 'APPLICATION_CREATED',
        fromStatus: null,
        toStatus: 'APPLIED',
        actorType: 'system',
        actorId: 'system',
      },
    });

    return application;
  },

  async advanceStep(
    applicationId: string,
    expectedStatus: string,
    newStatus: string,
    newStep: string,
    actorId: string,
    actorType: 'candidate' | 'admin' | 'system',
    eventType: RecruitmentEventType,
    metadata?: any
  ) {
    return db.$transaction(async (tx) => {
      // Lock the application row and check expected status
      const application = await tx.recruitmentApplication.findUnique({
        where: { id: applicationId },
      });

      if (!application) {
        throw new Error('Application not found');
      }

      if (application.status !== expectedStatus) {
        throw new Error(`Invalid transition: expected ${expectedStatus}, current is ${application.status}`);
      }

      const fromStatus = application.status;
      const updated = await tx.recruitmentApplication.update({
        where: {
          id: applicationId,
          version: application.version, // Optimistic locking
        },
        data: {
          status: newStatus as any,
          currentStep: newStep as any,
          version: application.version + 1,
          lastActivityAt: new Date(),
          lastActorId: actorId,
          completedAt: ['HIRED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'].includes(newStatus) ? new Date() : null,
        },
      });

      // Log event
      await tx.recruitmentEvent.create({
        data: {
          applicationId,
          eventType,
          fromStatus: fromStatus as any,
          toStatus: newStatus as any,
          actorType,
          actorId,
          metadata,
        },
      });

      return updated;
    });
  },

  async updateLastActivity(applicationId: string) {
    return db.recruitmentApplication.update({
      where: { id: applicationId },
      data: { lastActivityAt: new Date() },
    });
  },

  async setLastUsed(applicationId: string) {
    return db.recruitmentAccess.update({
      where: { applicationId },
      data: { lastUsedAt: new Date() },
    });
  },

  async findForAdminDashboard(filters: {
    status?: string;
    step?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { status, step, search, page = 1, pageSize = 20 } = filters;
    
    const where: any = {};
    if (status) where.status = status;
    if (step) where.currentStep = step;
    if (search) {
      where.OR = [
        { candidate: { name: { contains: search, mode: 'insensitive' } } },
        { candidate: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      db.recruitmentApplication.findMany({
        where,
        include: {
          candidate: { 
            select: { 
              id: true, 
              name: true, 
              email: true, 
              telefono: true, 
              pais: true,
              roleplaySessions: { select: { id: true, status: true, qaScoreId: true } }
            } 
          },
          access: { select: { inviteCode: true, expiresAt: true, lastUsedAt: true } },
        },
        orderBy: { lastActivityAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.recruitmentApplication.count({ where }),
    ]);

    return { items, total, page, pageSize };
  },

  async getPipelineStats() {
    const [byStatus, byStep, stuck] = await Promise.all([
      db.recruitmentApplication.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      db.recruitmentApplication.groupBy({
        by: ['currentStep'],
        _count: { currentStep: true },
      }),
      db.recruitmentApplication.findMany({
        where: {
          lastActivityAt: {
            lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days
          },
          status: {
            notIn: ['HIRED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
          },
        },
        include: {
          candidate: { select: { name: true, email: true } },
        },
        take: 20,
      }),
    ]);

    return { byStatus, byStep, stuck };
  },

  async setHiredInterpreter(applicationId: string, interpreterId: number) {
    return db.recruitmentApplication.update({
      where: { id: applicationId },
      data: {
        hiredInterpreterId: interpreterId,
        status: 'HIRED',
        currentStep: 'HIRING',
        completedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });
  },
};