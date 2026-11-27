export type StudioTimelineCut = { id: string; start: number; end: number };
export type StudioTimelineWindow = { start: number; end: number };

export function studioTimelineWindow(duration: number, anchor: number, span: number): StudioTimelineWindow {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 1;
  const width = Number.isFinite(span) && span > 0 ? Math.min(total, span) : total;
  const center = Number.isFinite(anchor) ? anchor : 0;
  const start = Math.max(0, Math.min(total - width, center - width / 2));
  return { start, end: start + width };
}

export function studioTimelineGeometry(cut: StudioTimelineCut, window: StudioTimelineWindow) {
  const span = window.end - window.start;
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(cut.start) ||
      !Number.isFinite(cut.end) || cut.start >= cut.end ||
      cut.end <= window.start || cut.start >= window.end) return null;
  const start = Math.max(cut.start, window.start);
  const end = Math.min(cut.end, window.end);
  return { left: (start - window.start) / span * 100, width: (end - start) / span * 100 };
}
