// Same-tab, in-memory handoff only. Never store clinical media in browser
// persistence, a URL, or a server cache. A full reload intentionally loses it.
export const STUDIO_HANDOFF_MAX_BYTES = 16 * 1024 * 1024;
const HANDOFF_TTL_MS = 5 * 60 * 1000;
let pending: { token: string; file: File; expiresAt: number } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function clearStudioHandoff(token?: string) {
  if (token !== undefined && pending?.token !== token) return;
  pending = null;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

export function stageStudioHandoff(token: string, file: File) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(token) || file.size < 22 ||
      file.size > STUDIO_HANDOFF_MAX_BYTES || file.name !== 'roleplay-studio.zip') {
    throw new Error('Paquete temporal no válido o demasiado grande.');
  }
  clearStudioHandoff();
  pending = { token, file, expiresAt: Date.now() + HANDOFF_TTL_MS };
  timer = setTimeout(() => clearStudioHandoff(token), HANDOFF_TTL_MS);
}

export function peekStudioHandoff(token: string): File | null {
  if (pending && pending.expiresAt <= Date.now()) clearStudioHandoff();
  return pending?.token === token ? pending.file : null;
}
