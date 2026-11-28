type PreviewClock = Pick<HTMLMediaElement, 'currentTime' | 'playbackRate' | 'paused' | 'seeking'>;

/**
 * Best-effort endpoint monitoring for short previews. Media time, not wall
 * time, is authoritative: seeking, buffering and rate changes must not
 * advance the cutoff. The native timeupdate handler remains a fallback.
 */
export function watchPreviewEnd(
  media: PreviewClock,
  end: number,
  isCurrent: () => boolean,
  onEnd: () => void,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    if (cancelled || !isCurrent()) return;
    const time = media.currentTime;
    if (!media.seeking && Number.isFinite(time) && time >= end) {
      cancelled = true;
      onEnd();
      return;
    }
    const rate = media.playbackRate;
    const remainingMs = (end - time) * 1000 / rate;
    const delay = media.paused || media.seeking || !Number.isFinite(remainingMs) || rate <= 0
      ? 100 : Math.max(15, Math.min(100, remainingMs));
    timer = setTimeout(tick, delay);
  };
  if (Number.isFinite(end) && end > 0) timer = setTimeout(tick, 15);
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
