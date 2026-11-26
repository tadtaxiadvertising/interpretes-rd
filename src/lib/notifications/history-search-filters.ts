import { z } from 'zod';

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T00:00:00Z');
  return value >= '1900-01-01' && value <= '9999-12-31' &&
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Fecha no válida');

export const HistorySearchFiltersSchema = z.object({
  search: z.string().trim().min(2).max(80).refine(value => !/[\x00-\x1f\x7f]/.test(value)).optional(),
  fromDate: calendarDate.optional(),
  toDate: calendarDate.optional(),
}).strict().refine(value => !value.fromDate || !value.toDate || value.fromDate <= value.toDate, {
  message: 'La fecha inicial debe ser anterior o igual a la final',
});

export type HistorySearchFilters = z.infer<typeof HistorySearchFiltersSchema>;
