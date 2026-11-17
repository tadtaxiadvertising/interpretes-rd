// @vitest-environment node
/**
 * Real end-to-end offline contract:
 * generated non-clinical MP4 -> browser's sampled fingerprint and project JSON
 * -> Python desktop exporter using real FFmpeg -> ZIP STORE -> the actual
 * TypeScript ZIP reader + manifest importer -> decodable MP3 fragments.
 *
 * Never accesses the app server or real recordings. Uses tiny temp files only.
 */
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLongMediaDraft, fingerprintLocalMedia } from './long-media';
import { extractStudioZip } from './zip';
import { prepareRoleplayManifestImport } from '@/lib/roleplay-manifest-import';

function choosePython(): string | null {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [
      '-c', 'import sys; assert sys.version_info >= (3, 11)',
    ], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) return executable;
  }
  return null;
}

const python = choosePython();

function run(command: string, args: string[], timeout = 20_000, input?: Buffer) {
  return spawnSync(command, args, {
    encoding: 'utf8', timeout, input, maxBuffer: 1024 * 1024,
  });
}

describe('real long-video local export -> production manifest import', () => {
  beforeAll(() => vi.stubGlobal('crypto', webcrypto));
  afterAll(() => vi.unstubAllGlobals());

  it('extracts two distant audio interventions from an MP4 without sending the source anywhere', async () => {
    if (!python || !ffmpegStatic) {
      if (process.env.CI) throw new Error('CI needs Python 3.11+ and ffmpeg-static');
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), 'roleplay-real-video-export-'));
    try {
      const videoPath = join(dir, 'call-source.mp4');
      const projectPath = join(dir, 'studio-project.json');
      const zipPath = join(dir, 'roleplay.zip');

      // Four seconds of artificial audio and black video, no clinical data.
      const generate = run(ffmpegStatic, [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-f', 'lavfi', '-i', 'color=c=black:s=128x72:r=2:d=4',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=4',
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'mpeg4', '-q:v', '10',
        '-c:a', 'aac', '-b:a', '64k', '-shortest', '-y', videoPath,
      ]);
      expect(generate.status, generate.stderr || generate.error?.message).toBe(0);

      // Fingerprint and JSON come from the browser's real TypeScript functions,
      // not a second hand-built version of the project contract.
      const original = readFileSync(videoPath);
      const source = new File([new Uint8Array(original)], 'call-source.mp4', {
        type: 'video/mp4',
      });
      const sampledSha = await fingerprintLocalMedia(source);
      const project = createLongMediaDraft(source.size, sampledSha, [
        {
          title: 'Doctor · synthetic start', start: 0.25, end: 1.25,
          scriptPrompt: 'Escucha y responde.', responseLimit: 90,
          speakerRole: 'doctor', language: 'en',
        },
        {
          title: 'Paciente · synthetic end', start: 2.25, end: 3.50,
          scriptPrompt: '', responseLimit: 120,
          speakerRole: 'patient', language: 'es',
        },
      ], 4);
      writeFileSync(projectPath, JSON.stringify(project), { mode: 0o600 });

      // Exercise the real Python exporter, not the dummy ZIP fixture creator.
      const bridge = resolve(process.cwd(),
        'tools/roleplay-studio-desktop/export_integration_fixture.py');
      const result = run(python, [
        bridge, videoPath, projectPath, zipPath, ffmpegStatic,
      ], 60_000);
      expect(result.status, result.stderr || result.error?.message).toBe(0);
      const report = JSON.parse(result.stdout) as { clips: number; size_bytes: number };
      expect(report.clips).toBe(2);
      expect(report.size_bytes).toBeGreaterThan(1000);
      expect(report.size_bytes).toBeLessThan(16 * 1024 * 1024);

      const bytes = readFileSync(zipPath);
      const extracted = await extractStudioZip(new File([
        new Uint8Array(bytes),
      ], 'roleplay.zip', { type: 'application/zip' }));
      expect(extracted.map(file => file.name)).toEqual([
        'manifest.json', 'segment-01.mp3', 'segment-02.mp3',
      ]);
      const scenarios = await prepareRoleplayManifestImport(extracted);
      expect(scenarios.map(scenario => scenario.title)).toEqual([
        'Doctor · synthetic start', 'Paciente · synthetic end',
      ]);
      expect(scenarios.map(scenario => scenario.durationLimitSec)).toEqual([90, 120]);
      expect(scenarios.map(scenario => scenario.scriptPrompt)).toEqual([
        'Escucha y responde.', '',
      ]);

      // Both clips contain valid audio, not just nominal MP3 file extensions.
      for (const scenario of scenarios) {
        const payload = Buffer.from(await scenario.baseAudioFile.arrayBuffer());
        const playback = run(ffmpegStatic, [
          '-hide_banner', '-loglevel', 'error', '-nostdin',
          '-f', 'mp3', '-i', 'pipe:0',
          '-map', '0:a:0', '-f', 'null', '-',
        ], 20_000, payload);
        expect(playback.status, playback.stderr || playback.error?.message).toBe(0);
        expect(payload.length).toBeGreaterThan(1000);
      }
      // Only a project JSON and two extracted clips cross into the ZIP; the
      // unselected original video is never bundled or uploaded.
      expect(extracted.every(file => !/\.mp4$/i.test(file.name))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
  it('exports one truly gapless MP3 from v2 JSON and imports it through the real ZIP contract', async () => {
    if (!python || !ffmpegStatic) {
      if (process.env.CI) throw new Error('CI needs Python and ffmpeg-static');
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'roleplay-v2-merge-'));
    try {
      const sourcePath = join(dir, 'source.wav');
      const projectPath = join(dir, 'project-v2.json');
      const zipPath = join(dir, 'joined.zip');
      const generated = run(ffmpegStatic, [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=6',
        '-c:a', 'pcm_s16le', '-y', sourcePath,
      ]);
      expect(generated.status, generated.stderr || generated.error?.message).toBe(0);
      const original = readFileSync(sourcePath);
      const source = new File([new Uint8Array(original)], 'source.wav', { type: 'audio/wav' });
      const project = createLongMediaDraft(source.size, await fingerprintLocalMedia(source), [{
        title: 'Médico · dos fragmentos sin pausa',
        start: 0.2, end: 5.2,
        ranges: [{ start: 0.2, end: 1.2 }, { start: 4, end: 5.2 }],
        scriptPrompt: '', responseLimit: 120,
        speakerRole: 'doctor', language: 'en',
      }], 6);
      expect(project.version).toBe(2);
      writeFileSync(projectPath, JSON.stringify(project), { mode: 0o600 });
      const exporter = resolve(process.cwd(),
        'tools/roleplay-studio-desktop/export_integration_fixture.py');
      const result = run(python, [exporter, sourcePath, projectPath, zipPath, ffmpegStatic], 60_000);
      expect(result.status, result.stderr || result.error?.message).toBe(0);

      const files = await extractStudioZip(new File([
        new Uint8Array(readFileSync(zipPath)),
      ], 'joined.zip', { type: 'application/zip' }));
      expect(files.map(file => file.name)).toEqual(['manifest.json', 'segment-01.mp3']);
      const scenarios = await prepareRoleplayManifestImport(files);
      expect(scenarios).toHaveLength(1);
      expect(scenarios[0].title).toBe('Médico · dos fragmentos sin pausa');

      const mp3 = Buffer.from(await scenarios[0].baseAudioFile.arrayBuffer());
      const probe = run(ffmpegStatic, [
        '-hide_banner', '-nostdin', '-loglevel', 'error',
        '-f', 'mp3', '-i', 'pipe:0', '-f', 'null', '-',
        '-progress', 'pipe:2', '-nostats',
      ], 30_000, mp3);
      expect(probe.status, probe.stderr || probe.error?.message).toBe(0);
      const records = [...probe.stderr.matchAll(/out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
      expect(records.length).toBeGreaterThan(0);
      const last = records.at(-1)!;
      const seconds = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
      expect(seconds).toBeGreaterThan(1.95);
      expect(seconds).toBeLessThan(2.5); // 2.2 s selected, 5 s envelope
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

});
