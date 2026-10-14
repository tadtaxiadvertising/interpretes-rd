'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ActionResult } from '@/lib/types';
import { validateAction } from '@/lib/auth/actions';
import { ApplicantSchema, ApplicantData } from '@/lib/validators/recruitment';

const db = prisma;

/**
 * ACTION: Submit Application (Public - no auth required)
 * Inserts a new candidate into the recruitment funnel with status "Aplicante"
 */
export async function submitApplicationAction(data: ApplicantData) {
  try {
    // 1. Strict Zod validation
    const parsed = ApplicantSchema.parse(data);

    // 2. Database operation using Singleton (Transaction Pooler - port 6543)
    // Insert into funnel as "Aplicante" initial status
    const candidate = await db.recruitmentCandidate.create({
      data: {
        name: parsed.name,
        email: parsed.email,
        telefono: parsed.phone,
        pais: parsed.country,
        englishLevel: parsed.englishLevel,
        speedtestMbps: parsed.speedtestMbps,
        // Store EFSET link and CV URL in a JSON field or extend schema
        // For now, we store in notas as JSON
        notas: JSON.stringify({
          efsetLink: parsed.efsetLink,
          ...(parsed.cvUrl ? { cvUrl: parsed.cvUrl } : {}),
        }),
        status: 'Aplicante',
        fuente: 'Web Portal',
      },
      select: { id: true },
    });

    // Standardized success return
    return { success: true, candidateId: candidate.id };
    
  } catch (error) {
    console.error('[Recruitment Action Error]:', error);
    // Never expose database/provider details to anonymous applicants.
    return {
      success: false,
      error: 'No pudimos procesar tu postulación. Verifica tus datos e inténtalo de nuevo.',
    };
  }
}

/**
 * ACTION: Delete Candidate
 */
export async function deleteCandidate(id: number): Promise<ActionResult> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    await db.recruitmentCandidate.delete({
      where: { id },
      select: { id: true }
    });

    revalidatePath('/admin/recruitment');
    return { success: true };
  } catch (error) {
    console.error('Error in deleteCandidate action:', error);
    return { 
      success: false, 
      error: 'Failed to delete candidate',
      code: 'INTERNAL_ERROR'
    };
  }
}

/**
 * ACTION: Hire Candidate (Convert to Interpreter)
 * Placeholder for actual hiring logic
 */
export async function hireCandidate(id: number): Promise<ActionResult> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const candidate = await db.recruitmentCandidate.findUnique({
      where: { id },
      select: { id: true }
    });

    if (!candidate) {
      return { success: false, error: 'Candidate not found', code: 'NOT_FOUND' };
    }

    // Actual implementation would create an interpreter record, user profile, etc.
    // For now, just update status
    await db.recruitmentCandidate.update({
      where: { id },
      data: { status: 'Contratado' },
      select: { id: true }
    });

    revalidatePath('/admin/recruitment');
    return { success: true };
  } catch (error) {
    console.error('Error in hireCandidate action:', error);
    return { 
      success: false, 
      error: 'Failed to hire candidate',
      code: 'INTERNAL_ERROR'
    };
  }
}
