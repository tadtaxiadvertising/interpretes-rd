'use client';

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { StudioIntervention as Segment } from './StudioInterventionCard';
import type { TimedTranscriptCue } from '@/lib/roleplay-studio/transcript';
import type { StudioSuggestedClip } from '@/lib/roleplay-studio/silence-analysis';
import type { GaplessPairPlan } from '@/lib/roleplay-studio/gapless-pair-preview';
import { MAX_LOCAL_MEDIA_SECONDS } from '@/lib/roleplay-studio/long-media';

/** Coordinates the existing primary and auxiliary media elements; no audio
 * allocation, decoding, network requests or editorial mutations. */
export function useStudioPlayback(duration: number, setDuration: (duration: number) => void, setError: (message: string) => void) {
  const [playhead, setPlayhead] = useState(0);
  const [editorPlaybackRevision, setEditorPlaybackRevision] = useState(0);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [pairPreviewId, setPairPreviewId] = useState<string | null>(null);
  const player = useRef<HTMLMediaElement | null>(null);
  const pairPlayer = useRef<HTMLAudioElement | null>(null);
  const pairPlayback = useRef<{ plan: GaplessPairPlan; stage: 1 | 2 } | null>(null);
  const previewEnd = useRef<number | null>(null);
  const primaryPlaybackRevision = useRef(0);
  const pairPlaybackRevision = useRef(0);
  const attachPlayer = useCallback((element: HTMLMediaElement | null) => { player.current = element; }, []);
  const pauseEditorialAudio = useCallback(() => { player.current?.pause(); pairPlayer.current?.pause(); }, []);
  useEffect(() => () => {
    primaryPlaybackRevision.current += 1;
    pairPlaybackRevision.current += 1;
    previewEnd.current = null;
    pairPlayback.current = null;
  }, []);

  const stopPairPreview = () => {
    pairPlaybackRevision.current += 1;
    const wasActive = pairPlayback.current !== null;
    pairPlayback.current = null;
    setPairPreviewId(null);
    // Never pause an idle auxiliary player: changing ordinary clips must not
    // interfere with the primary player's pause/resume lifecycle.
    if (wasActive) pairPlayer.current?.pause();
  };

  const stopPreview = () => {
    primaryPlaybackRevision.current += 1;
    previewEnd.current = null;
    setPreviewingId(null);
    player.current?.pause();
  };

  const seekAudio = (seconds: number) => {
    const audioPlayer = player.current;
    if (!audioPlayer || !Number.isFinite(seconds) || !duration) return;
    const timestamp = Math.min(duration, Math.max(0, seconds));
    // Seeking manually exits a clip preview; its previous end must not stop
    // the administrator when inspecting another timestamp.
    primaryPlaybackRevision.current += 1;
    previewEnd.current = null;
    setPreviewingId(null);
    stopPairPreview();
    audioPlayer.currentTime = timestamp;
    setPlayhead(timestamp);
  };

  const previewSimpleSegment = (segment: Segment) => {
    const audioPlayer = player.current;
    if (!audioPlayer || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
      segment.end <= segment.start || segment.start < 0 || segment.end > duration) return;
    if (previewingId === segment.id) {
      stopPreview();
      return;
    }
    // Seek directly even if audio is already playing. Calling pause() here
    // schedules an onPause event which can clear the new segment's end marker.
    stopPairPreview();
    const request = ++primaryPlaybackRevision.current;
    audioPlayer.currentTime = segment.start;
    setPlayhead(segment.start);
    previewEnd.current = segment.end;
    setPreviewingId(segment.id);
    void audioPlayer.play().catch(() => {
      if (request !== primaryPlaybackRevision.current || player.current !== audioPlayer) return;
      previewEnd.current = null;
      setPreviewingId(null);
      setError('No fue posible reproducir el fragmento.');
    });
  };

  /** Listen to precisely one SRT candidate without modifying its selection or cuts. */
  const previewSubtitleCue = (cue: Pick<TimedTranscriptCue, 'start' | 'end'>, index: number, adjusted: boolean | 'removed' = false) => {
    const audioPlayer = player.current;
    if (!audioPlayer || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) ||
        cue.start < 0 || cue.end <= cue.start || cue.end > duration) return;
    const previewId = adjusted === 'removed' ? `subtitle-removed-${index}` : adjusted ? `subtitle-trim-${index}` : `subtitle-${index}`;
    if (previewingId === previewId) {
      stopPreview();
      return;
    }
    // Reuse the existing timeupdate cutoff and player. Never upload or
    // transcode private subtitle audio just to audition an intervention.
    stopPairPreview();
    const request = ++primaryPlaybackRevision.current;
    audioPlayer.currentTime = cue.start;
    setPlayhead(cue.start);
    previewEnd.current = cue.end;
    setPreviewingId(previewId);
    void audioPlayer.play().catch(() => {
      if (request !== primaryPlaybackRevision.current || player.current !== audioPlayer) return;
      previewEnd.current = null;
      setPreviewingId(null);
      setError('No fue posible escuchar este turno de la transcripción.');
    });
  };

  /** Preview a suggested local VAD region in the existing player, without exporting or uploading audio. */
  const previewVadRegion = ({ start, end }: StudioSuggestedClip) => {
    const audioPlayer = player.current;
    if (!audioPlayer || !Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || end <= start || end > duration) return;
    // Reuse the same bounded playback marker as editorial cuts. Seeking does
    // not pause the player, avoiding an old onPause clearing the new marker.
    stopPairPreview();
    const request = ++primaryPlaybackRevision.current;
    audioPlayer.currentTime = start;
    setPlayhead(start);
    previewEnd.current = end;
    setPreviewingId(null);
    void audioPlayer.play().catch(() => {
      if (request !== primaryPlaybackRevision.current || player.current !== audioPlayer) return;
      previewEnd.current = null;
      setError('No fue posible escuchar la región sugerida.');
    });
  };


  const startPairPreview = (id: string, plan: GaplessPairPlan, onStarted: () => void, onFailed: () => void) => {
    const element = pairPlayer.current;
    if (!element) return;
    stopPreview();
    stopPairPreview();
    const request = ++pairPlaybackRevision.current;
    pairPlayback.current = { plan, stage: 1 };
    setPairPreviewId(id);
    element.currentTime = plan.first.start;
    setEditorPlaybackRevision(n => n + 1);
    onStarted();
    void element.play().catch(() => {
      if (request !== pairPlaybackRevision.current || pairPlayer.current !== element) return;
      stopPairPreview();
      onFailed();
    });
  };

  const mediaHandlers = {
    onPlay: (event: SyntheticEvent<HTMLMediaElement>) => {
      // Native controls can resume the primary player during a compound
      // preview. A queued play event from a paused or replaced element must
      // not interrupt a newer auxiliary preview.
      if (event.currentTarget !== player.current || event.currentTarget.paused) return;
      if (pairPlayback.current) stopPairPreview();
      setEditorPlaybackRevision(n => n + 1);
    },
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      const length = event.currentTarget.duration;
      if (!Number.isFinite(length) || length <= 0) {
        setDuration(0);
        setError('No se pudo determinar la duración de la grabación. Verifica el formato.');
      } else if (length > MAX_LOCAL_MEDIA_SECONDS) {
        setDuration(0);
        setError('El archivo supera las 12 horas admitidas en modo local.');
      } else {
        setDuration(length);
        setError('');
      }
    },
    onTimeUpdate: (event: SyntheticEvent<HTMLMediaElement>) => {
      setPlayhead(event.currentTarget.currentTime);
      if (previewEnd.current !== null &&
          event.currentTarget.currentTime >= previewEnd.current) stopPreview();
    },
    // A queued pause/ended event can arrive after another cue has started.
    // Read the element's *current* state so an obsolete event cannot cancel
    // the new bounded preview (or invalidate its play() rejection guard).
    onPause: (event: SyntheticEvent<HTMLMediaElement>) => {
      if (!event.currentTarget.paused) return;
      primaryPlaybackRevision.current += 1;
      previewEnd.current = null;
      setPreviewingId(null);
    },
    onEnded: (event: SyntheticEvent<HTMLMediaElement>) => {
      if (!event.currentTarget.ended) return;
      primaryPlaybackRevision.current += 1;
      previewEnd.current = null;
      setPreviewingId(null);
    },
    onError: (event: SyntheticEvent<HTMLMediaElement>) => {
      // MediaError may have been cleared by a newer source or playback
      // request before an old queued error event reaches this handler.
      // Never invalidate a healthy recording or its SRT review in that case.
      if (!event.currentTarget.error) return;
      primaryPlaybackRevision.current += 1;
      previewEnd.current = null;
      setPreviewingId(null);
      setDuration(0);
      setError('El navegador no puede decodificar esta grabación. Prueba MP4/H.264 con AAC o MP3.');
    },
  };


  const pairMediaHandlers = {
    onTimeUpdate: (event: SyntheticEvent<HTMLAudioElement>) => {
      const current = pairPlayback.current;
      if (!current) return;
      if (current.stage === 1 && event.currentTarget.currentTime >= current.plan.first.end - 0.025) {
        current.stage = 2;
        event.currentTarget.currentTime = current.plan.second.start;
      } else if (current.stage === 2 && event.currentTarget.currentTime >= current.plan.second.end - 0.025) {
        stopPairPreview();
      }
    },
    onEnded: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (event.currentTarget.ended) stopPairPreview();
    },
    onPause: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (event.currentTarget.paused && pairPlayback.current) stopPairPreview();
    },
    onError: (event: SyntheticEvent<HTMLAudioElement>) => {
      if (!pairPlayback.current || !event.currentTarget.error) return;
      stopPairPreview();
      setError('El navegador no pudo reproducir la preescucha. Comprueba el formato de la grabación.');
    },
  };

  return {
    player, pairPlayer, attachPlayer, pauseEditorialAudio, playhead, setPlayhead,
    editorPlaybackRevision, previewingId, pairPreviewId, stopPreview, stopPairPreview, seekAudio,
    previewSimpleSegment, previewSubtitleCue, previewVadRegion, startPairPreview, mediaHandlers, pairMediaHandlers,
  };
}
