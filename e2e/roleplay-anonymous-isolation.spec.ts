import { test, expect } from '@playwright/test';

// Browser-level negative journeys run only against the isolated E2E server.
// These tests never create a candidate, session, invite, audio object or QA row.
test.describe('Roleplay anonymous authorization boundaries', () => {
  test('short invite links redirect without exposing invitation state', async ({ request }) => {
    const response = await request.get('/r/zzzz-unknown-invite', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toContain('/roleplays/invite-by-code/ZZZZ-UNKNOWN-INVITE');
    expect(await response.text()).not.toContain('Invitation expired');
    expect(await response.text()).not.toContain('Session already used');
  });

  test('a visitor cannot validate or start a roleplay using an unowned token', async ({ request }) => {
    for (const [url, data] of [
      ['/api/roleplay/validate-invite', { token: 'unowned-token' }],
      ['/api/roleplay/validate-invite-by-code', { inviteCode: 'UNOWNEDCODE' }],
      ['/api/roleplay/start', { token: 'unowned-token' }],
    ] as const) {
      const response = await request.post(url, { data });
      const payload = await response.json();
      expect(response.status(), url).toBe(401);
      expect(payload.success, url).toBe(false);
      expect(JSON.stringify(payload), url).not.toMatch(/baseAudioUrl|sourceAudioPath|tokenHash|sessionId/);
      expect(response.headers()['cache-control'], url).toContain('no-store');
      expect(response.headers()['set-cookie'], url).toBeUndefined();
    }
  });

  test('unauthenticated participants cannot access sessions or upload recordings', async ({ request }) => {
    const session = await request.get('/api/roleplay/session/nonexistent-session-id', { maxRedirects: 0 });
    expect(session.status()).toBe(401);
    expect(JSON.stringify(await session.json())).not.toMatch(/sourceAudioUrl|baseAudioUrl|scenarios/);

    const start = await request.post('/api/roleplay/session/nonexistent-session-id/start', { data: {} });
    expect(start.status()).toBe(401);
    expect(JSON.stringify(await start.json())).not.toContain('sessionId');

    const upload = await request.post('/api/roleplay/convert-audio', {
      multipart: {
        sessionId: 'nonexistent-session-id',
        scenarioId: 'nonexistent-scenario-id',
        audio: {
          name: 'recording.webm',
          mimeType: 'audio/webm',
          buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
        },
      },
    });
    expect(upload.status()).toBe(401);
    expect(JSON.stringify(await upload.json())).not.toContain('sourcePath');
    expect(upload.headers()['set-cookie']).toBeUndefined();
  });
});
