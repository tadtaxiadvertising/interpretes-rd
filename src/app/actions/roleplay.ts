'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { revalidatePath } from 'next/cache';
import { createSignedUploadUrl, getBaseAudioPath, getResponseAudioPath, confirmUpload, validateAudioFile } from '@/lib/roleplay';
import { createNotification } from './notifications';
import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';
import { cookies } from 'next/headers';

const db = prisma;

const CreateRoleplaySessionSchema = z.object({
  interpreterId: z.number().int().positive().optional(),
  recruitmentCandidateId: z.number().int().positive().optional(),
  baseAudioMimeType: z.string(),
  baseAudioSize: z.number().int().positive().max(15 * 1024 * 1024),
});

export type CreateRoleplaySessionInput = z.infer<typeof CreateRoleplaySessionSchema>;

export async function createRoleplaySession(rawInput: CreateRoleplaySessionInput) {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parseResult = CreateRoleplaySessionSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
  const input = parseResult.data;

  if (!input.interpreterId && !input.recruitmentCandidateId) {
    return { success: false, error: 'Must assign to either interpreter or candidate', code: 'VALIDATION_ERROR' };
  }
  if (input.interpreterId && input.recruitmentCandidateId) {
    return { success: false, error: 'Cannot assign to both interpreter and candidate', code: 'VALIDATION_ERROR' };
  }

  const validation = validateAudioFile(new File([], 'test', { type: input.baseAudioMimeType, }));
  if (!validation.valid || !validation.extension) {
    return { success: false, error: validation.error, code: 'VALIDATION_ERROR' };
  }

  try {
    const session = await db.roleplaySession.create({
      data: {
        interpreterId: input.interpreterId ?? null,
        recruitmentCandidateId: input.recruitmentCandidateId ?? null,
        baseAudioUrl: getBaseAudioPath('', validation.extension), // placeholder, will update after upload
        status: 'DRAFT',
      },
      select: { id: true },
    });

    const baseAudioPath = getBaseAudioPath(session.id, validation.extension);
    
    await db.roleplaySession.update({
      where: { id: session.id },
      data: { baseAudioUrl: baseAudioPath },
    });

    const uploadResult = await createSignedUploadUrl(session.id, input.baseAudioMimeType, true);

    if (input.recruitmentCandidateId) {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await db.roleplayAccess.create({
        data: {
          sessionId: session.id,
          tokenHash,
          expiresAt,
        },
      });

      return { 
        success: true, 
        data: { 
          sessionId: session.id,
          uploadUrl: uploadResult.uploadUrl,
          uploadPath: uploadResult.path,
          inviteToken: rawToken,
        } 
      };
    }

    return { 
      success: true, 
      data: { 
        sessionId: session.id,
        uploadUrl: uploadResult.uploadUrl,
        uploadPath: uploadResult.path,
      } 
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Create Roleplay Session Error:', message);
    return { success: false, error: message, code: 'INTERNAL_ERROR' };
  }
}

export async function confirmBaseAudioUpload(sessionId: string, uploadPath: string) {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const signedUrl = await confirmUpload(uploadPath);
    
    await db.roleplaySession.update({
      where: { id: sessionId },
      data: { baseAudioUrl: signedUrl },
    });

    revalidatePath('/admin/roleplays');
    return { success: true, data: { baseAudioUrl: signedUrl } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Confirm Base Audio Error:', message);
    return { success: false, error: message };
  }
}

const SubmitResponseSchema = z.object({
  sessionId: z.string().min(1),
  scenarioId: z.string().min(1).optional(),
});

export type SubmitResponseInput = z.infer<typeof SubmitResponseSchema>;

export async function submitRoleplayResponse(rawInput: SubmitResponseInput) {
  const auth = await validateAction('interpreter');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parseResult = SubmitResponseSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
  const input = parseResult.data;

  try {
    const session = await db.roleplaySession.findUnique({
      where: { id: input.sessionId },
      select: { 
        id: true, 
        recordedAudioUrl: true, 
        interpreterId: true, 
        recruitmentCandidateId: true, 
        status: true,
        currentScenarioIndex: true,
      },
    });

    if (!session) {
      return { success: false, error: 'Session not found', code: 'NOT_FOUND' };
    }

    const validSubmitStates = ['INVITED', 'STARTED', 'IN_PROGRESS', 'PENDING'];
    if (!validSubmitStates.includes(session.status)) {
      return { success: false, error: 'Session is not in a state that allows submitting responses', code: 'INVALID_STATE' };
    }

    if (session.recordedAudioUrl) {
      return { success: false, error: 'Response already submitted', code: 'ALREADY_SUBMITTED' };
    }

    const sessionCookie = (await cookies()).get('roleplay_session')?.value ?? null;

    if (session.interpreterId) {
      if (session.interpreterId !== auth.profile?.interpreterId) {
        return { success: false, error: 'Unauthorized', code: 'FORBIDDEN' };
      }
    } else if (session.recruitmentCandidateId) {
      if (sessionCookie !== session.id) {
        return { success: false, error: 'Unauthorized', code: 'FORBIDDEN' };
      }
    } else {
      return { success: false, error: 'Unauthorized', code: 'FORBIDDEN' };
    }

    // Client will upload directly to /api/roleplay/convert-audio
    // We just return success and the session info for the client to call the API
    const scenarioId = input.scenarioId || `scenario_${session.currentScenarioIndex}`;

    return { 
      success: true, 
      data: { 
        sessionId: session.id,
        scenarioId,
        convertApiUrl: '/api/roleplay/convert-audio',
      } 
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Submit Response Error:', message);
    return { success: false, error: message, code: 'INTERNAL_ERROR' };
  }
}

const ConfirmResponseSchema = z.object({
  sessionId: z.string().min(1),
  scenarioId: z.string().min(1).optional(),
  recordedAudioUrl: z.string().min(1),
});

export type ConfirmResponseInput = z.infer<typeof ConfirmResponseSchema>;

export async function confirmRoleplayResponse(rawInput: ConfirmResponseInput) {
  const auth = await validateAction('interpreter');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parseResult = ConfirmResponseSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
  const input = parseResult.data;

  const sessionCookie = (await cookies()).get('roleplay_session')?.value ?? null;

  try {
    const result = await db.$transaction(async (tx) => {
      const session = await tx.roleplaySession.findUnique({
        where: { id: input.sessionId },
        select: { 
          id: true, 
          recordedAudioUrl: true, 
          interpreterId: true, 
          recruitmentCandidateId: true, 
          status: true,
          currentScenarioIndex: true,
        },
      });

      const validSubmitStates = ['INVITED', 'STARTED', 'IN_PROGRESS', 'PENDING'];
      if (!session || !validSubmitStates.includes(session.status) || session.recordedAudioUrl) {
        throw new Error('Session not available for submission');
      }

      // Interpreter sessions are bound to the resolved interpreter id.
      // Candidate sessions are bound to the opaque, server-issued
      // roleplay_session cookie created by the invite/start flow: an
      // authenticated user alone is not sufficient.
      if (session.interpreterId) {
        if (session.interpreterId !== auth.profile?.interpreterId) {
          throw new Error('Unauthorized');
        }
      } else if (session.recruitmentCandidateId) {
        if (sessionCookie !== session.id) {
          throw new Error('Unauthorized');
        }
      } else {
        throw new Error('Unauthorized');
      }

      const scenarioId = input.scenarioId || `scenario_${session.currentScenarioIndex}`;

      const updated = await tx.roleplaySession.update({
        where: { 
          id: input.sessionId,
          recordedAudioUrl: null,
        },
        data: {
          recordedAudioUrl: input.recordedAudioUrl,
          submittedAt: new Date(),
          currentScenarioIndex: { increment: 1 },
        },
        select: { id: true },
      });

      if (!updated) {
        throw new Error('Concurrent submission detected');
      }

      return { recordedAudioUrl: input.recordedAudioUrl };
    });

    revalidatePath('/dashboard/roleplays');
    revalidatePath('/admin/roleplays');
    return { success: true, data: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Confirm Response Error:', message);
    return { success: false, error: message, code: 'INTERNAL_ERROR' };
  }
}

async function deleteAudio(path: string) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    await supabaseAdmin.storage.from('roleplay-audio').remove([path]);
  } catch {}
}

const ValidateInviteTokenSchema = z.object({
  token: z.string().min(1),
});

export type ValidateInviteTokenInput = z.infer<typeof ValidateInviteTokenSchema>;

export async function validateInviteToken(rawInput: ValidateInviteTokenInput) {
  const parseResult = ValidateInviteTokenSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid token', code: 'VALIDATION_ERROR' };
  const { token } = parseResult.data;

  const tokenHash = createHash('sha256').update(token).digest('hex');

  try {
    const access = await db.roleplayAccess.findFirst({
      where: { tokenHash },
      include: { session: true },
    });

    if (!access) {
      return { success: false, error: 'Invalid or expired invitation', code: 'INVALID_TOKEN' };
    }

    if (access.usedAt) {
      return { success: false, error: 'Invitation already used', code: 'TOKEN_USED' };
    }

    if (access.expiresAt < new Date()) {
      return { success: false, error: 'Invitation expired', code: 'TOKEN_EXPIRED' };
    }

    const validInviteStates = ['DRAFT', 'INVITED', 'PENDING'];
    if (!validInviteStates.includes(access.session.status)) {
      return { success: false, error: 'Session no longer available', code: 'INVALID_STATE' };
    }

    // Validate only - do NOT consume token
    // Token will be consumed when user actually starts the roleplay
    const cookieStore = await cookies();
    cookieStore.set('roleplay_session', access.session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours
      path: '/',
    });

    return { 
      success: true, 
      data: { 
        sessionId: access.session.id,
        baseAudioUrl: access.session.baseAudioUrl,
        candidateName: access.session.recruitmentCandidateId ? 'Candidate' : undefined,
      } 
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Validate Invite Token Error:', message);
    return { success: false, error: message, code: 'INTERNAL_ERROR' };
  }
}

const EvaluateRoleplaySchema = z.object({
  sessionId: z.string().min(1),
  protocolScore: z.number().min(0).max(100),
  interpretationScore: z.number().min(0).max(100),
  languageScore: z.number().min(0).max(100),
  serviceScore: z.number().min(0).max(100),
  technicalScore: z.number().min(0).max(100),
  criticalError: z.boolean(),
  comments: z.string().optional(),
});

export type EvaluateRoleplayInput = z.infer<typeof EvaluateRoleplaySchema>;

export async function evaluateRoleplay(_prevState: any, formData: FormData) {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  // Parse form data
  const rawInput = {
    sessionId: formData.get('sessionId') as string,
    protocolScore: parseInt(formData.get('protocolScore') as string) || 0,
    interpretationScore: parseInt(formData.get('interpretationScore') as string) || 0,
    languageScore: parseInt(formData.get('languageScore') as string) || 0,
    serviceScore: parseInt(formData.get('serviceScore') as string) || 0,
    technicalScore: parseInt(formData.get('technicalScore') as string) || 0,
    criticalError: formData.get('criticalError') === 'on',
    comments: formData.get('comments') as string || '',
  };

  const parseResult = EvaluateRoleplaySchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
  const input = parseResult.data;

  let totalScore = 0;
  if (input.criticalError) {
    totalScore = 0;
  } else {
    totalScore = 
      (input.protocolScore * 0.20) +
      (input.interpretationScore * 0.40) +
      (input.languageScore * 0.20) +
      (input.serviceScore * 0.10) +
      (input.technicalScore * 0.10);
  }

  let actionRequired = 'Ninguna';
  if (input.criticalError || totalScore < 70) {
    actionRequired = 'Advertencia / Coaching';
  } else if (totalScore < 85) {
    actionRequired = 'Feedback Requerido';
  }

  const auditorEmail = auth.user.email || 'System';

  try {
    const result = await db.$transaction(async (tx) => {
      const session = await tx.roleplaySession.findUnique({
        where: { id: input.sessionId },
        select: { 
          id: true, 
          qaScoreId: true, 
          recordedAudioUrl: true, 
          recruitmentCandidateId: true,
          interpreterId: true,
        },
      });

      if (!session) throw new Error('Session not found');
      if (session.qaScoreId) throw new Error('Session already evaluated');
      if (!session.recordedAudioUrl) throw new Error('No response submitted yet');

      const updated = await tx.roleplaySession.update({
        where: { 
          id: input.sessionId,
          qaScoreId: null as any,
          recordedAudioUrl: { not: null },
        },
        data: { evaluatorId: auth.user.userId },
        select: { id: true },
      });

      if (!updated) {
        throw new Error('Concurrent evaluation detected or session not available');
      }

      const qaScore = await tx.qAScore.create({
        data: {
          interpreterId: session.interpreterId ?? null,
          auditDate: new Date(),
          auditor: auditorEmail,
          protocolScore: input.protocolScore,
          interpretationScore: input.interpretationScore,
          languageScore: input.languageScore,
          serviceScore: input.serviceScore,
          technicalScore: input.technicalScore,
          criticalError: input.criticalError,
          comentarios: input.comments,
          accionRequerida: actionRequired,
        },
        select: { id: true, totalScore: true },
      });

      await tx.roleplaySession.update({
        where: { id: input.sessionId },
        data: { 
          qaScoreId: qaScore.id,
          evaluatedAt: new Date(),
          status: 'EVALUATED',
        },
      });

      if (session.recruitmentCandidateId) {
        await tx.recruitmentCandidate.update({
          where: { id: session.recruitmentCandidateId },
          data: { resultRoleplay: Math.round(totalScore) },
        });
      }

      return { qaScoreId: qaScore.id, totalScore: Math.round(totalScore * 100) / 100, actionRequired, interpreterId: session.interpreterId };
    });

    // Send notification to interpreter if this was an interpreter session
    if (result.interpreterId) {
      try {
        const interpreter = await db.interpreter.findUnique({
          where: { id: result.interpreterId },
          select: { emailCorporativo: true, name: true },
        });

        if (interpreter?.emailCorporativo) {
          const profile = await db.userProfile.findUnique({
            where: { email: interpreter.emailCorporativo },
            select: { id: true },
          });

          if (profile) {
            const scoreDisplay = result.totalScore.toFixed(1);
            await createNotification({
              userId: profile.id,
              title: 'Roleplay Evaluado',
              message: `Tu roleplay "${interpreter.name}" fue evaluado: ${scoreDisplay}%. Acción: ${result.actionRequired}`,
              type: result.totalScore >= 85 ? 'success' : (result.totalScore >= 70 ? 'info' : 'warning'),
              link: `/dashboard/roleplays`,
            });
          }
        }
      } catch (notifyErr: unknown) {
        const message = notifyErr instanceof Error ? notifyErr.message : 'Unknown error';
        console.error('Notification failed but roleplay evaluation saved:', message);
      }
    }

    revalidatePath('/admin/roleplays');
    revalidatePath('/admin/recruitment');
    revalidatePath('/qa');
    revalidatePath('/dashboard/roleplays');
    return { success: true, data: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Evaluate Roleplay Error:', message);
    return { success: false, error: message, code: 'INTERNAL_ERROR' };
  }
}