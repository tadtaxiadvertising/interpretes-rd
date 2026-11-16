#!/usr/bin/env node
/**
 * Local-only Roleplay Audio Studio exporter for large video/audio sources.
 *
 * Usage:
 *   node scripts/export-studio-long-local.mjs --source ./call.mp4 \
 *     --project ./roleplay-studio-proyecto-largo.json --output ./roleplay-studio.zip
 *
 * The source is never uploaded or fully buffered. Only the selected audio
 * intervals are decoded by a local FFmpeg process into small temporary MP3s.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import ffmpegStatic from 'ffmpeg-static';

const FORMAT = 'interpretes-rd-studio-long-local-project';
const MAX_SOURCE_BYTES = 8 * 1024 ** 3;
const MAX_SOURCE_SECONDS = 12 * 3600;
const MAX_PROJECT_BYTES = 180_000;
const MAX_SEGMENTS = 25;
const MAX_TOTAL_SECONDS = 900;
const MAX_ZIP_BYTES = 16 * 1024 * 1024;
const MAX_CLIP_BYTES = 15 * 1024 * 1024;
const SAMPLE_BYTES = 128 * 1024;
const EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'aac', 'ogg', 'oga', 'opus', 'flac', 'mp4', 'm4v', 'mov', 'webm', 'mkv']);
const ROLES = new Set(['doctor', 'patient', 'nurse', 'operator', 'interpreter', 'unknown']);
const LANGUAGES = new Set(['en', 'es', 'unknown']);
const SAMPLE_HASH = /^[0-9a-f]{64}$/i;

function fail(message) { throw new Error(message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--source', '--project', '--output'].includes(key) || !value ||
        value.startsWith('--') || result[key]) {
      fail('Uso: node scripts/export-studio-long-local.mjs --source ARCHIVO --project PROYECTO.json --output ARCHIVO.zip');
    }
    result[key] = value;
  }
  if (Object.keys(result).length !== 3) fail('Debes indicar --source, --project y --output.');
  const source = resolve(result['--source']);
  const project = resolve(result['--project']);
  const output = resolve(result['--output']);
  if (source === project || source === output || project === output ||
      !/\.json$/i.test(project) || !/\.zip$/i.test(output)) {
    fail('Las rutas deben ser distintas. El proyecto debe ser JSON y el resultado ZIP.');
  }
  const extension = extname(source).slice(1).toLowerCase();
  if (!EXTENSIONS.has(extension)) fail('Formato no admitido para extracción local.');
  return { source, project, output };
}

function validateProject(data, size) {
  if (!object(data) || data.format !== FORMAT || data.version !== 1 ||
      !Number.isSafeInteger(data.sourceSizeBytes) ||
      data.sourceSizeBytes !== size ||
      typeof data.sourceSampleSha256 !== 'string' || !SAMPLE_HASH.test(data.sourceSampleSha256) ||
      !Number.isFinite(data.sourceDurationSeconds) ||
      data.sourceDurationSeconds <= 0 || data.sourceDurationSeconds > MAX_SOURCE_SECONDS ||
      !Array.isArray(data.segments) || data.segments.length < 1 || data.segments.length > MAX_SEGMENTS) {
    fail('El proyecto no corresponde a esta fuente o está incompleto.');
  }
  const sorted = [...data.segments].sort((a, b) => a.start - b.start);
  let total = 0;
  let lastEnd = 0;
  for (const clip of sorted) {
    if (!object(clip) || typeof clip.title !== 'string' ||
        clip.title.trim().length === 0 || clip.title.length > 200 ||
        !Number.isFinite(clip.start) || !Number.isFinite(clip.end) ||
        clip.start < lastEnd || clip.end <= clip.start ||
        clip.end - clip.start < 0.1 || clip.end - clip.start > 300 ||
        clip.end > data.sourceDurationSeconds + 0.1 ||
        typeof clip.scriptPrompt !== 'string' || clip.scriptPrompt.length > 5000 ||
        !Number.isSafeInteger(clip.responseLimit) || clip.responseLimit < 0 ||
        clip.responseLimit > 300 || !ROLES.has(clip.speakerRole) ||
        !LANGUAGES.has(clip.language)) {
      fail('Revisa títulos, perfiles, tiempos o instrucciones inválidos.');
    }
    if (clip.speakerRole === 'interpreter') {
      fail('El paquete contiene una intervención del intérprete original; exclúyela antes de generar el ZIP.');
    }
    total += clip.end - clip.start;
    if (total > MAX_TOTAL_SECONDS + 1e-6) {
      fail('El ZIP supera los 15 minutos acumulados de audio.');
    }
    lastEnd = clip.end;
  }
  return sorted;
}

/** SHA-256 of three 128 KiB source slices + length/offset framing. NOT a full-file digest. */
async function fingerprintFile(path, size) {
  const handle = await fs.open(path, 'r');
  try {
    const hash = createHash('sha256');
    hash.update('ir-studio-long-v1|' + size + '|');
    const offsets = [
      0,
      Math.max(0, Math.floor(size / 2) - Math.floor(SAMPLE_BYTES / 2)),
      Math.max(0, size - SAMPLE_BYTES),
    ];
    for (const offset of offsets) {
      const len = Math.min(SAMPLE_BYTES, size - offset);
      const bytes = Buffer.alloc(len);
      const { bytesRead } = await handle.read(bytes, 0, len, offset);
      if (bytesRead !== len) fail('El origen se modificó durante la lectura de muestras.');
      hash.update(offset + '|' + len + '|');
      hash.update(bytes);
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

function durationFromFfmpeg(output) {
  const records = [...output.matchAll(/out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
  const match = records.at(-1);
  return match
    ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    : null;
}

async function transcodeClip(source, target, clip) {
  if (!ffmpegStatic) fail('FFmpeg no está disponible en este equipo.');
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-ss', String(clip.start), '-i', source,
    '-t', String(clip.end - clip.start), '-map', '0:a:0', '-vn',
    '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame',
    '-b:a', '64k', '-progress', 'pipe:2', '-nostats',
    '-y', target,
  ];
  await new Promise((done, reject) => {
    const child = spawn(ffmpegStatic, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let settled = false;
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'),
      Math.min(300_000, 90_000 + (clip.end - clip.start) * 1000));
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else done();
    };
    child.stderr.on('data', data => {
      stderr = (stderr + String(data)).slice(-30000);
    });
    child.on('error', () => finish(new Error('No se pudo iniciar FFmpeg local.')));
    child.on('close', code => {
      if (code !== 0) return finish(new Error('FFmpeg no pudo extraer un clip (o no existe pista de audio).'));
      const actual = durationFromFfmpeg(stderr);
      const expected = clip.end - clip.start;
      if (actual === null || actual + Math.min(0.35, Math.max(0.08, expected * 0.1)) < expected) {
        return finish(new Error('Un corte termina después de la pista de audio o quedó truncado.'));
      }
      finish(null);
    });
  });
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});
function crc32(data) {
  let checksum = 0xffffffff;
  for (const byte of data) checksum = CRC_TABLE[(checksum ^ byte) & 255] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

/** Uncompressed ZIP, compatible with the platform's existing STORE-only importer. */
function makeStoreZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + data.length;
  }
  const centralLength = central.reduce((n, item) => n + item.length, 0);
  const ending = Buffer.alloc(22);
  ending.writeUInt32LE(0x06054b50, 0);
  ending.writeUInt16LE(entries.length, 8);
  ending.writeUInt16LE(entries.length, 10);
  ending.writeUInt32LE(centralLength, 12);
  ending.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, ending]);
}

