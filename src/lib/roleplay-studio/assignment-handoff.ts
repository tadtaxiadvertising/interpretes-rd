import { parseEditorialRoleplayTopic } from '@/lib/roleplay-library-topics';

export type StudioTopicSelection = { topic: string; subtopic: string };
// Same-tab, in-memory handoff only. Never store clinical media in browser
// persistence, a URL, or a server cache. A full reload intentionally loses it.
export const STUDIO_HANDOFF_MAX_BYTES = 16 * 1024 * 1024;
const HANDOFF_TTL_MS = 5 * 60 * 1000;
let pending: { token: string; files: File[]; kind: 'zip' | 'wav'; topic: StudioTopicSelection | null; expiresAt: number } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function clearStudioHandoff(token?: string) {
  if (token !== undefined && pending?.token !== token) return;
  pending = null;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

export function stageStudioHandoff(token: string, file: File, topic?: StudioTopicSelection | null) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(token) || file.size < 22 ||
      file.size > STUDIO_HANDOFF_MAX_BYTES || file.name !== 'roleplay-studio.zip') {
    throw new Error('Paquete temporal no válido o demasiado grande.');
  }
  stage(token, [file], 'zip', topic);
}

export function stageLocalWavHandoff(token: string, files: File[], topic?: StudioTopicSelection | null) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(token) || files.length < 2 || files.length > 26 ||
      files[0].name !== 'manifest.json' || files[0].size < 1 || files[0].size > 1024 * 1024 ||
      files.slice(1).some((file, index) => file.name !== 'segment-' + String(index + 1).padStart(2, '0') + '.wav' ||
        file.type !== 'audio/wav' || file.size <= 44 || file.size > 15 * 1024 * 1024) ||
      files.reduce((sum, file) => sum + file.size, 0) > STUDIO_HANDOFF_MAX_BYTES) {
    throw new Error('Paquete WAV temporal no válido o demasiado grande.');
  }
  stage(token, files, 'wav', topic);
}

function stage(token: string, files: File[], kind: 'zip' | 'wav', topic?: StudioTopicSelection | null) {
  clearStudioHandoff();
  pending = { token, files: [...files], kind, topic: topic ? parseEditorialRoleplayTopic(topic.topic, topic.subtopic) : null, expiresAt: Date.now() + HANDOFF_TTL_MS };
  timer = setTimeout(() => clearStudioHandoff(token), HANDOFF_TTL_MS);
}

export function peekStudioHandoff(token: string): File | null {
  if (pending && pending.expiresAt <= Date.now()) clearStudioHandoff();
  return pending?.token === token && pending.kind === 'zip' ? pending.files[0] : null;
}

export function peekLocalWavHandoff(token: string): File[] | null {
  if (pending && pending.expiresAt <= Date.now()) clearStudioHandoff();
  return pending?.token === token && pending.kind === 'wav' ? [...pending.files] : null;
}

/** Non-sensitive topic metadata shares the exact token and lifetime of the media. */
export function peekStudioHandoffTopic(token: string): StudioTopicSelection | null {
  if (pending && pending.expiresAt <= Date.now()) clearStudioHandoff();
  return pending?.token === token && pending.topic ? { ...pending.topic } : null;
}
