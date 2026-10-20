import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { IncentiveConfigSchema } from '@/lib/api-schemas';
import { apiError, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth } from '@/lib/api-auth';

const db = prisma;

/**
 * GET /api/config/incentives
 * Lee todos los tiers de incentivos desde SystemConfig.
 * Retorna los pares key/value agrupados por tier.
 */
export async function GET(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const configs = await db.systemConfig.findMany({
      where: {
        key: {
          startsWith: 'tier',
        },
      },
      orderBy: { key: 'asc' },
    });

    // Agrupar en tiers legibles
    const tiers: Record<string, { hours?: string; bonus?: string; hoursDescription?: string; bonusDescription?: string }> = {};

    for (const config of configs) {
      const match = config.key.match(/^tier(\d+)_(hours|bonus)$/);
      if (!match) continue;

      const tierKey = `tier${match[1]}`;
      if (!tiers[tierKey]) tiers[tierKey] = {};

      if (match[2] === 'hours') {
        tiers[tierKey].hours = config.value;
        tiers[tierKey].hoursDescription = config.description ?? undefined;
      } else {
        tiers[tierKey].bonus = config.value;
        tiers[tierKey].bonusDescription = config.description ?? undefined;
      }
    }

    return NextResponse.json({
      success: true,
      tiers,
      raw: configs,
    });
  } catch (error) {
    console.error('[GET /api/config/incentives] Error:', error);
    return apiError({ error, fallback: 'Failed to fetch incentive config' });
  }
}

/**
 * POST /api/config/incentives
 * Crea o actualiza los tiers de incentivos en SystemConfig.
 * 
 * Body:
 * {
 *   tiers: [
 *     { tierNumber: 1, hours: 100, bonus: 50.00 },
 *     { tierNumber: 2, hours: 150, bonus: 100.00 },
 *     { tierNumber: 3, hours: 200, bonus: 200.00 }
 *   ]
 * }
 */
export async function POST(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const { tiers } = await parseJsonBody(request, IncentiveConfigSchema);

    // Upsert cada par hours/bonus en SystemConfig
    const results = [];

    for (const tier of tiers) {
      const hoursKey = `tier${tier.tierNumber}_hours`;
      const bonusKey = `tier${tier.tierNumber}_bonus`;

      // Upsert hours
      const hoursRecord = await db.systemConfig.upsert({
        where: { key: hoursKey },
        update: {
          value: String(tier.hours),
          description: `Minimum hours for tier ${tier.tierNumber} incentive`,
        },
        create: {
          key: hoursKey,
          value: String(tier.hours),
          description: `Minimum hours for tier ${tier.tierNumber} incentive`,
        },
      });

      // Upsert bonus
      const bonusRecord = await db.systemConfig.upsert({
        where: { key: bonusKey },
        update: {
          value: String(tier.bonus),
          description: `Bonus amount (RD$) for tier ${tier.tierNumber}`,
        },
        create: {
          key: bonusKey,
          value: String(tier.bonus),
          description: `Bonus amount (RD$) for tier ${tier.tierNumber}`,
        },
      });

      results.push({ hoursRecord, bonusRecord });
    }

    return NextResponse.json({
      success: true,
      message: `${tiers.length} tier(s) saved successfully`,
      results,
    });
  } catch (error) {
    console.error('[POST /api/config/incentives] Error:', error);
    return apiError({ error, fallback: 'Failed to save incentive config' });
  }
}
