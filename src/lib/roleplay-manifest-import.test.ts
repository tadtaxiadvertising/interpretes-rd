// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
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
  beforeAll(() => vi.stubGlobal('crypto', webcrypto));
  afterAll(() => vi.unstubAllGlobals());

  it('imports all 21 checked MP3s in manifest order even when input order differs', async () => {
    const { files } = createFixture(21);
    const scenarios = await prepareRoleplayManifestImport([files[0], ...files.slice(1).reverse()]);
    expect(scenarios).toHaveLength(21);
    expect(scenarios[0].title).toBe('Clinical segment 1');
    expect(scenarios[20].baseAudioFile.name).toBe('medical-21-en.mp3');
    expect(scenarios[0].scriptPrompt).toBe('Interpreta consecutivamente');
  });

  it('matches MP3 filenames without case sensitivity', async () => {
    const { files } = createFixture(1);
    const originalAudio = files[1];
    const renamedAudio = new File([await originalAudio.arrayBuffer()], 'MEDICAL-01-EN.MP3', { type: 'audio/mpeg' });
    const imported = await prepareRoleplayManifestImport([files[0], renamedAudio]);
    expect(imported[0].baseAudioFile.name).toBe('MEDICAL-01-EN.MP3');
  });

  it('returns a server-verifiable checksum even when the manifest omits one', async () => {
    const { files } = createFixture(1);
    const manifest = JSON.parse(await files[0].text());
    delete manifest.segments[0].sha256;
    const imported = await prepareRoleplayManifestImport([
      new File([JSON.stringify(manifest)], 'MANIFEST.JSON', { type: 'application/json' }),
      files[1],
    ]);
    expect(imported[0].sha256).toBe(createHash('sha256').update(Buffer.from('audio 0')).digest('hex'));
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

describe('external Roleplay Audio Studio manifest import', () => {
  // The native-manifest describe has its own crypto stub lifecycle; restore
  // WebCrypto explicitly for this separate describe in the Node test runner.
  beforeAll(() => vi.stubGlobal('crypto', webcrypto));
  afterAll(() => vi.unstubAllGlobals());

  function externalFixture(options?: {
    missingClip?: boolean;
    includeMaster?: boolean;
    missingIndividualReferences?: boolean;
    overlap?: boolean;
    extraFile?: boolean;
  }) {
    const names = ['001_SPK1_EN_0s0_2s0.mp3', '002_SPK2_ES_2s0_4s0.mp3'];
    const manifest = {
      roleplayAudioStudioVersion: '1.0.0',
      project: {
        name: 'Medical call',
        originalFileName: 'private-recording.mp3',
        durationSeconds: 4,
        sampleRate: 44100,
        specialty: 'medical',
      },
      files: {
        manifest: 'manifest.json',
        clips: names,
        speakerTracks: [
          { speaker: 'speaker_1', speakerName: 'Patient Name', mode: 'synchronized', mp3File: 'Pista_01_Patient.mp3' },
        ],
        masteredMp3: 'Roleplay_Masterizado_Con_Pausas.mp3',
        masteredWav: null,
      },
      segments: [
        {
          turn: 1,
          speaker: 'speaker_1',
          speakerName: 'Sensitive Patient Name',
          language: 'en',
          startTime: 0,
          endTime: 2,
          duration: 2,
          text: 'PRIVATE CLINICAL TRANSCRIPT',
          notes: 'PRIVATE EVALUATOR ANSWERS',
          mp3File: options?.missingIndividualReferences ? undefined : names[0],
        },
        {
          turn: 2,
          speaker: 'speaker_2',
          speakerName: 'Dr Smith',
          language: 'es',
          startTime: options?.overlap ? 1 : 2,
          endTime: 4,
          duration: 2,
          text: 'PRIVATE DIAGNOSIS',
          mp3File: names[1],
        },
      ],
    };
    const assets = [
      new File(['ID3-001'], names[0], { type: 'audio/mpeg' }),
      new File(['ID3-002'], names[1], { type: 'audio/mpeg' }),
    ];
    if (options?.missingClip) assets.pop();
    if (options?.includeMaster) assets.push(
      new File(['ID3-MASTER'], 'Roleplay_Masterizado_Con_Pausas.mp3', { type: 'audio/mpeg' }),
      new File(['ID3-SPEAKER'], 'Pista_01_Patient.mp3', { type: 'audio/mpeg' }),
    );
    if (options?.extraFile) assets.push(new File(['untrusted'], 'unexpected.mp3', { type: 'audio/mpeg' }));
    return [
      new File([JSON.stringify(manifest)], 'manifest.json', { type: 'application/json' }),
      ...assets,
    ];
  }

  it('imports only individual clips, ignoring declared tracks and mastered audio', async () => {
    const files = externalFixture({ includeMaster: true });
    const imported = await prepareRoleplayManifestImport(files.reverse());
    expect(imported).toHaveLength(2);
    expect(imported.map(x => x.title)).toEqual(['Intervención 1', 'Intervención 2']);
    expect(imported.map(x => x.baseAudioFile.name)).toEqual([
      '001_SPK1_EN_0s0_2s0.mp3',
      '002_SPK2_ES_2s0_4s0.mp3',
    ]);
    expect(imported.every(x => x.scriptPrompt === '' && x.durationLimitSec === 0)).toBe(true);
    expect(JSON.stringify(imported.map(x => ({
      title: x.title, scriptPrompt: x.scriptPrompt,
    })))).not.toMatch(/Sensitive|PRIVATE|Smith/);
    expect(imported[0].sha256).toBe(createHash('sha256').update('ID3-001').digest('hex'));
  });

  it('accepts optional null speaker tracks without exposing private metadata', async () => {
    const input = externalFixture();
    const raw = JSON.parse(await input[0].text());
    raw.files.speakerTracks[0].mp3File = null;
    const imported = await prepareRoleplayManifestImport([
      new File([JSON.stringify(raw)], 'manifest.json', { type: 'application/json' }),
      ...input.slice(1),
    ]);
    expect(imported.map(s => s.title)).toEqual(['Intervención 1', 'Intervención 2']);
    expect(imported.every(s => s.scriptPrompt === '')).toBe(true);
    expect(JSON.stringify(imported)).not.toMatch(/PRIVATE CLINICAL|Sensitive Patient|PRIVATE DIAGNOSIS/);
  });

  it('rejects malformed non-null speaker track references', async () => {
    const input = externalFixture();
    const raw = JSON.parse(await input[0].text());
    raw.files.speakerTracks[0].mp3File = 123;
    await expect(prepareRoleplayManifestImport([
      new File([JSON.stringify(raw)], 'manifest.json', { type: 'application/json' }),
      ...input.slice(1),
    ])).rejects.toThrow(/referencias o tiempos inválidos/);
  });

  it('rejects a package without all its individual clips (never use master as a substitute)', async () => {
    await expect(prepareRoleplayManifestImport(externalFixture({
      missingClip: true, includeMaster: true,
    }))).rejects.toThrow(/Faltan MP3/);
  });

  it('rejects undeclared MP3 files, inconsistent manifest references and overlaps', async () => {
    await expect(prepareRoleplayManifestImport(externalFixture({ extraFile: true })))
      .rejects.toThrow(/referencias o tiempos inválidos/);
    await expect(prepareRoleplayManifestImport(externalFixture({ missingIndividualReferences: true })))
      .rejects.toThrow(/referencias o tiempos inválidos/);
    await expect(prepareRoleplayManifestImport(externalFixture({ overlap: true })))
      .rejects.toThrow(/referencias o tiempos inválidos/);
  });

  it('keeps the canonical native manifest format unchanged', async () => {
    const native = createFixture(2).files;
    const result = await prepareRoleplayManifestImport(native);
    expect(result[0].title).toBe('Clinical segment 1');
    expect(result[0].scriptPrompt).toBe('Interpreta consecutivamente');
  });
});
