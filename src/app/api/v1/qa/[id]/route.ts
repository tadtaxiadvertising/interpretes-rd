import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { QAScorePatchSchema } from '@/lib/api-schemas';
import { apiError, numericIdParamSchema, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth } from '@/lib/api-auth';
import { corsHeaders } from '@/lib/cors';
import { privateAdminResponse, privateAdminJson } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { qaV1StoredTotalMatches } from '@/lib/qa-v1-score-contract';

const METHODS = 'GET, PATCH, DELETE, OPTIONS';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request, METHODS) });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const { id } = numericIdParamSchema.parse(await params);

    const score = await prisma.qAScore.findUnique({
      where: { id },
      // QA detail should not serialize the full interpreter (banking data,
      // national ID, IP, pay rate) or production log (payroll linkage, notes).
      // Select only the relation context needed to review the evaluation.
      include: {
        interpreter: { select: { id: true, externalId: true, name: true } },
        productionLog: {
          select: {
            id: true,
            interpreterId: true,
            date: true,
            campaign: true,
            interpretedMinutes: true,
            callsAttended: true,
            status: true,
          },
        },
      }
    });

    if (!score) {
      return privateAdminJson({ success: false, error: 'Scorecard not found' }, { status: 404 });
    }

    return privateAdminJson(score, {
      headers: corsHeaders(request, METHODS),
    });
  } catch (error) {
    console.error('Error fetching scorecard:', safeServerErrorCategory(error));
    return privateAdminResponse(apiError({ error, fallback: 'Error fetching scorecard', exposeMessage: false }));
  }
}

const QA_SCORE_FIELDS = [
  'protocolScore',
  'interpretationScore',
  'languageScore',
  'serviceScore',
  'technicalScore',
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const { id } = numericIdParamSchema.parse(await params);
    // Only explicit editable fields are accepted. Changes to interpreterId,
    // productionLogId and totalScore must not silently rewrite audit history.
    const updateData: Record<string, unknown> = { ...(await parseJsonBody(request, QAScorePatchSchema)) };
    if (Object.keys(updateData).length === 0) {
      return privateAdminJson(
        { success: false, error: 'At least one editable field must be provided' },
        { status: 400 },
      );
    }

    const scoreChanged = updateData.criticalError !== undefined ||
      QA_SCORE_FIELDS.some(field => updateData[field] !== undefined);

    const updatedScore = await prisma.$transaction(async tx => {
      const existing = await tx.qAScore.findUnique({ where: { id } });
      if (!existing) return null;

      let expectedTotal: number | null = null;
      if (scoreChanged) {
        const [protocol, interpretation, language, service, technical] =
          QA_SCORE_FIELDS.map(field =>
            // Distinguish omitted (keep prior value) from explicit null (clear to zero).
            Number(updateData[field] === undefined
              ? (existing[field] ?? 0)
              : (updateData[field] ?? 0)));

        const isCritical = updateData.criticalError ?? existing.criticalError ?? false;
        const weighted = protocol * 0.20 + interpretation * 0.40 +
          language * 0.20 + service * 0.10 + technical * 0.10;
        expectedTotal = isCritical ? 0 : Math.round(weighted * 100) / 100;
        updateData.totalScore = expectedTotal;
        if (isCritical) updateData.accionRequerida = 'Advertencia';
      }

      // Do not recompute historical scores when editing a comment, date,
      // auditor, or other non-scoring metadata.
      const updated = await tx.qAScore.update({
        where: { id },
        data: updateData as any,
      });

      if (scoreChanged) {
        if (!qaV1StoredTotalMatches(updated.totalScore, expectedTotal!)) {
          throw new Error('QA PATCH stored score mismatch');
        }
      } else {
        // A DB trigger might recompute an old score on ANY UPDATE.
        // Roll back a metadata-only patch instead of silently rewriting it.
        const before = existing.totalScore;
        const after = updated.totalScore;
        const unchanged = before == null
          ? after == null
          : after != null && Number(before) === Number(after);
        if (!unchanged) throw new Error('QA PATCH changed historical score');
      }

      return updated;
    });

    if (!updatedScore) {
      return privateAdminJson({ success: false, error: 'Scorecard not found' }, { status: 404 });
    }
    return privateAdminJson(updatedScore, { headers: corsHeaders(request, METHODS) });
  } catch (error) {
    console.error('QA PATCH ERROR:', safeServerErrorCategory(error));
    return privateAdminResponse(apiError({
      error, fallback: 'Error updating scorecard', exposeMessage: false,
    }));
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const { id } = numericIdParamSchema.parse(await params);

    await prisma.qAScore.delete({
      where: { id },
    });

    return privateAdminJson({ success: true, message: 'Scorecard deleted successfully' }, {
      headers: corsHeaders(request, METHODS),
    });
  } catch (error) {
    console.error('Error deleting scorecard:', safeServerErrorCategory(error));
    const isPrismaError = error && typeof error === 'object' && 'code' in error;
    if (isPrismaError && error.code === 'P2025') {
      return privateAdminJson({ success: false, error: 'Scorecard not found' }, { status: 404 });
    }
    return privateAdminResponse(apiError({ error, fallback: 'Error deleting scorecard', exposeMessage: false }));
  }
}
