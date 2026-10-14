import { LoadPriority } from '../engine/loader/types';
import { ProtectionTier } from '../engine/cache/types';
import type { AssetIdentity } from './assetProfile';
import { logicalToFrameNumber } from './frameIndex';
import { STRIDE_LADDER, ValidationLedger, strideCandidates } from './strideCoverage';

/**
 * Scroll-driven frame scheduler (app layer, outside Protected Core).
 *
 * Priority order (highest first):
 *   R0  current scroll target ± r0Radius   — needs residency
 *   R1  target ± r1Radius (ring beyond R0) — needs residency
 *   S1..S4 strides 8/4/2/1 anchored at index 0, independent of the scroll center
 *                                           — needs validation (once per asset identity)
 *
 * Transport, logical invalidation and resource cleanup are kept distinct:
 *   - transport cancellation: FrameSource.cancel() is best effort (the engine LoadQueue refuses
 *     to cancel keyframes / the default frame, and decoding is never abortable);
 *   - logical invalidation: after dispose() every late result is dropped, never inserted;
 *   - resource cleanup: a dropped/duplicate/invalid ImageBitmap is closed exactly once by this
 *     scheduler; once passed to FrameSink.insert() ownership belongs to the cache.
 */

export type RequestClass = 'R0' | 'R1' | 'S';

export interface FrameSource {
  load(frameNumber: number, priority: LoadPriority): Promise<{ bitmap: ImageBitmap | HTMLImageElement }>;
  /** Best-effort transport cancellation. May silently do nothing. */
  cancel(frameNumber: number): void;
}

export interface FrameSink {
  has(frameNumber: number): boolean;
  /** Takes ownership of the bitmap (it may be closed immediately by self-eviction). */
  insert(frameNumber: number, bitmap: ImageBitmap, tier: ProtectionTier): void;
}

export type SchedulerEventType =
  | 'frame_validated'
  | 'local_window_ready'
  | 'stride_ready'
  | 'all_frames_ready'
  | 'frame_failed';

export interface SchedulerEvent {
  type: SchedulerEventType;
  logical?: number;
  stage?: number;
}

export interface FrameSchedulerOptions {
  identity: AssetIdentity;
  frameCount: number;
  source: FrameSource;
  sink: FrameSink;
  ledger: ValidationLedger;
  validate: (bitmap: ImageBitmap | HTMLImageElement) => bitmap is ImageBitmap;
  r0Radius?: number;
  r1Radius?: number;
  /** Max outstanding non-R0 requests. R0 may exceed it by the R0 window size. */
  maxPending?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  ladder?: readonly number[];
  onEvent?: (event: SchedulerEvent) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface SchedulerStats {
  requested: number;
  succeeded: number;
  failures: number;
  validationFailures: number;
  aborted: number;
  droppedAfterDispose: number;
  duplicatesClosed: number;
  cancelRequests: number;
}

function closeIfPossible(bitmap: ImageBitmap | HTMLImageElement): void {
  const maybe = bitmap as { close?: () => void };
  if (typeof maybe.close === 'function') {
    try {
      maybe.close();
    } catch {
      // already detached; nothing to release
    }
  }
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}

export class FrameScheduler {
  readonly stats: SchedulerStats = {
    requested: 0,
    succeeded: 0,
    failures: 0,
    validationFailures: 0,
    aborted: 0,
    droppedAfterDispose: 0,
    duplicatesClosed: 0,
    cancelRequests: 0,
  };

  private readonly o: Required<Omit<FrameSchedulerOptions, 'onEvent'>> & Pick<FrameSchedulerOptions, 'onEvent'>;
  private readonly strideSets: number[][];
  private center = 0;
  private direction = 1;
  private readonly pending = new Map<number, { cls: RequestClass; cancelRequested: boolean }>();
  private readonly attempts = new Map<number, number>();
  private readonly retryAt = new Map<number, number>();
  private readonly failed = new Set<number>();
  private readonly firedStages = new Set<number>();
  private firedAll = false;
  private firedLocal = false;
  private disposed = false;
  private timer: unknown = null;

