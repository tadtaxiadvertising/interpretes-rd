import type { Prisma } from '@prisma/client';

export const budgetCeilings = { brevo: { daily: 300, monthly: 9300 }, resend: { daily: 100, monthly: 3000 } } as const;
export type BudgetProvider = keyof typeof budgetCeilings;
export type BudgetInput = { provider: BudgetProvider; dailyLimit: number; monthlyLimit: number };

export function validateBudget(input: unknown): BudgetInput | null {
  if (!input || typeof input !== 'object') return null;
  const { provider, dailyLimit, monthlyLimit } = input as Record<string, unknown>;
  if (provider !== 'brevo' && provider !== 'resend') return null;
  if (typeof dailyLimit !== 'number' || typeof monthlyLimit !== 'number'
    || !Number.isSafeInteger(dailyLimit) || !Number.isSafeInteger(monthlyLimit)
    || dailyLimit < 1 || monthlyLimit < 1 || dailyLimit > budgetCeilings[provider].daily
    || monthlyLimit > budgetCeilings[provider].monthly) return null;
  return { provider, dailyLimit, monthlyLimit };
}

/** One atomic update and audit insert. Never reset counters, even when lowering
 * a budget below the amount already used. Quota reservations lock the same row. */
export async function updateProviderBudget(db: Pick<Prisma.TransactionClient, '$queryRaw'>, input: BudgetInput, actor: string): Promise<boolean> {
  const validated = validateBudget(input);
  if (!validated || !actor || actor.length > 255) return false;
  const { provider, dailyLimit, monthlyLimit } = validated;
  const rows = await db.$queryRaw<{ provider: string }[]>`
    WITH previous AS (
      SELECT provider, daily_limit, monthly_limit FROM private_email.provider_quota
      WHERE provider = ${provider} FOR UPDATE
    ), changed AS (
      UPDATE private_email.provider_quota q
      SET daily_limit = ${dailyLimit}, monthly_limit = ${monthlyLimit}
      FROM previous p WHERE q.provider = p.provider
      RETURNING q.provider, p.daily_limit AS old_daily, p.monthly_limit AS old_monthly,
        q.daily_limit AS new_daily, q.monthly_limit AS new_monthly
    )
    INSERT INTO private_email.provider_budget_audit(provider, old_daily_limit, old_monthly_limit, new_daily_limit, new_monthly_limit, changed_by)
    SELECT provider, old_daily, old_monthly, new_daily, new_monthly, ${actor} FROM changed
    RETURNING provider
  `;
  return rows.length === 1;
}
