import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';

// Internal reference only, never a public URL or client-upload declaration.
// Storage holds the corresponding base/<uuid>/<order>.<extension> object.
const PREFIX = 'private-base/';
const PATH = /^private-base\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/(0|[1-9][0-9]*)\.(mp3|wav|webm|mp4)$/;

export function isPrivateClinicalReference(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function privateClinicalObjectPath(reference: string): string | null {
  const match = PATH.exec(reference);
  if (!match || match[0] !== reference || Number(match[2]) >= ROLEPLAY_MAX_SCENARIOS) return null;
  return 'base/' + match[1] + '/' + match[2] + '.' + match[3];
}

export function makePrivateClinicalReference(batchId: string, order: number, extension: string): string {
  const reference = PREFIX + batchId + '/' + order + '.' + extension;
  if (!privateClinicalObjectPath(reference)) throw new Error('Invalid private clinical reference');
  return reference;
}
