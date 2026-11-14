/**
 * Bounded browser ZIP reader for a *separate* Audio Studio export.
 *
 * The canonical Intérpretes RD STORE ZIP still uses zip.ts. This reader
 * handles flat-file STORE/DEFLATE exports (including JSZip data descriptors),
 * never unpacks paths, and only materializes declared individual MP3 clips.
 * It does not trust central-directory sizes, CRCs, or manifest names alone.
 */
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import { adaptExternalAudioStudioManifest } from '@/lib/roleplay-external-studio-manifest';

const MAX_ZIP_BYTES = 96 * 1024 * 1024;
const MAX_CLIP_BYTES = 15 * 1024 * 1024;
const MAX_CLIPS_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ENTRIES = ROLEPLAY_MAX_SCENARIOS + 8;
const MAX_CENTRAL_NAME_BYTES = 180;
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const MP3_NAME = /^[a-zA-Z0-9_.-]+\.mp3$/i;
const WAV_NAME = /^[a-zA-Z0-9_.-]+\.wav$/i;

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  crc: number;
  dataStart: number;
  dataEnd: number;
  localOffset: number;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let n = 0; n < 8; n++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(data: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const byte of data) checksum = CRC_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

function invalid(): never {
  throw new Error('ZIP externo inválido o inseguro. Comprueba el paquete exportado por Audio Studio.');
}

function record(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function safeName(value: unknown, extension: 'mp3' | 'wav' = 'mp3'): value is string {
  return typeof value === 'string' && value.length <= MAX_CENTRAL_NAME_BYTES &&
    (extension === 'mp3' ? MP3_NAME : WAV_NAME).test(value);
}

function addName(names: Set<string>, name: string): void {
  const lower = name.toLowerCase();
  if (names.has(lower)) invalid();
  names.add(lower);
}

function parseArchive(buffer: ArrayBuffer): Map<string, ZipEntry> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const length = bytes.length;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const u16 = (pos: number): number => {
    if (pos < 0 || pos + 2 > length) invalid();
    return view.getUint16(pos, true);
  };
  const u32 = (pos: number): number => {
    if (pos < 0 || pos + 4 > length) invalid();
    return view.getUint32(pos, true);
  };

  // EOCD can carry up to 65,535 bytes of comment. Reject trailing junk,
  // multi-volume ZIP, ZIP64, and inconsistent central directory offsets.
  let end = -1;
  for (let offset = length - 22; offset >= Math.max(0, length - 22 - 65535); offset--) {
    if (u32(offset) === END && offset + 22 + u16(offset + 20) === length) {
      end = offset;
      break;
    }
  }
  if (end < 0 || u16(end + 4) !== 0 || u16(end + 6) !== 0) invalid();
  const count = u16(end + 10);
  if (count < 2 || count > MAX_ENTRIES || count !== u16(end + 8)) invalid();
  const centralSize = u32(end + 12);
  const centralStart = u32(end + 16);
  if (centralStart === 0xffffffff || centralSize === 0xffffffff ||
      centralStart + centralSize !== end) invalid();

  const result = new Map<string, ZipEntry>();
  const intervals: Array<{ start: number; end: number }> = [];
  let cursor = centralStart;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || u32(cursor) !== CENTRAL) invalid();
    const flags = u16(cursor + 8);
    const method = u16(cursor + 10);
    const crc = u32(cursor + 16);
    const compressedSize = u32(cursor + 20);
    const size = u32(cursor + 24);
    const nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const commentLength = u16(cursor + 32);
    const diskStart = u16(cursor + 34);
    const localOffset = u32(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || !nameLength || nameLength > MAX_CENTRAL_NAME_BYTES ||
        compressedSize === 0xffffffff || size === 0xffffffff ||
        localOffset === 0xffffffff || diskStart !== 0 ||
        (flags & ~0x0808) !== 0 || ![0, 8].includes(method) ||
        compressedSize === 0 || size === 0 || size > MAX_ZIP_BYTES ||
        (method === 0 && compressedSize !== size)) invalid();

    let name: string;
    try { name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); }
    catch { invalid(); }
    if (name !== 'manifest.json' && !safeName(name) && !safeName(name, 'wav')) invalid();
    const key = name.toLowerCase();
    if (result.has(key)) invalid();

    if (localOffset + 30 > centralStart || u32(localOffset) !== LOCAL ||
        u16(localOffset + 6) !== flags || u16(localOffset + 8) !== method) invalid();
    const localNameLength = u16(localOffset + 26);
    const localExtraLength = u16(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (localNameLength !== nameLength || dataEnd > centralStart) invalid();
    let localName: string;
    try { localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)); }
    catch { invalid(); }
    if (localName !== name) invalid();
    // With a data descriptor, central-directory values are authoritative;
    // otherwise the local CRC and sizes MUST match.
    if ((flags & 0x0008) === 0 &&
        (u32(localOffset + 14) !== crc ||
         u32(localOffset + 18) !== compressedSize ||
         u32(localOffset + 22) !== size)) invalid();

    intervals.push({ start: localOffset, end: dataEnd });
    result.set(key, { name, method, flags, compressedSize, size, crc, dataStart, dataEnd, localOffset });
    cursor = next;
  }
  if (cursor !== end || !result.has('manifest.json')) invalid();
  intervals.sort((a, b) => a.start - b.start);
  if (intervals[0].start !== 0 ||
      intervals.some((current, i) => i > 0 && current.start < intervals[i - 1].end)) invalid();
  return result;
}

