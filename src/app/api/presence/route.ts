import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';
import { PresenceSchema } from '@/lib/api-schemas';
import { apiError, parseJsonBody } from '@/lib/api-responses';

const db = prisma;
const GRACE_PERIOD_MS = 30_000; // 30 seconds grace before marking offline

// Valid presence states
const PRESENCE_STATES = ['Online', 'Offline', 'Away', 'Busy'] as const;
type PresenceState = typeof PRESENCE_STATES[number];

// Valid event types
const EVENT_TYPES = ['heartbeat', 'online', 'offline', 'status_change'] as const;
type EventType = typeof EVENT_TYPES[number];

function normalizeEventType(body: any): EventType | null {
  // Support both `type` (new) and `status` (legacy) for backward compatibility
  if (EVENT_TYPES.includes(body.type)) return body.type;
  if (PRESENCE_STATES.includes(body.status)) return 'status_change';
  return null;
}

function normalizeState(body: any): PresenceState {
  if (PRESENCE_STATES.includes(body.status)) return body.status;
  if (body.type === 'online') return 'Online';
  if (body.type === 'offline') return 'Offline';
  return 'Away';
}

export async function POST(req: Request) {
  try {
    const userData = await getCurrentUser();

    if (!userData) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (userData.profile.role !== 'interpreter') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await parseJsonBody(req, PresenceSchema);
    const profile = userData.profile;
    const now = new Date();

    const eventType = normalizeEventType(body);
    const targetState = normalizeState(body);

    if (!eventType) {
      return NextResponse.json({ success: false, error: 'Invalid presence event type' }, { status: 400 });
    }

    // ── HEARTBEAT ─────────────────────────────────────────────
    // Just update lastHeartbeat, no status change
    if (eventType === 'heartbeat') {
      if (profile?.interpreterId) {
        await db.interpreter.update({
          where: { id: profile.interpreterId },
          data: { lastHeartbeat: now },
          select: { id: true },
        });
      }
      return NextResponse.json({ success: true, heartbeat: true, ts: now.toISOString() });
    }

    // ── ONLINE ────────────────────────────────────────────────
    if (eventType === 'online' || targetState === 'Online') {
      if (!profile?.interpreterId) {
        return NextResponse.json({ success: true, skipped: true });
      }

      const interpreter = await db.interpreter.findUnique({
        where: { id: profile.interpreterId },
        select: { realtimeStatus: true, browserTabId: true },
      });

      const previousStatus = interpreter?.realtimeStatus || 'Offline';
      const tabId = body.tabId || crypto.randomUUID();

      await db.$transaction([
        db.interpreter.update({
          where: { id: profile.interpreterId },
          data: {
            realtimeStatus: 'Online',
            statusReason: body.reason || 'login',
            lastOnlineAt: now,
            lastHeartbeat: now,
            lastActivity: now,
            statusChangedAt: now,
            browserTabId: tabId,
            clientIp: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
          },
          select: { id: true },
        }),
        db.interpreterStatusLog.create({
          data: {
            interpreterId: profile.interpreterId,
            previousStatus,
            newStatus: 'Online',
            reason: body.reason || 'login',
            changedBy: 'interpreter',
            metadata: { tabId, clientIp: req.headers.get('x-forwarded-for') || null },
          },
        }),
      ]);

      return NextResponse.json({ success: true, status: 'Online', tabId });
    }

    // ── OFFLINE (tab closed / logout) ────────────────────────
    if (eventType === 'offline' || targetState === 'Offline') {
      if (!profile?.interpreterId) {
        return NextResponse.json({ success: true, skipped: true });
      }

      const interpreter = await db.interpreter.findUnique({
        where: { id: profile.interpreterId },
        select: { realtimeStatus: true, browserTabId: true },
      });

      // Grace period: if another tab is still active, don't mark offline
      if (interpreter?.browserTabId && body.tabId && interpreter.browserTabId !== body.tabId) {
        return NextResponse.json({ success: true, keptActive: true });
      }

      const previousStatus = interpreter?.realtimeStatus || 'Online';
      const reason = body.reason || 'browser_closed';

      await db.$transaction([
        db.interpreter.update({
          where: { id: profile.interpreterId },
          data: {
            realtimeStatus: 'Offline',
            statusReason: reason,
            lastOfflineAt: now,
            statusChangedAt: now,
            browserTabId: null,
          },
          select: { id: true },
        }),
        db.interpreterStatusLog.create({
          data: {
            interpreterId: profile.interpreterId,
            previousStatus,
            newStatus: 'Offline',
            reason,
            changedBy: 'system',
            metadata: { tabId: body.tabId || null, reason },
          },
        }),
      ]);

      return NextResponse.json({ success: true, status: 'Offline' });
    }

    // ── STATUS CHANGE (away, busy, etc.) ─────────────────────
    if (eventType === 'status_change' || PRESENCE_STATES.includes(targetState)) {
      if (!profile?.interpreterId) {
        return NextResponse.json({ success: true, skipped: true });
      }

      const interpreter = await db.interpreter.findUnique({
        where: { id: profile.interpreterId },
        select: { realtimeStatus: true },
      });
      const previousStatus = interpreter?.realtimeStatus || 'Offline';

      const updateData: Record<string, any> = {
            realtimeStatus: targetState,
            statusReason: body.reason || 'manual',
            lastActivity: now,
            statusChangedAt: now,
          };
          // Use type assertion to avoid TypeScript narrowing in this branch
          const state = targetState as PresenceState;
          if (state === 'Online') updateData.lastOnlineAt = now;
          if (state === 'Offline') updateData.lastOfflineAt = now;

          await db.$transaction([
            db.interpreter.update({
              where: { id: profile.interpreterId },
              data: updateData,
              select: { id: true },
            }),
        db.interpreterStatusLog.create({
          data: {
            interpreterId: profile.interpreterId,
            previousStatus,
            newStatus: targetState,
            reason: body.reason || 'manual',
            changedBy: 'interpreter',
            metadata: { tabId: body.tabId || null },
          },
        }),
      ]);

      return NextResponse.json({ success: true, status: targetState });
    }

    return NextResponse.json({ success: false, error: 'Unknown presence type' }, { status: 400 });
  } catch (error) {
    return apiError({ error, fallback: 'Internal Server Error' });
  }
}

/**
 * GET: returns a heartbeat ping for the current interpreter (lightweight)
 */
export async function GET(req: Request) {
  try {
    const userData = await getCurrentUser();
    if (!userData) {
      return NextResponse.json({ online: false }, { status: 401 });
    }
    if (userData.profile.role !== 'interpreter' || !userData.profile.interpreterId) {
      return NextResponse.json({ online: false }, { status: 403 });
    }

    const interpreter = await db.interpreter.findUnique({
      where: { id: userData.profile.interpreterId },
      select: {
        realtimeStatus: true,
        lastHeartbeat: true,
        statusChangedAt: true,
        statusReason: true,
      },
    });

    if (!interpreter) {
      return NextResponse.json({ online: false });
    }

    const now = Date.now();
    const heartbeatAge = interpreter.lastHeartbeat
      ? now - new Date(interpreter.lastHeartbeat).getTime()
      : Infinity;

    return NextResponse.json({
      online: interpreter.realtimeStatus !== 'Offline',
      status: interpreter.realtimeStatus,
      heartbeatAgeMs: heartbeatAge,
      heartbeatAgeSeconds: Math.round(heartbeatAge / 1000),
      statusReason: interpreter.statusReason,
      statusChangedAt: interpreter.statusChangedAt?.toISOString(),
    });
  } catch {
    return NextResponse.json({ online: false }, { status: 500 });
  }
}