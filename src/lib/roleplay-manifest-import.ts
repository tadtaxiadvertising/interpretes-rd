import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';

export interface ImportedRoleplayScenario {
  title: string;
  baseAudioFile: File;
  durationLimitSec: number;
  scriptPrompt: string;
  sha256: string;
}

interface ManifestSegment {
  order: number;
  title: string;
  file: string;
  size_bytes?: number;
  sha256?: string;
  duration_limit_sec?: number;
  script_prompt?: string;
}

const MAX_AUDIO_SIZE = 15 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidSegment(value: unknown): value is ManifestSegment {
  if (!isRecord(value)) return false;
  if (typeof value.order !== 'number' || !Number.isSafeInteger(value.order) || value.order < 0) return false;
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) return false;
  if (typeof value.file !== 'string' || !/^[a-zA-Z0-9_.-]+\.mp3$/i.test(value.file)) return false;
  if (value.size_bytes !== undefined && (typeof value.size_bytes !== 'number' || !Number.isSafeInteger(value.size_bytes) || value.size_bytes <= 0)) return false;
  if (value.sha256 !== undefined && (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.sha256))) return false;
  if (value.duration_limit_sec !== undefined && (typeof value.duration_limit_sec !== 'number' || !Number.isSafeInteger(value.duration_limit_sec) || value.duration_limit_sec < 0 || value.duration_limit_sec > ROLEPLAY_RESPONSE_MAX_DURATION_SEC)) return false;
  if (value.script_prompt !== undefined && (typeof value.script_prompt !== 'string' || value.script_prompt.length > 5000)) return false;
  return true;
}

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Prepare a complete manifest + MP3 set without changing any existing editor
 * state until every file, order, checksum and title has passed validation.
 * A checksum mismatch fails closed; publication is never attempted here.
 */
export async function prepareRoleplayManifestImport(files: File[]): Promise<ImportedRoleplayScenario[]> {
  const manifests = files.filter((file) => file.name.toLowerCase() === 'manifest.json');
  if (manifests.length !== 1) {
    throw new Error('Selecciona exactamente un manifest.json junto con todos los archivos MP3.');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await manifests[0].text());
  } catch {
    throw new Error('El archivo manifest.json no contiene JSON válido.');
  }
  if (!isRecord(raw) || !Array.isArray(raw.segments)) {
    throw new Error('El manifiesto no contiene un arreglo de segmentos.');
  }
  if (raw.segments.length < 1 || raw.segments.length > ROLEPLAY_MAX_SCENARIOS) {
    throw new Error(`El manifiesto debe contener entre 1 y ${ROLEPLAY_MAX_SCENARIOS} segmentos.`);
  }
  if (!raw.segments.every(isValidSegment)) {
    throw new Error('El manifiesto contiene campos inválidos de título, audio, orden o duración.');
  }

  const ordered = [...raw.segments].sort((a, b) => a.order - b.order);
  if (ordered.some((segment, index) => segment.order !== index)) {
    throw new Error('El orden de los segmentos debe comenzar en 0 y ser consecutivo.');
  }

  const audioFiles = files.filter((file) => file !== manifests[0]);
  const byName = new Map<string, File>();
  for (const audio of audioFiles) {
    if (!/\.mp3$/i.test(audio.name) || !['', 'audio/mpeg', 'audio/mp3'].includes(audio.type)) {
      throw new Error(`Archivo no permitido: ${audio.name}. Solo se admiten MP3.`);
    }
    if (audio.size < 1 || audio.size > MAX_AUDIO_SIZE) {
      throw new Error(`Tamaño de audio inválido (máximo 15 MiB): ${audio.name}.`);
    }
    const normalizedName = audio.name.toLowerCase();
    if (byName.has(normalizedName)) {
      throw new Error(`Archivo MP3 duplicado: ${audio.name}.`);
    }
    byName.set(normalizedName, audio);
  }

  if (byName.size !== ordered.length) {
    throw new Error('La cantidad de MP3 debe coincidir exactamente con los segmentos del manifiesto.');
  }
  const usedNames = new Set<string>();
  const result: ImportedRoleplayScenario[] = [];
  for (const segment of ordered) {
    const normalizedName = segment.file.toLowerCase();
    if (usedNames.has(normalizedName)) throw new Error(`El manifiesto repite el MP3 ${segment.file}.`);
    usedNames.add(normalizedName);
    const audio = byName.get(normalizedName);
    if (!audio) throw new Error(`Falta el archivo requerido: ${segment.file}.`);
    if (segment.size_bytes !== undefined && segment.size_bytes !== audio.size) {
      throw new Error(`Tamaño no coincide con el manifiesto: ${segment.file}.`);
    }

    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('El navegador no permite validar SHA-256. Usa un navegador seguro (HTTPS).');
    }
    const digest = bytesToHex(await crypto.subtle.digest('SHA-256', await audio.arrayBuffer()));
    if (segment.sha256 && digest !== segment.sha256.toLowerCase()) {
      throw new Error(`SHA-256 no coincide: ${segment.file}. No publiques el archivo.`);
    }
    result.push({
      title: segment.title.trim(),
      baseAudioFile: audio.type === 'audio/mpeg' ? audio : new File([audio], audio.name, { type: 'audio/mpeg' }),
      durationLimitSec: segment.duration_limit_sec ?? 0,
      scriptPrompt: segment.script_prompt ?? '',
      sha256: digest,
    });
  }
  return result;
}
