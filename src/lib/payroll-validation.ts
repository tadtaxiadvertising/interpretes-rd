export const MAX_PAYROLL_DB_AMOUNT = 99_999_999.99;
export const MAX_VERIFIED_PAYROLL_MINUTES = 100_000;

export function parsePayrollMoney(value: string | null): number | null {
  if (value === null || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= MAX_PAYROLL_DB_AMOUNT
    ? Math.round(amount * 100) / 100
    : null;
}

export function parseVerifiedPayrollMinutes(value: string | null): number | null {
  if (value === null || !/^[1-9]\d{0,5}$/.test(value)) return null;
  const minutes = Number(value);
  return Number.isSafeInteger(minutes) && minutes <= MAX_VERIFIED_PAYROLL_MINUTES ? minutes : null;
}

export function isValidPayrollAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_PAYROLL_DB_AMOUNT;
}

export function isPaidPayrollStatus(status: string | null): boolean {
  return status === 'Paid' || status === 'PAID';
}

export function isEditablePayrollStatus(status: string | null): boolean {
  return status === 'Draft' || status === 'Pendiente' || status === 'PENDING' || status === 'Approved' || status === 'APPROVED';
}

export function isApprovedPayrollStatus(status: string | null): boolean {
  return status === 'Approved' || status === 'APPROVED';
}
