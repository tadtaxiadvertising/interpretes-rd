// @vitest-environment node
import { createHash, webcrypto } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { extractExternalStudioZip } from './external-zip';
import { prepareRoleplayManifestImport } from '@/lib/roleplay-manifest-import';

type Input = { name: string; content: Buffer };
type Options = { method?: 0 | 8; descriptor?: boolean; descriptorSignature?: boolean };

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries: Input[], options: Options = {}): Buffer {
  const method = options.method ?? 0;
  const flags = 0x0800 | (options.descriptor ? 0x0008 : 0);
  const locals: Buffer[] = [];
  const centers: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const contents = entry.content;
    const compressed = method === 8 ? deflateRawSync(contents) : contents;
    const crc = crc32(contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(options.descriptor ? 0 : crc, 14);
    local.writeUInt32LE(options.descriptor ? 0 : compressed.length, 18);
    local.writeUInt32LE(options.descriptor ? 0 : contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    let descriptor = Buffer.alloc(0);
    if (options.descriptor) {
      const hasSignature = options.descriptorSignature !== false;
      const dataStart = hasSignature ? 4 : 0;
      descriptor = Buffer.alloc(hasSignature ? 16 : 12);
      if (hasSignature) descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, dataStart);
      descriptor.writeUInt32LE(compressed.length, dataStart + 4);
      descriptor.writeUInt32LE(contents.length, dataStart + 8);
    }
    locals.push(local, name, compressed, descriptor);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centers.push(central, name);
    offset += local.length + name.length + compressed.length + descriptor.length;
  }
  const center = Buffer.concat(centers);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(center.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, center, eocd]);
}

const mp3a = Buffer.from('ID3-clip-one');
const mp3b = Buffer.from('ID3-clip-two');
const master = Buffer.from('ID3-master-must-not-publish');
const speaker = Buffer.from('ID3-private-track');
const names = ['001_SPK1_EN_0s0_2s0.mp3', '002_SPK2_ES_2s0_4s0.mp3'];
const manifest = {
  roleplayAudioStudioVersion: '1.0.0',
  project: { name: 'Medical', durationSeconds: 4 },
  files: {
    manifest: 'manifest.json',
    clips: names,
    masteredMp3: 'Roleplay_Masterizado_Con_Pausas.mp3',
    masteredWav: null,
    speakerTracks: [{ speaker: 'speaker_1', mp3File: 'Pista_01_Paciente.mp3' }],
  },
  segments: [
    { turn: 1, speaker: 'speaker_1', speakerName: 'Sensitive Person',
      language: 'en', startTime: 0, endTime: 2,
      text: 'PRIVATE DIAGNOSIS', notes: 'DO NOT SHOW QA ANSWERS', mp3File: names[0] },
    { turn: 2, speaker: 'speaker_2', speakerName: 'Another Person',
      language: 'es', startTime: 2, endTime: 4,
      text: 'PRIVATE PHI', mp3File: names[1] },
  ],
};

function files(source: unknown = manifest): Input[] {
  return [
    { name: 'manifest.json', content: Buffer.from(JSON.stringify(source)) },
    { name: names[0], content: mp3a },
    { name: names[1], content: mp3b },
    { name: 'Roleplay_Masterizado_Con_Pausas.mp3', content: master },
    { name: 'Pista_01_Paciente.mp3', content: speaker },
  ];
}
function archive(buffer: Buffer) {
  return new File([new Uint8Array(buffer)], 'audio-studio-externo.zip', { type: 'application/zip' });
}

