import { describe, expect, it } from 'vitest';
import { formatAudioStudioSafeDiagnostic } from './audio-studio-safe-diagnostic';

describe('Audio Studio safe admin diagnostic', () => {
  it('reports server readiness without IDs, keys, ciphertext or provider data', () => {
    const result = formatAudioStudioSafeDiagnostic({
      encryptionReady: false,
      credentialUsable: false,
      tokenSource: 'panel',
      integrationEnabled: true,
      organizationId: '982734019',
    });
    expect(result).toContain('Cifrado disponible en Next.js: no');
    expect(result).toContain('Credencial HappyScribe utilizable: no');
    expect(result).toContain('Origen de credencial: panel');
    expect(result).toContain('Organización numérica configurada: sí');
    expect(result).not.toContain('982734019');
    expect(result).not.toContain('AUDIO_STUDIO_ENCRYPTION_KEY=');
  });

  it('does not echo unknown token source or untrusted organization value', () => {
    const result = formatAudioStudioSafeDiagnostic({
      encryptionReady: true,
      credentialUsable: true,
      tokenSource: 'SYNTHETIC_SECRET_UNTRUSTED_SOURCE',
      integrationEnabled: false,
      organizationId: 'SYNTHETIC_PRIVATE_ORG_ID',
    });
    expect(result).toContain('Origen de credencial: desconocido');
    expect(result).toContain('Organización numérica configurada: no');
    expect(result).not.toContain('SYNTHETIC_SECRET_UNTRUSTED_SOURCE');
    expect(result).not.toContain('SYNTHETIC_PRIVATE_ORG_ID');
  });
});
