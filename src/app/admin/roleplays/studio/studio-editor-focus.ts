import type { StudioReviewCode } from '@/lib/roleplay-studio/quick-review';

/** Native fields and editable widgets own their keyboard shortcuts. */
export function isStudioShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"]')) return false;
  const editable = target.closest('[contenteditable=""], [contenteditable="true" i], [contenteditable="plaintext-only" i], [contenteditable="false" i]');
  return !editable || editable.getAttribute('contenteditable')?.toLowerCase() === 'false';
}

/** Move focus without stealing it for a hidden or retired intervention. */
export function focusStudioIntervention(id: string, scroll: boolean, issue?: StudioReviewCode): void {
  const article = document.getElementById(`studio-intervention-${id}`);
  if (!article || article.closest('[hidden], [inert]')) return;
  const selectors: Record<StudioReviewCode, readonly string[]> = {
    speaker: ['[data-review-field="profile"] button[aria-pressed="true"]', '[data-review-field="profile"] button'],
    language: ['[data-review-field="profile"] button[aria-pressed="true"]', '[data-review-field="profile"] button'],
    interpreter: ['[data-review-field="profile"] button[aria-pressed="true"]', '[data-review-field="profile"] button'],
    title: ['[data-review-field="title"]'],
    range: ['[data-review-field="start"]', '[data-review-field="end"]', '[data-review-field="separate"]'],
    overlap: ['[data-review-field="preview-proposal"]', '[data-review-field="start"]', '[data-review-field="end"]', '[data-review-field="separate"]'],
    instructions: ['[data-review-field="instructions"]'],
    response: ['[data-review-field="response"]'],
  };
  const target = issue ? selectors[issue].flatMap(selector => Array.from(article.querySelectorAll<HTMLElement>(selector)))
    .find(element => !element.matches(':disabled, [aria-disabled="true"]') && !element.closest('[hidden], [inert]')) : undefined;
  const focusTarget = target ?? article;
  focusTarget.focus({ preventScroll: true });
  if (scroll) {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    focusTarget.scrollIntoView?.({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'center' });
  }
}