  constructor(options: FrameSchedulerOptions) {
    this.o = {
      r0Radius: 2,
      r1Radius: 5,
      maxPending: 4,
      maxAttempts: 4,
      retryBaseMs: 400,
      ladder: STRIDE_LADDER,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...options,
    };
    if (this.o.r1Radius < this.o.r0Radius) throw new Error('r1Radius must be >= r0Radius');
    this.strideSets = this.o.ladder.map((_, k) => strideCandidates(k, this.o.frameCount, this.o.ladder));
  }

  start(): void {
    this.pump();
  }

  getCenter(): number {
    return this.center;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  failedIndexes(): number[] {
    return [...this.failed].sort((a, b) => a - b);
  }

  setCenter(logical: number): void {
    if (this.disposed) return;
    const c = Math.max(0, Math.min(this.o.frameCount - 1, Math.round(logical)));
    if (c === this.center) return;
    this.direction = c > this.center ? 1 : -1;
    this.center = c;
    this.preemptForR0();
    this.pump();
  }

  /** Logical invalidation of every outstanding request plus best-effort transport cancellation. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) {
      this.o.clearTimer(this.timer);
      this.timer = null;
    }
    for (const [logical, entry] of this.pending) {
      if (!entry.cancelRequested) {
        entry.cancelRequested = true;
        this.stats.cancelRequests++;
        this.o.source.cancel(logicalToFrameNumber(logical, this.o.frameCount));
      }
    }
  }

  // ---------------------------------------------------------------------------

  private offsets(radiusFrom: number, radiusTo: number): number[] {
    const out: number[] = [];
    if (radiusFrom === 0) out.push(0);
    for (let r = Math.max(1, radiusFrom); r <= radiusTo; r++) {
      out.push(this.direction * r, -this.direction * r);
    }
    return out;
  }

  private windowIndexes(radiusFrom: number, radiusTo: number): number[] {
    const out: number[] = [];
    for (const d of this.offsets(radiusFrom, radiusTo)) {
      const i = this.center + d;
      if (i >= 0 && i < this.o.frameCount) out.push(i);
    }
    return out;
  }

  private retryReady(i: number): boolean {
    if (this.failed.has(i)) return false;
    const at = this.retryAt.get(i);
    return at === undefined || at <= this.o.now();
  }

  private needsResidency(i: number): boolean {
    return !this.pending.has(i) && this.retryReady(i) && !this.o.sink.has(logicalToFrameNumber(i, this.o.frameCount));
  }

  private needsValidation(i: number): boolean {
    return !this.pending.has(i) && this.retryReady(i) && !this.o.ledger.isValidated(this.o.identity, i);
  }

  private nextCandidate(): { i: number; cls: RequestClass } | null {
    for (const i of this.windowIndexes(0, this.o.r0Radius)) if (this.needsResidency(i)) return { i, cls: 'R0' };
    for (const i of this.windowIndexes(this.o.r0Radius + 1, this.o.r1Radius)) if (this.needsResidency(i)) return { i, cls: 'R1' };
    for (const set of this.strideSets) for (const i of set) if (this.needsValidation(i)) return { i, cls: 'S' };
    return null;
  }

  private pump(): void {
    if (this.disposed) return;
    const r0Extra = 2 * this.o.r0Radius + 1;
    for (;;) {
      const c = this.nextCandidate();
      if (!c) break;
      const limit = c.cls === 'R0' ? this.o.maxPending + r0Extra : this.o.maxPending;
      if (this.pending.size >= limit) break;
      this.startRequest(c.i, c.cls);
    }
    this.scheduleRetryTimer();
  }

  /** Free transport slots for the new scroll target by cancelling background stride work. */
  private preemptForR0(): void {
    let unmet = this.windowIndexes(0, this.o.r0Radius).filter((i) => this.needsResidency(i)).length;
    if (unmet === 0 || this.pending.size < this.o.maxPending) return;
    for (const [logical, entry] of this.pending) {
      if (unmet <= 0) break;
      if (entry.cls === 'S' && !entry.cancelRequested) {
        entry.cancelRequested = true;
        this.stats.cancelRequests++;
        this.o.source.cancel(logicalToFrameNumber(logical, this.o.frameCount));
        unmet--;
      }
    }
  }

  private priorityFor(cls: RequestClass): LoadPriority {
    if (cls === 'R0') return LoadPriority.HERO;
    if (cls === 'R1') return LoadPriority.NEARBY;
    return LoadPriority.BACKGROUND;
  }

  private tierFor(i: number): ProtectionTier {
    if (i === 0) return ProtectionTier.HIGH; // initial view / scroll-to-top target
    if (Math.abs(i - this.center) <= this.o.r1Radius) return ProtectionTier.NORMAL;
    return ProtectionTier.LOW; // background coverage: evicted first, may self-evict
  }

  private startRequest(i: number, cls: RequestClass): void {
    const frameNumber = logicalToFrameNumber(i, this.o.frameCount);
    this.pending.set(i, { cls, cancelRequested: false });
    this.stats.requested++;
    let p: Promise<{ bitmap: ImageBitmap | HTMLImageElement }>;
    try {
      p = this.o.source.load(frameNumber, this.priorityFor(cls));
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(
      (r) => this.onSuccess(i, r.bitmap),
      (err) => this.onFailure(i, err),
    );
  }

  private onSuccess(i: number, bitmap: ImageBitmap | HTMLImageElement): void {
    this.pending.delete(i);
    if (this.disposed) {
      closeIfPossible(bitmap);
      this.stats.droppedAfterDispose++;
      return;
    }
    if (!this.o.validate(bitmap)) {
      closeIfPossible(bitmap);
      this.stats.validationFailures++;
      this.recordFailure(i);
      this.pump();
      return;
    }
    this.attempts.delete(i);
    this.retryAt.delete(i);
    this.o.ledger.markValidated(this.o.identity, i);
    const frameNumber = logicalToFrameNumber(i, this.o.frameCount);
    if (this.o.sink.has(frameNumber)) {
      closeIfPossible(bitmap); // never replace a resident bitmap the renderer may be using
      this.stats.duplicatesClosed++;
    } else {
      this.o.sink.insert(frameNumber, bitmap, this.tierFor(i)); // ownership -> cache
    }
    this.stats.succeeded++;
    this.emit({ type: 'frame_validated', logical: i });
    this.checkReadiness();
    this.pump();
  }

  private onFailure(i: number, err: unknown): void {
    this.pending.delete(i);
    if (this.disposed) return;
    if (isAbortError(err)) {
      this.stats.aborted++; // our own cancellation: not a failure, eligible again
    } else {
      this.stats.failures++;
      this.recordFailure(i);
    }
    this.pump();
  }

  private recordFailure(i: number): void {
    const n = (this.attempts.get(i) ?? 0) + 1;
    this.attempts.set(i, n);
    if (n >= this.o.maxAttempts) {
      this.failed.add(i);
      this.retryAt.delete(i);
      this.emit({ type: 'frame_failed', logical: i });
    } else {
      this.retryAt.set(i, this.o.now() + this.o.retryBaseMs * 2 ** (n - 1));
    }
  }

  private scheduleRetryTimer(): void {
    if (this.disposed || this.timer !== null) return;
    let earliest = Infinity;
    for (const [i, at] of this.retryAt) if (!this.pending.has(i) && !this.failed.has(i)) earliest = Math.min(earliest, at);
    if (earliest === Infinity) return;
    const delay = Math.max(0, earliest - this.o.now());
    this.timer = this.o.setTimer(() => {
      this.timer = null;
      this.pump();
    }, delay);
  }

  private checkReadiness(): void {
    const id = this.o.identity;
    if (!this.firedLocal) {
      const r0 = this.windowIndexes(0, this.o.r0Radius);
      if (r0.every((i) => this.o.sink.has(logicalToFrameNumber(i, this.o.frameCount)))) {
        this.firedLocal = true;
        this.emit({ type: 'local_window_ready', logical: this.center });
      }
    }
    const cov = this.o.ledger.strideCoverageCount(id);
    for (let k = 0; k < this.strideSets.length; k++) {
      if (!this.firedStages.has(k) && cov[k] === this.strideSets[k].length) {
        this.firedStages.add(k);
        this.emit({ type: 'stride_ready', stage: k + 1 });
      }
    }
    if (!this.firedAll && this.o.ledger.allFramesReady(id)) {
      this.firedAll = true;
      this.emit({ type: 'all_frames_ready' });
    }
  }

  private emit(e: SchedulerEvent): void {
    try {
      this.o.onEvent?.(e);
    } catch {
      // observers must never break delivery
    }
  }
}
