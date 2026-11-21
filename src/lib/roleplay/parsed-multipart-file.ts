/**
 * Request.formData() may return a native File created by a different
 * standards-compliant implementation/realm from globalThis.File. Relying
 * solely on instanceof File incorrectly rejects such uploads.
 *
 * Values from FormData are strings or parsed File objects. We still require
 * a File brand and the APIs used by checksum and Storage; plain text,
 * arbitrary Blob values, and incomplete objects cannot pass this guard.
 */
export function isParsedMultipartFile(value: unknown): value is File {
  if (!value || typeof value !== 'object' ||
      Object.prototype.toString.call(value) !== '[object File]') return false;
  const file = value as Partial<File>;
  return typeof file.name === 'string' && file.name.length > 0 &&
    typeof file.type === 'string' &&
    typeof file.size === 'number' && Number.isSafeInteger(file.size) && file.size >= 0 &&
    typeof file.arrayBuffer === 'function' && typeof file.stream === 'function';
}
