// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { extractStudioZip } from './zip';
import { prepareRoleplayManifestImport } from '@/lib/roleplay-manifest-import';

function checksum(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildArchive(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const crc = checksum(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, entry.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const size = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function archiveFile(bytes: Buffer): File {
  return new File([new Uint8Array(bytes)], 'roleplay-studio.zip', { type: 'application/zip' });
}

const sound = Buffer.from([0x49, 0x44, 0x33, 0x01, 0x02]);
const manifest = Buffer.from(JSON.stringify({
  segments: [{
    order: 0, title: 'Medical dialogue', file: 'segment-01.mp3',
    size_bytes: sound.length, sha256: createHash('sha256').update(sound).digest('hex'),
    duration_limit_sec: 120, script_prompt: '',
  }],
}));
const validFiles = [
  { name: 'manifest.json', data: manifest },
  { name: 'segment-01.mp3', data: sound },
];

describe('Audio Studio direct ZIP import', () => {
  it('converts a valid STORE ZIP into files accepted by the canonical manifest validator', async () => {
    const extracted = await extractStudioZip(archiveFile(buildArchive(validFiles)));
    expect(extracted.map(file => file.name)).toEqual(['manifest.json', 'segment-01.mp3']);
    const scenarios = await prepareRoleplayManifestImport(extracted);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].title).toBe('Medical dialogue');
    expect(scenarios[0].sha256).toBe(createHash('sha256').update(sound).digest('hex'));
  });

  it('rejects archive corruption before any imported draft is touched', async () => {
    const zip = buildArchive(validFiles);
    const offsetOfAudioPayload = zip.indexOf(sound);
    expect(offsetOfAudioPayload).toBeGreaterThan(0);
    zip[offsetOfAudioPayload] ^= 0xff;
    await expect(extractStudioZip(archiveFile(zip))).rejects.toThrow('CRC32');
  });

  it('rejects a ZIP with valid CRC32 but MP3 content inconsistent with manifest SHA-256', async () => {
    const changedAudio = Buffer.from([0x49, 0x44, 0x33, 0x07, 0x08]);
    const extracted = await extractStudioZip(archiveFile(buildArchive([
      { name: 'manifest.json', data: manifest },
      { name: 'segment-01.mp3', data: changedAudio },
    ])));
    await expect(prepareRoleplayManifestImport(extracted)).rejects.toThrow('SHA-256');
  });

  it('rejects path traversal even when the ZIP is structurally valid', async () => {
    const zip = buildArchive([
      { name: 'manifest.json', data: manifest },
      { name: '../outside.mp3', data: sound },
    ]);
    await expect(extractStudioZip(archiveFile(zip))).rejects.toThrow();
  });

  it('rejects unexpected entries and unsupported compressed archives', async () => {
    const extra = buildArchive([...validFiles, { name: 'private.txt', data: Buffer.from('x') }]);
    await expect(extractStudioZip(archiveFile(extra))).rejects.toThrow();
    const compressed = buildArchive(validFiles);
    compressed.writeUInt16LE(8, 8); // local compression method: deflate
    await expect(extractStudioZip(archiveFile(compressed))).rejects.toThrow();
  });

  it('rejects modified central-directory metadata', async () => {
    const zip = buildArchive(validFiles);
    zip.writeUInt16LE(3, zip.length - 14); // wrong EOCD entry count
    await expect(extractStudioZip(archiveFile(zip))).rejects.toThrow();
  });
});
