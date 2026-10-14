import { AssetResolver } from '../engine/loader/AssetResolver';
import { FrameLoader } from '../engine/loader/FrameLoader';
import { LoadQueue } from '../engine/loader/LoadQueue';
import type { CarnoManifest } from '../engine/loader/types';
import { BitmapCache } from '../engine/cache/BitmapCache';
import { MemoryManager } from '../engine/cache/MemoryManager';
import type { MemoryProfile } from '../engine/cache/types';
import { CanvasRenderer } from '../engine/renderer/CanvasRenderer';
import { FrameController } from '../engine/renderer/FrameController';
import { AssetIdentity, ProfileId, assetIdentityFor, frameUrl, identityKey, selectProfileId } from './assetProfile';
import { frameNumberToLogical } from './frameIndex';
import { FrameScheduler, SchedulerEvent } from './FrameScheduler';
import { ValidationLedger } from './strideCoverage';
import { HandoffVerifier, CompareResult } from './handoffVerifier';

/**
 * Decoded-bitmap budget per MemoryManager profile (bytes). Capacity = budget / (w*h*4),
 * clamped to [MIN_CAPACITY, frameCount]. MIN_CAPACITY keeps frame 0 + the R1 window resident.
 *   desktop 1600x900  (5.76 MB): low 16, normal 16, high 27
 *   mobile   960x540  (2.07 MB): low 23, normal 46, high 77
 */
const DECODED_BUDGET_BYTES: Record<MemoryProfile, number> = {
  low: 48 * 1024 * 1024,
  normal: 96 * 1024 * 1024,
  high: 160 * 1024 * 1024,
};
export const MIN_CAPACITY = 16;

export function decodedCapacity(profile: MemoryProfile, width: number, height: number, frameCount: number): number {
  const perFrame = Math.max(1, width * height * 4);
  const byBudget = Math.floor(DECODED_BUDGET_BYTES[profile] / perFrame);
  return Math.max(MIN_CAPACITY, Math.min(frameCount, byBudget));
}

export type HandoffState = 'pending' | 'done' | 'blocked';

export interface SessionSnapshot {
  profileId: ProfileId | null;
  identity: string | null;
  capacity: number;
  resident: number;
  maxResidentSeen: number;
  validated: number;
  strideCoverage: number[];
  handoff: HandoffState;
  failed: number[];
}

export interface ExperienceSessionOptions {
  canvas: HTMLCanvasElement;
  manifestPath: string;
  isMobileViewport: boolean;
  onHandoff: (state: HandoffState, detail: Record<string, unknown>) => void;
  onSnapshot?: (s: SessionSnapshot) => void;
}

let liveSessions = 0;
export function liveSessionCount(): number {
  return liveSessions;
}

function mark(name: string, detail?: Record<string, unknown>): void {
  try {
    performance.mark(name, { detail });
  } catch {
    // performance.mark unsupported: measurement only, ignore
  }
}

/**
 * One generation of the 120-frame experience. Each React effect run owns exactly one session;
 * dispose() is final. Nothing from a disposed session can reach the canvas or the cache:
 *  - the manifest fetch is transport-aborted;
 *  - the renderer is stopped before the cache is cleared;
 *  - the scheduler drops (and closes) every late result.
 */
export class ExperienceSession {
  private disposed = false;
  private counted = false;
  private readonly manifestAbort = new AbortController();
  private cache: BitmapCache | null = null;
  private renderer: CanvasRenderer | null = null;
  private controller: FrameController | null = null;
  private scheduler: FrameScheduler | null = null;
  private verifier: HandoffVerifier | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeRaf: number | null = null;
  private ledger: ValidationLedger | null = null;
  private identity: AssetIdentity | null = null;
  private manifest: CarnoManifest | null = null;
  private capacity = 0;
  private maxResidentSeen = 0;
  private handoff: HandoffState = 'pending';
  private pendingProgress: number | null = null;

  constructor(private readonly o: ExperienceSessionOptions) {}

