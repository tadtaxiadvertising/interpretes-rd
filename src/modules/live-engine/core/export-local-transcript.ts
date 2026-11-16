import type { LocalSpeechLanguage } from './browser-local-speech';

export interface LocalTranscriptExport {
  transcript: string;
  language: LocalSpeechLanguage;
  createdAt: Date;
}

/**
 * Text-only export. The final transcript is never sent to a server.
 * Interim hypotheses and raw microphone data are deliberately excluded.
 */
export function formatLocalTranscript({ transcript, language, createdAt }: LocalTranscriptExport): string {
  const finalText = transcript.replace(/\r\n?/g, '\n').trim();
  if (!finalText) throw new Error('EMPTY_FINAL_TRANSCRIPT');
  if (Number.isNaN(createdAt.valueOf())) throw new Error('INVALID_EXPORT_DATE');
  return [
    'Free Interpreters Live',
    'Transcripción local (sin traducción)',
    `Idioma: ${language}`,
    `Exportado: ${createdAt.toISOString()}`,
    '',
    finalText,
    '',
  ].join('\n');
}

export function downloadLocalTranscript(exportData: LocalTranscriptExport): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('LOCAL_DOWNLOAD_UNAVAILABLE');
  }
  const content = formatLocalTranscript(exportData);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const timestamp = exportData.createdAt.toISOString().replace(/[:.]/g, '-');
  const link = document.createElement('a');
  try {
    link.href = objectUrl;
    link.download = `free-interpreters-live-${exportData.language}-${timestamp}.txt`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Delayed revocation allows the browser to begin the local download.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }
}
