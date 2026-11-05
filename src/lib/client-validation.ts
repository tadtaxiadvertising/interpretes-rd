import { z } from 'zod';

export const clientInputSchema = z.object({
  name: z.string().trim().min(2).max(150),
  legalName: z.string().trim().max(200),
  contactName: z.string().trim().max(150),
  contactEmail: z.union([z.literal(''), z.email()]),
  phone: z.string().trim().max(40),
  notes: z.string().trim().max(1000),
});

export const clientAssignmentSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  clientId: z.coerce.number().int().positive(),
});