async function readEntry(buffer: ArrayBuffer, entry: ZipEntry, maxBytes: number): Promise<Uint8Array> {
  if (entry.size > maxBytes) invalid();
  let decompressed: Uint8Array;
  if (entry.method === 0) {
    decompressed = new Uint8Array(buffer.slice(entry.dataStart, entry.dataEnd));
  } else {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este navegador no puede abrir ZIP comprimidos. Extrae los MP3 y el manifest.json primero.');
    }
    const source = new Blob([buffer.slice(entry.dataStart, entry.dataEnd)]);
    const parts: Uint8Array[] = [];
    let total = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      reader = source.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > entry.size || total > maxBytes) invalid();
        parts.push(next.value);
      }
    } catch {
      invalid();
    } finally {
      if (reader) { try { await reader.cancel(); } catch { /* already closed */ } }
    }
    decompressed = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      decompressed.set(part, offset);
      offset += part.byteLength;
    }
  }
  if (decompressed.byteLength !== entry.size || crc32(decompressed) !== entry.crc) {
    throw new Error('ZIP externo dañado: el tamaño o CRC32 de un archivo no coincide.');
  }
  return decompressed;
}

/** Extract only the individual clips claimed by the external manifest. */
export async function extractExternalStudioZip(archive: File): Promise<File[]> {
  if (!/\.zip$/i.test(archive.name) || archive.size < 22 || archive.size > MAX_ZIP_BYTES) {
    throw new Error('El ZIP externo debe tener como máximo 96 MiB.');
  }
  const buffer = await archive.arrayBuffer();
  const entries = parseArchive(buffer);
  const manifest = entries.get('manifest.json')!;
  if (manifest.size > MAX_MANIFEST_BYTES) invalid();
  const data = await readEntry(buffer, manifest, MAX_MANIFEST_BYTES);

  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { invalid(); }
  if (!record(raw) || typeof raw.roleplayAudioStudioVersion !== 'string' ||
      !/^1\.\d+\.\d+$/.test(raw.roleplayAudioStudioVersion) ||
      !record(raw.files) || !Array.isArray(raw.files.clips) ||
      !Array.isArray(raw.files.speakerTracks) ||
      raw.files.clips.length < 1 || raw.files.clips.length > ROLEPLAY_MAX_SCENARIOS ||
      raw.files.speakerTracks.length > 3) invalid();

  const allowed = new Set<string>(['manifest.json']);
  for (const name of raw.files.clips) {
    if (!safeName(name)) invalid();
    addName(allowed, name);
  }
  if (raw.files.masteredMp3 !== null && raw.files.masteredMp3 !== undefined) {
    if (!safeName(raw.files.masteredMp3)) invalid();
    addName(allowed, raw.files.masteredMp3);
  }
  if (raw.files.masteredWav !== null && raw.files.masteredWav !== undefined) {
    if (!safeName(raw.files.masteredWav, 'wav')) invalid();
    addName(allowed, raw.files.masteredWav);
  }
  for (const track of raw.files.speakerTracks) {
    if (!record(track)) invalid();
    if (track.mp3File !== null && track.mp3File !== undefined) {
      if (!safeName(track.mp3File)) invalid();
      addName(allowed, track.mp3File);
    }
  }
  if ([...entries.keys()].some(name => !allowed.has(name))) invalid();

  const result: File[] = [new File([new Uint8Array(data)], 'manifest.json', { type: 'application/json' })];
  let totalClipBytes = 0;
  for (const name of raw.files.clips) {
    const clip = entries.get(name.toLowerCase());
    if (!clip || clip.size > MAX_CLIP_BYTES) invalid();
    totalClipBytes += clip.size;
    if (totalClipBytes > MAX_CLIPS_TOTAL_BYTES) invalid();
    const payload = await readEntry(buffer, clip, MAX_CLIP_BYTES);
    result.push(new File([new Uint8Array(payload)], clip.name, { type: 'audio/mpeg' }));
  }

  // Reuse the established contract for segment ordering, timeline checks,
  // file references and privacy-safe neutral titles.
  adaptExternalAudioStudioManifest(raw, result.slice(1));
  return result;
}