async function exportLocal({ source, project, output }) {
  const sourceInfo = await fs.stat(source);
  const projectInfo = await fs.stat(project);
  if (!sourceInfo.isFile() || !Number.isSafeInteger(sourceInfo.size) ||
      sourceInfo.size < 1 || sourceInfo.size > MAX_SOURCE_BYTES ||
      !projectInfo.isFile() || projectInfo.size < 1 || projectInfo.size > MAX_PROJECT_BYTES) {
    fail('Archivo fuente o proyecto inexistente, demasiado grande o inválido.');
  }
  const parsed = JSON.parse(await fs.readFile(project, 'utf8'));
  const clips = validateProject(parsed, sourceInfo.size);
  const sourceHash = await fingerprintFile(source, sourceInfo.size);
  if (sourceHash !== parsed.sourceSampleSha256.toLowerCase()) {
    fail('La huella parcial no coincide. Selecciona la grabación original del proyecto.');
  }

  const workdir = await fs.mkdtemp(join(tmpdir(), 'ir-roleplay-local-'));
  try {
    const entries = [];
    const manifest = { version: 1, generator: 'interpretes-rd-roleplay-studio', segments: [] };
    for (const [index, clip] of clips.entries()) {
      const name = 'segment-' + String(index + 1).padStart(2, '0') + '.mp3';
      const path = join(workdir, name);
      await transcodeClip(source, path, clip);
      const info = await fs.stat(path);
      if (!info.isFile() || info.size < 1 || info.size > MAX_CLIP_BYTES) {
        fail('El clip local excede el tamaño permitido.');
      }
      const data = await fs.readFile(path);
      entries.push({ name, data });
      manifest.segments.push({
        order: index,
        title: clip.title.trim(),
        file: name,
        size_bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        duration_limit_sec: clip.responseLimit,
        script_prompt: clip.scriptPrompt,
      });
      // Do not retain every temporary MP3 twice longer than necessary.
      await fs.unlink(path);
      process.stdout.write('Clip ' + (index + 1) + '/' + clips.length + ' preparado\n');
    }
    entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) });
    const archive = makeStoreZip(entries);
    if (archive.length > MAX_ZIP_BYTES) fail('El ZIP excede 16 MiB. Reduce el audio seleccionado.');
    // Recheck source so a changed or overwritten video cannot be accepted.
    const after = await fs.stat(source);
    if (sourceInfo.size !== after.size || sourceInfo.mtimeMs !== after.mtimeMs ||
        sourceHash !== await fingerprintFile(source, after.size)) {
      fail('La grabación original cambió durante la exportación. Repite el proceso.');
    }
    await fs.writeFile(output, archive, { flag: 'wx', mode: 0o600 });
    process.stdout.write('ZIP local generado: ' + basename(output) + '\n');
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  exportLocal(parseArgs(process.argv.slice(2))).catch(error => {
    process.stderr.write('Error: ' + (error instanceof Error ? error.message : 'fallo desconocido') + '\n');
    process.exitCode = 1;
  });
}

export { parseArgs, validateProject, fingerprintFile, makeStoreZip, exportLocal };
