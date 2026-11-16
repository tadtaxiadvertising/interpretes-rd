/**
 * Diagnostic word-error rate for synthetic speech smoke tests.
 * WER = (substitutions + deletions + insertions) / reference words.
 * WER can exceed 1.0 if the model hallucinates many extra words.
 */
function words(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function wordErrorRate(reference: string, hypothesis: string): number {
  const expected = words(reference);
  const actual = words(hypothesis);
  if (expected.length === 0) throw new Error('WHISPER_WER_EMPTY_REFERENCE');

  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let i = 1; i <= expected.length; i += 1) {
    const next = new Array<number>(actual.length + 1);
    next[0] = i;
    for (let j = 1; j <= actual.length; j += 1) {
      const substitution = expected[i - 1] === actual[j - 1] ? 0 : 1;
      next[j] = Math.min(
        previous[j] + 1,
        next[j - 1] + 1,
        previous[j - 1] + substitution,
      );
    }
    previous = next;
  }
  return previous[actual.length] / expected.length;
}
