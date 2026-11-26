import { z } from 'zod';
import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';

export const directInterpreterAssignment = z.object({
  interpreterId: z.number().int().positive().safe(),
  scenarios: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    durationLimitSec: z.number().int().positive().max(ROLEPLAY_RESPONSE_MAX_DURATION_SEC).nullable(),
    scriptPrompt: z.string().max(5000).nullable(),
    studioLanguage: z.enum(['en','es','mixed']).nullable(),
    studioTurn: z.number().int().positive().max(10000).nullable().optional(),
    studioSpeaker: z.enum(['speaker_1','speaker_2','speaker_3']).nullable().optional(),
    sourceStartSec: z.number().finite().min(0).max(7200).nullable().optional(),
    sourceEndSec: z.number().finite().min(0).max(7200).nullable().optional(),
  }).strict().superRefine((item,ctx)=>{
    const start=item.sourceStartSec, end=item.sourceEndSec;
    if ((start != null)!==(end != null) || (start != null && end != null && end<=start))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Invalid source time range'});
  })).min(1).max(ROLEPLAY_MAX_SCENARIOS),
}).strict();

export type DirectInterpreterAssignment = z.infer<typeof directInterpreterAssignment>;
