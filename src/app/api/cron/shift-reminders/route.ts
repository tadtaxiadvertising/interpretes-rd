import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/auth/cron-auth";

export async function POST(req: Request) {
  try {
    if (!isAuthorizedCronRequest(req.headers.get("authorization"))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const today = new Date();
    const dayStr = today.toISOString().split('T')[0];

    const interpreters = await prisma.interpreter.findMany();

    const activeSessions = await prisma.callSession.findMany({
      where: {
        startedAt: {
          gte: new Date(`${dayStr}T00:00:00.000Z`)
        },
        endedAt: null
      }
    });

    const activeInterpreterIds = new Set(activeSessions.map(s => s.interpreterId));

    const remindersSent = [];

    // Get current time in 'HH:mm' to compare with shiftStart
    // Depending on timezone, you might want to adjust. Let's use UTC as an example or standard server time.
    const currentHour = today.getHours();
    const currentMinutes = today.getMinutes();

    for (const interpreter of interpreters) {
      if (activeInterpreterIds.has(interpreter.id)) continue;

      const shiftStart = interpreter.shiftStart || "09:00";
      const [startHour, startMin] = shiftStart.split(":").map(Number);

      // If it's past their start time and they have no active session today
      // In a real system, you'd track if we already sent them an email in the last hour
      // For this simplified version, we just check if current hour >= start hour
      if (currentHour >= startHour) {
        // Send email via some email service
        console.log(`[Notification] Shift reminder for ${interpreter.name} (${interpreter.emailCorporativo})`);

        // TODO: Actually dispatch an email using the Email Service
        // await emailService.sendShiftReminder(interpreter.emailCorporativo, shiftStart);

        remindersSent.push(interpreter.id);
      }
    }

    return NextResponse.json({ success: true, remindersSent });
  } catch (error) {
    console.error("Cron Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
