import { useEffect, useRef, useCallback } from 'react';
import { ExperienceSession, HandoffState, SessionSnapshot, liveSessionCount } from '../delivery/ExperienceSession';
import { MOBILE_MEDIA_QUERY } from '../delivery/assetProfile';

export const CarnoAnalytics = {
  track: (eventName: string, payload?: Record<string, unknown>) => {
    // Structured local logger - zero external network requests
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[Carno Analytics] ${eventName}`, payload);
    }
  }
};

interface UseCarnoExperienceOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  manifestPath?: string;
  /** Called exactly once per session when the poster may be hidden ('done') or must stay ('blocked'). */
  onHandoff?: (state: HandoffState, detail: Record<string, unknown>) => void;
  /** Lightweight state for local diagnostics / tests (no network, no user data). */
  onSnapshot?: (snapshot: SessionSnapshot & { liveSessions: number }) => void;
}

/**
 * Owns one ExperienceSession per effect run. In React Strict Mode the effect runs
 * mount -> cleanup -> mount; the first session is disposed before the second starts work,
 * so exactly one live renderer remains.
 */
export function useCarnoExperience({
  canvasRef,
  manifestPath = '/car-frames/v1/manifest.json',
  onHandoff,
  onSnapshot,
}: UseCarnoExperienceOptions) {
  const sessionRef = useRef<ExperienceSession | null>(null);
  const handoffRef = useRef(onHandoff);
  const snapshotRef = useRef(onSnapshot);

  useEffect(() => {
    handoffRef.current = onHandoff;
    snapshotRef.current = onSnapshot;
  }, [onHandoff, onSnapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const session = new ExperienceSession({
      canvas,
      manifestPath,
      // Profile is chosen once per session (no switching on resize).
      isMobileViewport: window.matchMedia(MOBILE_MEDIA_QUERY).matches,
      onHandoff: (state, detail) => {
        if (sessionRef.current !== session) return;
        CarnoAnalytics.track(state === 'done' ? 'car_asset_first_frame_ready' : 'car_asset_handoff_blocked', detail);
        handoffRef.current?.(state, detail);
      },
      onSnapshot: (s) => {
        if (sessionRef.current !== session) return;
        snapshotRef.current?.({ ...s, liveSessions: liveSessionCount() });
      },
    });
    sessionRef.current = session;
    CarnoAnalytics.track('car_asset_load_started', { profile: 'auto' });
    session.start().catch((err) => {
      console.error('Carno Engine Initialization failed:', err);
    });

    return () => {
      if (sessionRef.current === session) sessionRef.current = null;
      session.dispose();
    };
  }, [canvasRef, manifestPath]);

  const setProgress = useCallback((progress: number) => {
    sessionRef.current?.setProgress(progress);
  }, []);

  const getDebugStats = useCallback(() => {
    const session = sessionRef.current;
    const controller = session?.getController();
    if (!session || !controller) return null;
    const s = session.snapshot();
    const frame = controller.getCurrentFrame();
    return {
      frame,
      progress: (frame / 120).toFixed(2),
      cacheSize: s.resident,
      cacheCapacity: s.capacity,
      memoryProfile: s.profileId ?? 'unknown',
      loadedFrames: s.validated,
      keyframesLoaded: 0,
      totalKeyframes: 0,
      fps: 60, // approximate constant target
      manifestVersion: s.identity ?? 'unknown',
    };
  }, []);

  return {
    getController: useCallback(() => sessionRef.current?.getController() ?? undefined, []),
    setProgress,
    getDebugStats,
  };
}
