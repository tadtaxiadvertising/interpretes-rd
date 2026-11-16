import { describe, expect, it, vi } from 'vitest';
import { summarizeRoleplayBaseAudioInventory } from './base-audio-inventory';
import { listRoleplayAudioObjects } from './orphan-mp3-inventory';

const origin = 'https://project.supabase.co';
const old = '2026-10-01T00:00:00Z';
const now = Date.parse('2026-11-15T00:00:00Z');
const object = (
  path: string, createdAt: string | null = old, updatedAt: string | null = old,
) => ({ path, createdAt, updatedAt });
const publicUrl = (path: string) =>
  `${origin}/storage/v1/object/public/roleplay-audio/${path}`;

describe('read-only base-audio inventory', () => {
  it('protects URL references from scenarios, URL/path references from sessions, and reused templates', () => {
    const files = [
      object('base/shared/0.mp3'),
      object('base/session-2/upload-123/0.wav'),
      object('base/not-used/0.webm'),
    ];
    const counts = summarizeRoleplayBaseAudioInventory(
      files,
      [{ baseAudioUrl: publicUrl('base/shared/0.mp3'), baseAudioPath: 'base/session-2/upload-123/0.wav' }],
      [{ baseAudioUrl: publicUrl('base/shared/0.mp3') }],
      origin, now,
    );
    expect(counts).toEqual({
      scannedBaseAudioObjects: 3,
      referencedBaseAudioObjects: 2,
      unverifiableBaseAudioReferences: 0,
      classificationBlocked: false,
      unclassifiableBaseAudioObjects: 0,
      unreferencedBaseAudioYoungerThan14Days: 0,
      unreferencedBaseAudioUnknownAge: 0,
      unreferencedBaseAudioOlderThan14Days: 1,
    });
    expect(JSON.stringify(counts)).not.toContain('base/');
  });

  it('recognizes legacy flat canonical base keys and their trusted URL references', () => {
    const flat = 'base/cklegacy-session.mp3';
    const result = summarizeRoleplayBaseAudioInventory(
      [object(flat), object('base/unreferenced.wav')],
      [{ baseAudioPath: flat, baseAudioUrl: publicUrl(flat) }],
      [{ baseAudioUrl: publicUrl(flat) }],
      origin, now,
    );
    expect(result).toEqual({
      scannedBaseAudioObjects: 2,
      referencedBaseAudioObjects: 1,
      unverifiableBaseAudioReferences: 0,
      classificationBlocked: false,
      unclassifiableBaseAudioObjects: 0,
      unreferencedBaseAudioYoungerThan14Days: 0,
      unreferencedBaseAudioUnknownAge: 0,
      unreferencedBaseAudioOlderThan14Days: 1,
    });
    expect(JSON.stringify(result)).not.toContain(flat);
  });

  it('continues blocking malformed flat keys instead of marking objects safe to delete', () => {
    const invalidPaths = [
      'base/', 'base/..', 'base/.', 'base//recording.mp3',
      'base/../recording.mp3', 'base/recording%2Fsecret.mp3',
    ];
    for (const baseAudioPath of invalidPaths) {
      const result = summarizeRoleplayBaseAudioInventory(
        [object('base/unrelated.mp3')],
        [{ baseAudioPath }], [],
        origin, now,
      );
      expect(result.classificationBlocked).toBe(true);
      expect(result.unreferencedBaseAudioOlderThan14Days).toBe(0);
      expect(result.unverifiableBaseAudioReferences).toBe(1);
    }
  });

  it('never classifies an object as aged when any reference is external or signed', () => {
    const files = [object('base/free/0.wav'), object('base/reused/1.mp3')];
    const result = summarizeRoleplayBaseAudioInventory(files,
      [{ baseAudioUrl: 'https://elsewhere.invalid/private/audio.mp3' }],
      [{ baseAudioUrl: publicUrl('base/reused/1.mp3') + '?token=PRIVATE_TOKEN' }],
      origin, now,
    );
    expect(result.classificationBlocked).toBe(true);
    expect(result.unverifiableBaseAudioReferences).toBe(2);
    expect(result.unclassifiableBaseAudioObjects).toBe(2);
    expect(result.unreferencedBaseAudioOlderThan14Days).toBe(0);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN');
  });

  it('does not mark empty DRAFT references as unverifiable', () => {
    const result = summarizeRoleplayBaseAudioInventory(
      [object('base/unused/0.mp3')], [{ baseAudioUrl: '', baseAudioPath: null }],
      [], origin, now,
    );
    expect(result.unverifiableBaseAudioReferences).toBe(0);
    expect(result.unreferencedBaseAudioOlderThan14Days).toBe(1);
  });

  it('treats recently updated, future, invalid, and duplicated timestamps conservatively', () => {
    const date = '2026-11-14T00:00:00Z';
    const files = [
      object('base/new/0.mp3', date, date),
      object('base/recently-touched/0.mp4', old, date),
      object('base/future/0.wav', '2026-11-19T00:00:00Z'),
      object('base/missing/0.webm', null, null),
      object('base/duplicate/0.ogg'), object('base/duplicate/0.ogg', date, date),
    ];
    const result = summarizeRoleplayBaseAudioInventory(files, [], [], origin, now);
    expect(result.scannedBaseAudioObjects).toBe(5);
    expect(result.unreferencedBaseAudioYoungerThan14Days).toBe(2);
    expect(result.unreferencedBaseAudioUnknownAge).toBe(3);
    expect(result.unreferencedBaseAudioOlderThan14Days).toBe(0);
  });

  it('blocks classification for malformed canonical path references', () => {
    const result = summarizeRoleplayBaseAudioInventory(
      [object('base/a/0.mp3')], [{ baseAudioPath: 'base/../a/0.mp3' }],
      [], origin, now,
    );
    expect(result.classificationBlocked).toBe(true);
    expect(result.unreferencedBaseAudioOlderThan14Days).toBe(0);
  });

  it('includes admin WAV files in the paginated Storage inventory and never deletes', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        { name: 'recording.wav', id: 'wav', created_at: old, updated_at: old },
        { name: 'recording.MP3', id: 'mp3', created_at: old, updated_at: old },
        { name: 'meta.json', id: 'json' },
      ], error: null,
    });
    const storage = { storage: { from: () => ({ list }) } } as unknown as Parameters<typeof listRoleplayAudioObjects>[0];
    const found = await listRoleplayAudioObjects(storage, 'roleplay-audio', 'base');
    expect(found).toHaveLength(2);
    expect(found.map(item => item.path)).toEqual(['base/recording.wav', 'base/recording.MP3']);
    expect(list).toHaveBeenCalledWith('base', expect.objectContaining({ limit: 1000, offset: 0 }));
  });
});
