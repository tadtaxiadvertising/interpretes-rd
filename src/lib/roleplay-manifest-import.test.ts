// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { prepareRoleplayManifestImport } from './roleplay-manifest-import';

function createFixture(count: number, overrides?: { size?: number; wrongHash?: boolean }) {
  const files: File[] = [];
  const segments = Array.from({ length: count }, (_, index) => {
    const name = `medical-${String(index + 1).padStart(2, '0')}-en.mp3`;
    const payload = Buffer.from(`audio ${index}`);
    const sha256 = createHash('sha256').update(payload).digest('hex');
    files.push(new File([payload], name, { type: 'audio/mpeg' }));
    return {
      order: index,
      file: name,
      title: `Clinical segment ${index + 1}`,
      size_bytes: overrides?.size ?? payload.byteLength,
      sha256: overrides?.wrongHash && index === 0 ? '0'.repeat(64) : sha256,
      duration_limit_sec: 0,
      script_prompt: 'Interpreta consecutivamente',
    };
  });
  const manifest = new File([JSON.stringify({ schema_version: '1.1', segments })], 'manifest.json', { type: 'application/json' });
  return { files: [manifest, ...files], manifest };
}

describe('prepareRoleplayManifestImport', () => {
  it('imports all 21 checked MP3s in manifest order even when input order differs', async () => {
    const { files } = createFixture(21);
    const scenarios = await prepareRoleplayManifestImport([files[0], ...files.slice(1).reverse()]);
    expect(scenarios).toHaveLength(21);
    expect(scenarios[0].title).toBe('Clinical segment 1');
    expect(scenarios[20].baseAudioFile.name).toBe('medical-21-en.mp3');
    expect(scenarios[0].scriptPrompt).toBe('Interpreta consecutivamente');
  });

  it('rejects files changed after checksum generation', async () => {
    const { files } = createFixture(2, { wrongHash: true });
    await expect(prepareRoleplayManifestImport(files)).rejects.toThrow(/SHA-256/);
  });

  it('rejects a missing MP3 without touching editor state', async () => {
    const { files } = createFixture(3);
    await expect(prepareRoleplayManifestImport(files.slice(0, -1))).rejects.toThrow(/cantidad de MP3/);
  });

  it('rejects unexpected files and duplicate manifest files', async () => {
    const { files, manifest } = createFixture(1);
    await expect(prepareRoleplayManifestImport([...files, new File(['x'], 'extra.txt')])).rejects.toThrow(/Archivo no permitido/);
    await expect(prepareRoleplayManifestImport([...files, manifest])).rejects.toThrow(/exactamente un manifest/);
  });

  it('rejects malformed and noncontiguous manifest indexes', async () => {
    const { files } = createFixture(2);
    const broken = JSON.parse(await files[0].text());
    broken.segments[1].order = 10;
    await expect(prepareRoleplayManifestImport([
      new File([JSON.stringify(broken)], 'manifest.json', { type: 'application/json' }),
      ...files.slice(1),
    ])).rejects.toThrow(/consecutivo/);
  });

  it('rejects 26 scenarios and invalid manifest-declared file size', async () => {
    await expect(prepareRoleplayManifestImport(createFixture(26).files)).rejects.toThrow(/entre 1 y 25/);
    await expect(prepareRoleplayManifestImport(createFixture(1, { size: 1000 }).files)).rejects.toThrow(/Tamaño no coincide/);
  });
});
