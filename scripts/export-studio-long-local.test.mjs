import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportLocal, fingerprintFile, parseArgs, validateProject } from './export-studio-long-local.mjs';

function wavFixture() {
  const frames = 16000 * 3;
  const pcm = Buffer.alloc(44 + frames * 2);
  pcm.write('RIFF', 0);
  pcm.writeUInt32LE(pcm.length - 8, 4);
  pcm.write('WAVEfmt ', 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(16000, 24);
  pcm.writeUInt32LE(32000, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36);
  pcm.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    pcm.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 16000) * 6000), 44 + i * 2);
  }
  return pcm;
}

test('the local media exporter makes a valid roleplay STORE ZIP without uploading the source', { timeout: 60000 }, async () => {
  const temp = await fs.mkdtemp(join(tmpdir(), 'studio-export-test-'));
  try {
    const source = join(temp, 'source.wav');
    const project = join(temp, 'project.json');
    const output = join(temp, 'result.zip');
    await fs.writeFile(source, wavFixture());
    const sourceBytes = (await fs.stat(source)).size;
    const sampleHash = await fingerprintFile(source, sourceBytes);
    const draft = {
      format: 'interpretes-rd-studio-long-local-project',
      version: 1,
      sourceSizeBytes: sourceBytes,
      sourceSampleSha256: sampleHash,
      sourceDurationSeconds: 3,
      segments: [
        { title: 'Doctor · 1', start: 0.2, end: 1.8, scriptPrompt: '',
          responseLimit: 120, speakerRole: 'doctor', language: 'en' },
      ],
    };
    await fs.writeFile(project, JSON.stringify(draft));
    await exportLocal({ source, project, output });
    const zip = await fs.readFile(output);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const nameLength = zip.readUInt16LE(26);
    const manifestBytes = zip.readUInt32LE(18);
    assert.equal(zip.subarray(30, 30 + nameLength).toString(), 'manifest.json');
    const manifest = JSON.parse(zip.subarray(30 + nameLength, 30 + nameLength + manifestBytes).toString());
    assert.equal(manifest.generator, 'interpretes-rd-roleplay-studio');
    assert.equal(manifest.segments.length, 1);
    assert.equal(manifest.segments[0].file, 'segment-01.mp3');
    assert.match(manifest.segments[0].sha256, /^[0-9a-f]{64}$/);
    assert.ok(zip.includes(Buffer.from('segment-01.mp3')));
    await assert.rejects(exportLocal({ source, project, output }), /EEXIST/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('invalid or unsafe selection cannot become a local package', () => {
  const base = {
    format: 'interpretes-rd-studio-long-local-project',
    version: 1,
    sourceSizeBytes: 1000,
    sourceSampleSha256: 'ab'.repeat(32),
    sourceDurationSeconds: 43200,
    segments: [{
      title: 'Paciente', start: 14400, end: 14410, scriptPrompt: '',
      responseLimit: 120, speakerRole: 'patient', language: 'es',
    }],
  };
  assert.equal(validateProject(base, 1000).length, 1);
  assert.throws(() => validateProject({ ...base, segments: [
    { ...base.segments[0], speakerRole: 'interpreter' },
  ] }, 1000), /intérprete original/);
  assert.throws(() => validateProject({ ...base, segments: [
    { ...base.segments[0], end: 15000 },
  ] }, 1000), /tiempos/);
  assert.throws(() => validateProject(base, 2000), /no corresponde/);
  assert.throws(() => parseArgs(['--source', 'a.mp4', '--output', 'a.mp4',
    '--project', 'b.json']), /rutas deben ser distintas/);
});
