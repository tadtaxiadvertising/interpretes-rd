import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { exportLocal, fingerprintFile, parseArgs, validateProject, writeExclusiveZip } from './export-studio-long-local.mjs';

function wavFixture(seconds = 3) {
  const frames = 16000 * seconds;
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


test('v2 physical merge exports one MP3 with selected duration and no intervening silence', { timeout: 60000 }, async () => {
  const temp = await fs.mkdtemp(join(tmpdir(), 'studio-compound-v2-'));
  try {
    const source = join(temp, 'source.wav');
    const project = join(temp, 'compound.json');
    const output = join(temp, 'joined.zip');
    await fs.writeFile(source, wavFixture(6));
    const sourceBytes = (await fs.stat(source)).size;
    const segment = {
      title: 'Doctor · unido', start: 0.2, end: 5.2,
      ranges: [{ start: 0.2, end: 1.2 }, { start: 4, end: 5.2 }],
      scriptPrompt: '', responseLimit: 120, speakerRole: 'doctor', language: 'en',
    };
    const draft = {
      format: 'interpretes-rd-studio-long-local-project', version: 2,
      sourceSizeBytes: sourceBytes, sourceDurationSeconds: 6,
      sourceSampleSha256: await fingerprintFile(source, sourceBytes),
      segments: [segment],
    };
    assert.equal(validateProject(draft, sourceBytes).length, 1);
    assert.throws(() => validateProject({ ...draft, version: 1 }, sourceBytes), /v1/);
    assert.throws(() => validateProject({ ...draft, segments: [{
      ...segment, ranges: [{ start: 0.2, end: 1.2 }, { start: 1.1, end: 5.2 }],
    }] }, sourceBytes), /intervalos compuestos/);
    await fs.writeFile(project, JSON.stringify(draft));
    await exportLocal({ source, project, output });
    const zip = await fs.readFile(output);
    const manifestNameLen = zip.readUInt16LE(26);
    const manifestLen = zip.readUInt32LE(18);
    const manifest = JSON.parse(zip.subarray(30 + manifestNameLen, 30 + manifestNameLen + manifestLen).toString());
    assert.equal(manifest.segments.length, 1);
    const secondOffset = 30 + manifestNameLen + manifestLen;
    const audioNameLen = zip.readUInt16LE(secondOffset + 26);
    const audioLength = zip.readUInt32LE(secondOffset + 18);
    const name = zip.subarray(secondOffset + 30, secondOffset + 30 + audioNameLen).toString();
    assert.equal(name, 'segment-01.mp3');
    const mp3 = zip.subarray(secondOffset + 30 + audioNameLen, secondOffset + 30 + audioNameLen + audioLength);
    const result = spawnSync(ffmpegStatic, [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', 'pipe:0',
      '-f', 'null', '-', '-progress', 'pipe:2', '-nostats',
    ], { input: mp3, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr?.toString().slice(-500));
    const times = [...result.stderr.toString().matchAll(/out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
    assert.ok(times.length, 'FFmpeg must report decoded MP3 duration');
    const last = times.at(-1);
    const length = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
    assert.ok(length > 1.95 && length < 2.5, 'Joined MP3 should contain 2.2s, not the 5-second envelope: ' + length);
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


test('exclusive ZIP writer removes incomplete output if disk writing fails', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'studio-write-failure-'));
  try {
    const output = join(dir, 'incomplete.zip');
    const archive = Buffer.from('synthetic ZIP bytes for fault injection');
    await assert.rejects(
      writeExclusiveZip(output, archive, async (handle, bytes) => {
        await handle.writeFile(bytes.subarray(0, 8));
        throw new Error('simulated disk full');
      }),
      /simulated disk full/,
    );
    await assert.rejects(fs.stat(output), { code: 'ENOENT' });
    // A retry must be possible without manual deletion.
    await writeExclusiveZip(output, archive);
    assert.deepEqual(await fs.readFile(output), archive);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(output)).mode & 0o777, 0o600);
    }
    // A failed duplicate write must never erase the existing archive.
    await assert.rejects(writeExclusiveZip(output, Buffer.from('overwrite')), { code: 'EEXIST' });
    assert.deepEqual(await fs.readFile(output), archive);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
