/**
 * Give HappyScribe SRT/MP3 imports a predictable local filename.
 *
 * HappyScribe names are titles, not trusted file paths. Only remove known
 * export/media extensions; a title such as "Dr. Smith" is not an extension.
 * This affects local File.name only, never transcript content or storage.
 */
export function happyScribeImportFilename(name: string, extension: 'srt' | 'mp3'): string {
  const cleaned = name
    .trim()
    .replace(/(?:\.(?:mp3|mp4|m4a|wav|aac|flac|ogg|opus|mov|webm|srt|vtt|md|txt|json))+$/i, '')
    .replace(/[\x00-\x1f\x7f<>:"\/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const maxBaseChars = 180 - extension.length - 1;
  // Count UTF-16 code units (File.name.length), without splitting emoji.
  let base = '';
  for (const character of cleaned) {
    if (base.length + character.length > maxBaseChars) break;
    base += character;
  }
  base = base.replace(/[.\s]+$/g, '');
  return (base || 'happyscribe-import') + '.' + extension;
}
