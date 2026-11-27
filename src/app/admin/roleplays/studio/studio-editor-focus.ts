/** Native fields and editable widgets own their keyboard shortcuts. */
export function isStudioShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"]')) return false;
  const editable = target.closest('[contenteditable=""], [contenteditable="true" i], [contenteditable="plaintext-only" i], [contenteditable="false" i]');
  return !editable || editable.getAttribute('contenteditable')?.toLowerCase() === 'false';
}

/** Move focus without stealing it for a hidden or retired intervention. */
export function focusStudioIntervention(id: string, scroll: boolean): void {
  const article = document.getElementById(`studio-intervention-${id}`);
  if (!article || article.closest('[hidden], [inert]')) return;
  article.focus({ preventScroll: true });
  if (scroll) {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    article.scrollIntoView?.({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'center' });
  }
}