describe('secure direct external Audio Studio ZIP import', () => {
  beforeAll(() => vi.stubGlobal('crypto', webcrypto));
  afterAll(() => vi.unstubAllGlobals());

  it.each([
    ['STORE', { method: 0 as const }],
    ['DEFLATE', { method: 8 as const }],
    ['DEFLATE with data descriptors', { method: 8 as const, descriptor: true }],
  ])('imports %s package into neutral canonical scenarios and excludes auxiliary tracks',
    async (_name, options) => {
      const extracted = await extractExternalStudioZip(archive(buildZip(files(), options)));
      expect(extracted.map(file => file.name)).toEqual(['manifest.json', ...names]);
      const prepared = await prepareRoleplayManifestImport(extracted);
      expect(prepared).toHaveLength(2);
      expect(prepared.map(s => s.title)).toEqual(['Intervención 1', 'Intervención 2']);
      expect(prepared.map(s => s.baseAudioFile.name)).toEqual(names);
      expect(prepared.every(s => !s.scriptPrompt)).toBe(true);
      expect(JSON.stringify(prepared.map(s => ({ title: s.title, scriptPrompt: s.scriptPrompt }))))
        .not.toMatch(/PRIVATE|Sensitive|DIAGNOSIS/);
      expect(prepared[0].sha256).toBe(createHash('sha256').update(mp3a).digest('hex'));
    });

  it('accepts valid signed and unsigned ZIP data descriptors', async () => {
    for (const descriptorSignature of [true, false]) {
      const contents = await extractExternalStudioZip(
        archive(buildZip(files(), { method: 8, descriptor: true, descriptorSignature })),
      );
      expect(contents.map(file => file.name)).toEqual(['manifest.json', ...names]);
    }
  });

  it('rejects a corrupt data descriptor even when the central CRC remains valid', async () => {
    const bytes = buildZip(files(), { method: 8, descriptor: true });
    const signature = Buffer.from([0x50, 0x4b, 0x07, 0x08]);
    const descriptorOffset = bytes.indexOf(signature);
    expect(descriptorOffset).toBeGreaterThan(0);
    bytes[descriptorOffset + 4] ^= 0xff;
    await expect(extractExternalStudioZip(archive(bytes))).rejects.toThrow(/ZIP externo inválido/);
  });

  it('rejects contradictory CRC values in a descriptor-enabled local header', async () => {
    const bytes = buildZip(files(), { method: 8, descriptor: true });
    bytes.writeUInt32LE(0x12345678, 14);
    await expect(extractExternalStudioZip(archive(bytes))).rejects.toThrow(/ZIP externo inválido/);
  });

  it('rejects unreferenced payload bytes between entries and the central directory', async () => {
    const original = buildZip(files());
    const centralStart = original.readUInt32LE(original.length - 22 + 16);
    const hidden = Buffer.from('undeclared-archive-payload');
    const bytes = Buffer.concat([
      original.subarray(0, centralStart),
      hidden,
      original.subarray(centralStart),
    ]);
    bytes.writeUInt32LE(centralStart + hidden.length, bytes.length - 22 + 16);
    await expect(extractExternalStudioZip(archive(bytes))).rejects.toThrow(/ZIP externo inválido/);
  });

  it('rejects undeclared files, traversal paths and duplicate case-folded names', async () => {
    await expect(extractExternalStudioZip(archive(buildZip([
      ...files(), { name: 'secret.txt', content: Buffer.from('secret') },
    ])))).rejects.toThrow();
    await expect(extractExternalStudioZip(archive(buildZip([
      ...files(), { name: '../outside.mp3', content: mp3a },
    ])))).rejects.toThrow();
    await expect(extractExternalStudioZip(archive(buildZip([
      ...files(), { name: names[0].toUpperCase(), content: mp3a },
    ])))).rejects.toThrow();
  });

  it('rejects corrupt CRCs and truncated ZIP before returning any clips', async () => {
    const bytes = buildZip(files());
    const start = bytes.indexOf(mp3a);
    expect(start).toBeGreaterThan(0);
    bytes[start] ^= 0xff;
    await expect(extractExternalStudioZip(archive(bytes))).rejects.toThrow(/CRC32/);
    const truncated = buildZip(files()).subarray(0, -5);
    await expect(extractExternalStudioZip(archive(truncated))).rejects.toThrow();
  });

  it('rejects a package missing a declared clip even if a master track is available', async () => {
    const missing = files().filter(entry => entry.name !== names[1]);
    await expect(extractExternalStudioZip(archive(buildZip(missing)))).rejects.toThrow();
  });

  it('rejects large claimed output before decompression (ZIP-bomb guard)', async () => {
    const bytes = buildZip(files(), { method: 8 });
    const eocdStart = bytes.length - 22;
    let center = bytes.readUInt32LE(eocdStart + 16);
    center += 46 + Buffer.byteLength('manifest.json');
    bytes.writeUInt32LE(50 * 1024 * 1024, center + 24);
    await expect(extractExternalStudioZip(archive(bytes))).rejects.toThrow();
  });

  it('rejects a schema without the external version marker rather than treating native ZIPs as external', async () => {
    const altered = { ...manifest, roleplayAudioStudioVersion: undefined };
    await expect(extractExternalStudioZip(archive(buildZip(files(altered))))).rejects.toThrow();
  });
});
