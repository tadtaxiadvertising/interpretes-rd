/**
 * Translation boundary for the separate Google AI Studio "Roleplay Audio Studio"
 * MP3 + manifest.json export. Its private transcripts, speaker names and notes
 * must never be copied into candidate-visible scenario titles/prompts.
 *
 * This is NOT a ZIP decompressor or a publication endpoint: the canonical
 * roleplay importer still checks actual File bytes with SHA-256 before upload.
 */
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';

type Entry = {
  order: number;
  title: string;
  file: string;
  duration_limit_sec: 0;
  script_prompt: '';
};

type Adapted = { segments: Entry[]; audioFiles: File[] };
const MAX_SEGMENT_SECONDS = 300;
const MAX_TOTAL_SECONDS = 900;
const MAX_TIMELINE_SECONDS = 7200;
const SAFE_MP3 = /^[a-zA-Z0-9_.-]+\.mp3$/i;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeMp3(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 180 && SAFE_MP3.test(value);
}

function invalid(): never {
  throw new Error('El manifest.json externo contiene referencias o tiempos inválidos. Revisa los clips individuales antes de importar.');
}

/**
 * Accept only explicitly referenced clips and optional auxiliary MP3 tracks
 * from the Studio export. Do not use positional matching or master tracks as
 * evaluation scenarios, even when a single MP3 is missing.
 */
export function adaptExternalAudioStudioManifest(raw: unknown, files: File[]): Adapted {
  if (!record(raw) ||
      typeof raw.roleplayAudioStudioVersion !== 'string' ||
      !/^1\.\d+\.\d+$/.test(raw.roleplayAudioStudioVersion) ||
      !record(raw.project) || !record(raw.files) ||
      !Array.isArray(raw.segments) ||
      raw.segments.length < 1 || raw.segments.length > ROLEPLAY_MAX_SCENARIOS ||
      !Array.isArray(raw.files.clips) ||
      !Array.isArray(raw.files.speakerTracks)) invalid();

  const clipNames = new Set<string>();
  const segments: Entry[] = [];
  const seenTurns = new Set<number>();
  let lastEnd = 0;
  let duration = 0;
  for (const [i, segment] of raw.segments.entries()) {
    if (!record(segment) || !safeMp3(segment.mp3File) ||
        typeof segment.turn !== 'number' || !Number.isSafeInteger(segment.turn) || segment.turn < 1 ||
        seenTurns.has(segment.turn) ||
        !['speaker_1', 'speaker_2', 'speaker_3'].includes(String(segment.speaker)) ||
        !['en', 'es', 'mixed'].includes(String(segment.language)) ||
        typeof segment.startTime !== 'number' || !Number.isFinite(segment.startTime) ||
        typeof segment.endTime !== 'number' || !Number.isFinite(segment.endTime) ||
        segment.startTime < 0 || segment.startTime < lastEnd ||
        segment.endTime - segment.startTime < 0.1 ||
        segment.endTime - segment.startTime > MAX_SEGMENT_SECONDS ||
        segment.endTime > MAX_TIMELINE_SECONDS) invalid();

    const lower = segment.mp3File.toLowerCase();
    if (clipNames.has(lower)) invalid();
    clipNames.add(lower);
    seenTurns.add(segment.turn);
    duration += segment.endTime - segment.startTime;
    lastEnd = segment.endTime;
    // Keep metadata private. Even "speakerName" or "text" can reveal PHI or
    // the answer; no source transcript is ever copied into script_prompt.
    segments.push({
      order: i,
      title: 'Intervención ' + (i + 1),
      file: segment.mp3File,
      duration_limit_sec: 0,
      script_prompt: '',
    });
  }
  if (duration > MAX_TOTAL_SECONDS) invalid();

  // Fail closed if manifest.files.clips disagrees with segment.mp3File.
  if (raw.files.clips.length !== clipNames.size) invalid();
  const listedClips = new Set<string>();
  for (const name of raw.files.clips) {
    if (!safeMp3(name)) invalid();
    listedClips.add(name.toLowerCase());
  }
  if (listedClips.size !== clipNames.size ||
      [...clipNames].some((name) => !listedClips.has(name))) invalid();

  const auxiliaries = new Set<string>();
  if (raw.files.masteredMp3 !== null && raw.files.masteredMp3 !== undefined) {
    if (!safeMp3(raw.files.masteredMp3)) invalid();
    auxiliaries.add(raw.files.masteredMp3.toLowerCase());
  }
  if (raw.files.speakerTracks.length > 3) invalid();
  for (const track of raw.files.speakerTracks) {
    if (!record(track)) invalid();
    // An optional speaker track can be absent (null) in a valid external
    // export. Match the ZIP reader's contract without accepting malformed
    // non-null paths or changing which individual clips are published.
    if (track.mp3File !== undefined && track.mp3File !== null) {
      if (!safeMp3(track.mp3File)) invalid();
      const name = track.mp3File.toLowerCase();
      if (auxiliaries.has(name)) invalid();
      auxiliaries.add(name);
    }
  }
  if ([...auxiliaries].some((name) => clipNames.has(name))) invalid();

  const used = new Set<string>();
  const clips: File[] = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (used.has(name) || (!clipNames.has(name) && !auxiliaries.has(name))) invalid();
    used.add(name);
    if (clipNames.has(name)) clips.push(file);
  }
  if (clips.length !== clipNames.size) {
    throw new Error('Faltan MP3 de intervenciones. Exporta los clips individuales y selecciona manifest.json con todos esos MP3.');
  }
  return { segments, audioFiles: clips };
}
