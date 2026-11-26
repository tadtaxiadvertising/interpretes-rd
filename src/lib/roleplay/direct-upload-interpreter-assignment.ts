import { z } from 'zod';
import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';

export const directInterpreterAssignment = z.object({
  interpreterId: z.number().int().positive().safe(),
  scenarios: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    durationLimitSec: z.number().int().positive().max(ROLEPLAY_RESPONSE_MAX_DURATION_SEC).nullable(),
    scriptPrompt: z.string().max(5000).nullable(),
    studioLanguage: z.enum(['en','es','mixed']).nullable(),
  }).strict()).min(1).max(ROLEPLAY_MAX_SCENARIOS),
}).strict();

export type DirectInterpreterAssignment = z.infer<typeof directInterpreterAssignment>;
