// @vitest-environment node
/**
 * Cross-runtime contract check:
 * Python desktop ZIP builder -> strict production TypeScript ZIP reader
 * -> canonical manifest/SHA-256 importer.
 *
 * No real patient audio, FFmpeg, server, or network is used here.
 * Real FFmpeg conversion has separate Python CI coverage.
 */
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { extractStudioZip } from './zip';
import { prepareRoleplayManifestImport } from '@/lib/roleplay-manifest-import';

function choosePython(): string | null {
  for (const binary of ['python3', 'python']) {
    const probe = spawnSync(binary, ['-c',
      'import sys; assert sys.version_info >= (3, 10)'],
    { encoding: 'utf8', timeout: 5000 });
    if (probe.status === 0) return binary;
  }
  return null;
}

const python = choosePython();

describe('Desktop ZIP ↔ production native importer', () => {
  beforeAll(() => vi.stubGlobal('crypto', webcrypto));
  afterAll(() => vi.unstubAllGlobals());

  it('imports and checks SHA-256 from the actual Python desktop ZIP writer', async () => {
    if (!python) {
      if (process.env.CI) throw new Error('Python 3.10+ required by desktop interop CI test');
      return;
    }
    const root = mkdtempSync(join(tmpdir(), 'roleplay-native-zip-contract-'));
    try {
      const archivePath = join(root, 'studio-fixture.zip');
      const script = resolve(process.cwd(),
        'tools/roleplay-studio-desktop/emit_native_zip_fixture.py');
      const result = spawnSync(python, [script, archivePath], {
        encoding: 'utf8', timeout: 15000, cwd: process.cwd(),
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);

      const archive = readFileSync(archivePath);
      const extracted = await extractStudioZip(
        new File([new Uint8Array(archive)], 'studio-fixture.zip', { type: 'application/zip' }),
      );
      expect(extracted.map(file => file.name)).toEqual([
        'manifest.json', 'segment-01.mp3',
      ]);
      const scenarios = await prepareRoleplayManifestImport(extracted);
      expect(scenarios).toHaveLength(1);
      expect(scenarios[0].title).toBe('Triaje · dolor torácico (prueba sintética)');
      expect(scenarios[0].scriptPrompt).toBe(
        '¿Puede describir el dolor? Solo contenido ficticio.',
      );
      expect(scenarios[0].durationLimitSec).toBe(120);

      // Mutate only the data payload, not CRC32 or the manifest, so the strict
      // reader must reject corruption before importing a scenario.
      const corrupt = Buffer.from(archive);
      const marker = Buffer.from('roleplay-fixture', 'utf8');
      const payloadOffset = corrupt.indexOf(marker);
      expect(payloadOffset).toBeGreaterThan(0);
      corrupt[payloadOffset] ^= 1;
      await expect(extractStudioZip(
        new File([new Uint8Array(corrupt)], 'corrupt.zip', { type: 'application/zip' }),
      )).rejects.toThrow('CRC32');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