  async start(): Promise<void> {
    liveSessions++;
    this.counted = true;
    mark('khodrekab:session-start');
    let manifest: CarnoManifest;
    try {
      const res = await fetch(this.o.manifestPath, { signal: this.manifestAbort.signal });
      if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`);
      manifest = (await res.json()) as CarnoManifest;
    } catch (err) {
      if (!this.disposed) {
        console.error('[Khodrekab] manifest load failed', err);
        this.setHandoff('blocked', { reason: 'manifest-load-failed' });
      }
      return;
    }
    if (this.disposed) return; // unmounted while the manifest was in flight

    const profileId = selectProfileId(manifest, this.o.isMobileViewport);
    const identity = assetIdentityFor(manifest, profileId);
    const frameCount = manifest.frameCount;
    const height = Math.round((identity.width * 9) / 16);
    this.capacity = decodedCapacity(MemoryManager.getMemoryProfile(), identity.width, height, frameCount);

    const resolver = new AssetResolver(manifest);
    const loader = new FrameLoader();
    const queue = new LoadQueue({ loader, resolver, manifest, maxConcurrent: 4 });
    const cache = new BitmapCache(this.capacity);
    const controller = new FrameController(frameCount);
    const renderer = new CanvasRenderer(controller, cache);
    renderer.setKeyframes(manifest.keyframes);
    const ledger = new ValidationLedger(frameCount);

    this.manifest = manifest;
    this.identity = identity;
    this.cache = cache;
    this.controller = controller;
    this.renderer = renderer;
    this.ledger = ledger;

    mark('khodrekab:profile-selected', { profileId, capacity: this.capacity, identity: identityKey(identity) });

    renderer.attachCanvas(this.o.canvas);
    renderer.start();

    if (this.pendingProgress !== null) controller.updateProgress(this.pendingProgress);

    this.scheduler = new FrameScheduler({
      identity,
      frameCount,
      ledger,
      source: {
        load: (frameNumber, priority) => queue.loadFrame({ frameNumber, priority, profileId }),
        cancel: (frameNumber) => queue.cancel(frameNumber, profileId),
      },
      sink: {
        has: (frameNumber) => cache.has(frameNumber),
        insert: (frameNumber, bitmap, tier) => {
          cache.insert(frameNumber, bitmap, tier);
          this.observeResidency();
        },
      },
      validate: (b): b is ImageBitmap =>
        typeof ImageBitmap !== 'undefined' && b instanceof ImageBitmap && b.width === identity.width && b.height > 0,
      onEvent: (e) => this.onSchedulerEvent(e),
    });
    this.scheduler.setCenter(frameNumberToLogical(controller.getCurrentFrame(), frameCount));
    this.scheduler.start();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.resizeRaf !== null) return;
        this.resizeRaf = requestAnimationFrame(() => {
          this.resizeRaf = null;
          if (!this.disposed) this.renderer?.resizeCanvas();
        });
      });
      this.resizeObserver.observe(this.o.canvas);
    }

    this.verifier = new HandoffVerifier({
      canvas: this.o.canvas,
      getTargetFrame: () => controller.getCurrentFrame(),
      frameUrl: (n) => frameUrl(manifest, profileId, n),
      onVerified: ({ frameNumber, result, checks }) => {
        if (this.disposed) return;
        this.setHandoff('done', { frameNumber, mad: result.mad, coverageRatio: result.coverageRatio, checks });
      },
      onBlocked: ({ reason, last, checks }) => {
        if (this.disposed) return;
        this.setHandoff('blocked', { reason, last: last ? summarize(last) : null, checks });
      },
    });
    this.verifier.start();
    this.emitSnapshot();
  }

  /** Scroll progress from the story scroller. Safe to call before start() completes. */
  setProgress(progress: number): void {
    if (this.disposed) return;
    if (!this.controller || !this.scheduler || !this.manifest) {
      this.pendingProgress = progress;
      return;
    }
    this.controller.updateProgress(progress);
    this.scheduler.setCenter(frameNumberToLogical(this.controller.getCurrentFrame(), this.manifest.frameCount));
  }

  getController(): FrameController | null {
    return this.disposed ? null : this.controller;
  }

  snapshot(): SessionSnapshot {
    const stats = this.cache?.getStatistics();
    return {
      profileId: this.identity?.profileId ?? null,
      identity: this.identity ? identityKey(this.identity) : null,
      capacity: stats?.maxCapacity ?? this.capacity,
      resident: stats?.currentSize ?? 0,
      maxResidentSeen: this.maxResidentSeen,
      validated: this.identity && this.ledger ? this.ledger.validatedCount(this.identity) : 0,
      strideCoverage: this.identity && this.ledger ? this.ledger.strideCoverageCount(this.identity) : [],
      handoff: this.handoff,
      failed: this.scheduler?.failedIndexes() ?? [],
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.counted) {
      liveSessions--;
      this.counted = false;
    }
    this.manifestAbort.abort(); // transport cancellation of the manifest request
    this.verifier?.stop();
    this.resizeObserver?.disconnect();
    if (this.resizeRaf !== null) cancelAnimationFrame(this.resizeRaf);
    this.renderer?.stop(); // no draw after this point
    this.scheduler?.dispose(); // logical invalidation + best-effort transport cancel
    this.cache?.clear(); // closes resident bitmaps; late results are closed by the scheduler
    this.verifier = null;
    this.renderer = null;
    this.controller = null;
  }

  private setHandoff(state: HandoffState, detail: Record<string, unknown>): void {
    if (this.handoff !== 'pending') return;
    this.handoff = state;
    mark(state === 'done' ? 'khodrekab:handoff-done' : 'khodrekab:handoff-blocked', detail);
    this.o.onHandoff(state, detail);
    this.emitSnapshot();
  }

  private observeResidency(): void {
    const size = this.cache?.getStatistics().currentSize ?? 0;
    if (size > this.maxResidentSeen) this.maxResidentSeen = size;
  }

  private onSchedulerEvent(e: SchedulerEvent): void {
    if (this.disposed) return;
    if (e.type === 'local_window_ready') mark('khodrekab:local-window-ready', { center: e.logical });
    else if (e.type === 'stride_ready') mark(`khodrekab:stride-ready-${e.stage}`);
    else if (e.type === 'all_frames_ready') mark('khodrekab:all-frames-validated');
    else if (e.type === 'frame_failed') console.warn('[Khodrekab] frame permanently failed', e.logical);
    if (e.type !== 'frame_validated' || (this.ledger && this.identity && this.ledger.validatedCount(this.identity) % 10 === 0)) {
      this.emitSnapshot();
    }
  }

  private emitSnapshot(): void {
    this.o.onSnapshot?.(this.snapshot());
  }
}

function summarize(r: CompareResult) {
  return { verdict: r.verdict, mad: Number.isFinite(r.mad) ? Number(r.mad.toFixed(3)) : null, coverageRatio: Number(r.coverageRatio.toFixed(3)) };
}
