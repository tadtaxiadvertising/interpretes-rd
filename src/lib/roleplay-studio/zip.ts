/**
 * Restricted client-side reader for the STORE-only ZIP produced by Audio
 * Studio. This is intentionally not a general ZIP extractor (no deflate,
 * ZIP64, encrypted entries, data descriptors or filesystem paths).
 */
const MAX_ZIP_BYTES = 16 * 1024 * 1024;
const MAX_MP3_BYTES = 15 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 500_000;
const MAX_ENTRIES = 26; // manifest + at most 25 clips
const LOCAL_FILE = 0x04034b50;
const CENTRAL_FILE = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

type Entry = {
  name: string;
  size: number;
  checksum: number;
  localOffset: number;
  file: File;
};

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function malformed(): never {
  throw new Error('El ZIP no es un paquete válido de Roleplay Audio Studio (ZIP STORE sin compresión).');
}

function safeName(name: string): boolean {
  return name === 'manifest.json' || /^segment-(?:0[1-9]|1[0-9]|2[0-5])\.mp3$/.test(name);
}

export async function extractStudioZip(archive: File): Promise<File[]> {
  if (!/\.zip$/i.test(archive.name) || archive.size < 22 || archive.size > MAX_ZIP_BYTES) {
    throw new Error('Selecciona un ZIP de Roleplay Audio Studio de hasta 16 MiB.');
  }
  const bytes = await archive.arrayBuffer();
  const view = new DataView(bytes);
  const length = bytes.byteLength;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const u16 = (offset: number) => {
    if (offset < 0 || offset + 2 > length) malformed();
    return view.getUint16(offset, true);
  };
  const u32 = (offset: number) => {
    if (offset < 0 || offset + 4 > length) malformed();
    return view.getUint32(offset, true);
  };
  const entries: Entry[] = [];
  const names = new Set<string>();
  let offset = 0;

  while (offset + 4 <= length && u32(offset) === LOCAL_FILE) {
    if (entries.length >= MAX_ENTRIES || offset + 30 > length) malformed();
    const flags = u16(offset + 6);
    const method = u16(offset + 8);
    const checksum = u32(offset + 14);
    const compressed = u32(offset + 18);
    const uncompressed = u32(offset + 22);
    const nameLength = u16(offset + 26);
    const extraLength = u16(offset + 28);
    if (flags !== 0x0800 || method !== 0 || compressed !== uncompressed ||
        !nameLength || nameLength > 80 || extraLength !== 0 || compressed === 0) malformed();
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength;
    const dataEnd = dataStart + compressed;
    if (dataEnd > length) malformed();
    let name: string;
    try { name = decoder.decode(new Uint8Array(bytes, nameStart, nameLength)); }
    catch { return malformed(); }
    if (!safeName(name) || names.has(name)) malformed();
    if (name === 'manifest.json' ? compressed > MAX_MANIFEST_BYTES : compressed > MAX_MP3_BYTES) malformed();
    if (crc32(new Uint8Array(bytes, dataStart, compressed)) !== checksum) {
      throw new Error('ZIP dañado: la verificación CRC32 no coincide.');
    }
    names.add(name);
    entries.push({
      name, size: compressed, checksum, localOffset: offset,
      file: new File([bytes.slice(dataStart, dataEnd)], name, {
        type: name.endsWith('.mp3') ? 'audio/mpeg' : 'application/json',
      }),
    });
    offset = dataEnd;
  }

  if (entries.length < 2 || entries[0].name !== 'manifest.json' || u32(offset) !== CENTRAL_FILE) malformed();
  const centralStart = offset;
  for (const entry of entries) {
    if (offset + 46 > length || u32(offset) !== CENTRAL_FILE) malformed();
    const flags = u16(offset + 8);
    const method = u16(offset + 10);
    const checksum = u32(offset + 16);
    const compressed = u32(offset + 20);
    const uncompressed = u32(offset + 24);
    const nameLength = u16(offset + 28);
    const extraLength = u16(offset + 30);
    const commentLength = u16(offset + 32);
    const localOffset = u32(offset + 42);
    if (flags !== 0x0800 || method !== 0 || compressed !== entry.size ||
        uncompressed !== entry.size || checksum !== entry.checksum ||
        localOffset !== entry.localOffset || !nameLength ||
        extraLength !== 0 || commentLength !== 0 || offset + 46 + nameLength > length) malformed();
    let name: string;
    try { name = decoder.decode(new Uint8Array(bytes, offset + 46, nameLength)); }
    catch { return malformed(); }
    if (name !== entry.name) malformed();
    offset += 46 + nameLength;
  }

  if (offset + 22 !== length || u32(offset) !== END_OF_CENTRAL ||
      u16(offset + 4) !== 0 || u16(offset + 6) !== 0 ||
      u16(offset + 8) !== entries.length || u16(offset + 10) !== entries.length ||
      u32(offset + 12) !== offset - centralStart || u32(offset + 16) !== centralStart ||
      u16(offset + 20) !== 0) malformed();
  return entries.map(entry => entry.file);
}
