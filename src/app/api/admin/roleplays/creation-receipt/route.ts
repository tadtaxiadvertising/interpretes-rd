import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { InvalidRoleplayReceiptRequestError, lookupRoleplayCreationReceipt, parseRoleplayReceiptRequest } from '@/lib/roleplay/creation-receipt';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import prisma from '@/lib/prisma';

const MAX_RECEIPT_JSON_BYTES = 512;

class ReceiptBodyTooLargeError extends Error {}

/** Read at most 512 request bytes even if Content-Length is omitted/false. */
async function readSmallReceiptRequest(req: Request): Promise<string> {
  const declared = req.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_RECEIPT_JSON_BYTES) {
    throw new ReceiptBodyTooLargeError();
  }
  if (!req.body) throw new InvalidRoleplayReceiptRequestError();

  const reader = req.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new InvalidRoleplayReceiptRequestError();
      total += value.byteLength;
      if (total > MAX_RECEIPT_JSON_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ReceiptBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true })
      .decode(Buffer.concat(chunks, total)));
  } catch {
    throw new InvalidRoleplayReceiptRequestError();
  }
  return parseRoleplayReceiptRequest(payload);
}

/**
 * Read-only receipt API for FUTURE Roleplay idempotency.
 *
 * Disabled by default. Enabling this read endpoint is not sufficient to
 * activate POST idempotency; the database migration must first be confirmed.
 * This endpoint never claims keys, mutates sessions or returns invitations.
 */
export async function POST(req: Request) {
  if (process.env.ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED !== 'true') {
    return privateRoleplayResponse({ success: false, error: 'Not found' }, { status: 404 });
  }

  try {
    const auth = await validateAction('admin');
    if ('error' in auth || !auth.user?.userId) {
      return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    // An explicit Bearer may not override an unrelated privileged cookie.
    if (req.headers.has('authorization')) {
      const bearer = await actorFromBearer(req);
      if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId) {
        return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }
    if (req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return privateRoleplayResponse({ success: false, error: 'Expected JSON' }, { status: 415 });
    }

    let requestKey: string;
    try {
      requestKey = await readSmallReceiptRequest(req);
    } catch (error) {
      if (error instanceof ReceiptBodyTooLargeError) {
        return privateRoleplayResponse({ success: false, error: 'Request too large' }, { status: 413 });
      }
      if (error instanceof InvalidRoleplayReceiptRequestError) {
        return privateRoleplayResponse({ success: false, error: 'Invalid request' }, { status: 400 });
      }
      throw error;
    }

    const receipt = await lookupRoleplayCreationReceipt(prisma, auth.user.userId, requestKey);
    return privateRoleplayResponse({ success: true, data: receipt });
  } catch (error) {
    // Drivers may include credentials, endpoints and personal identifiers.
    console.error('[ROLEPLAY_CREATION_RECEIPT] Failed:', safeServerErrorCategory(error));
    return privateRoleplayResponse(
      { success: false, error: 'No se pudo consultar el resultado. Comprueba los roleplays existentes.' },
      { status: 503 },
    );
  }
}
