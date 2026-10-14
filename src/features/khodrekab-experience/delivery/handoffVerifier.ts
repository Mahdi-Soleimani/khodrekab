/**
 * Poster -> canvas handoff verification (app layer; no engine change).
 *
 * The engine exposes no public "frame drawn" signal, and its renderer paints a debug overlay
 * even when drawImage fails. So "the cache holds frame N" or "two rAFs elapsed" never proves
 * that the car is on the canvas. Instead, during a bounded handoff window only, the canvas is
 * downscaled and compared against a reference rendering of the target frame (same decoded
 * asset, same contain-fit math, same decode options). The debug-overlay rectangle is masked.
 *
 * Verdicts:
 *   correct       canvas matches the target frame within tolerance
 *   blank         nothing (or almost nothing) drawn in the vehicle region
 *   overlay-only  vehicle region blank but the debug overlay is present
 *   mismatch      something else is drawn (e.g. a stale frame from another index)
 *
 * Calibration (served v1 assets, 192-px comparison width, premultiplied RGBA MAD over the
 * union of alpha>16 pixels): adjacent frames differ by >= 1.03 (desktop) / 1.26 (mobile);
 * the median adjacent difference is ~11. A correct draw compared through the identical
 * downscale path is expected to be ~0. Threshold 0.75 therefore rejects even the closest
 * adjacent frame. Scratch calibration evidence is listed in the implementation report.
 */

export type HandoffVerdict = 'correct' | 'blank' | 'overlay-only' | 'mismatch';

export interface MaskRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CompareThresholds {
  /** Max mean absolute difference (0..255, premultiplied RGBA) for "correct". */
  maxMad: number;
  /** Allowed ratio of covered (alpha>16) pixels canvas/reference for "correct". */
  minCoverageRatio: number;
  maxCoverageRatio: number;
  /** Below this coverage ratio the vehicle region counts as blank. */
  blankCoverageRatio: number;
}

export const DEFAULT_THRESHOLDS: CompareThresholds = {
  maxMad: 0.75,
  minCoverageRatio: 0.9,
  maxCoverageRatio: 1.1,
  blankCoverageRatio: 0.05,
};

export interface CompareResult {
  verdict: HandoffVerdict;
  mad: number;
  coverageRatio: number;
  overlayPixels: number;
}

const ALPHA_ON = 16;

function inRects(x: number, y: number, rects: MaskRect[]): boolean {
  for (const r of rects) if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return true;
  return false;
}

/**
 * Compare two same-sized RGBA buffers (non-premultiplied, as returned by getImageData).
 * Masked rectangles are excluded from the vehicle comparison; overlayRect is inspected
 * separately so that an overlay-only canvas can be reported as such.
 */
export function compareCanvasToReference(
  canvasPx: Uint8ClampedArray,
  refPx: Uint8ClampedArray,
  width: number,
  height: number,
  masks: MaskRect[],
  overlayRect: MaskRect | null,
  t: CompareThresholds = DEFAULT_THRESHOLDS,
): CompareResult {
  if (canvasPx.length !== refPx.length || canvasPx.length !== width * height * 4) {
    throw new Error('Buffer size mismatch');
  }
  let refCov = 0;
  let canCov = 0;
  let sum = 0;
  let n = 0;
  let overlayPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const ca = canvasPx[o + 3];
      if (overlayRect && inRects(x, y, [overlayRect]) && ca > ALPHA_ON) overlayPixels++;
      if (inRects(x, y, masks)) continue;
      const ra = refPx[o + 3];
      if (ra > ALPHA_ON) refCov++;
      if (ca > ALPHA_ON) canCov++;
      if (ra <= ALPHA_ON && ca <= ALPHA_ON) continue;
      for (let c = 0; c < 3; c++) {
        sum += Math.abs((canvasPx[o + c] * ca) / 255 - (refPx[o + c] * ra) / 255);
      }
      sum += Math.abs(ca - ra);
      n += 4;
    }
  }
  if (refCov === 0) return { verdict: 'mismatch', mad: Infinity, coverageRatio: 0, overlayPixels };
  const coverageRatio = canCov / refCov;
  const mad = n ? sum / n : Infinity;
  if (coverageRatio < t.blankCoverageRatio) {
    return { verdict: overlayPixels > 0 ? 'overlay-only' : 'blank', mad, coverageRatio, overlayPixels };
  }
  const ok = mad <= t.maxMad && coverageRatio >= t.minCoverageRatio && coverageRatio <= t.maxCoverageRatio;
  return { verdict: ok ? 'correct' : 'mismatch', mad, coverageRatio, overlayPixels };
}

/** Contain-fit geometry identical to the engine renderer's public drawing behaviour. */
export function containRect(canvasW: number, canvasH: number, imgW: number, imgH: number) {
  const canvasRatio = canvasW / canvasH;
  const imgRatio = imgW / imgH;
  if (canvasRatio > imgRatio) {
    const w = imgW * (canvasH / imgH);
    return { x: (canvasW - w) / 2, y: 0, w, h: canvasH };
  }
  const h = imgH * (canvasW / imgW);
  return { x: 0, y: (canvasH - h) / 2, w: canvasW, h };
}

/** Debug overlay painted by the engine renderer: canvas px x∈[10,210), y∈[10,60). */
export const ENGINE_DEBUG_OVERLAY: MaskRect = { x0: 10, y0: 10, x1: 210, y1: 60 };

// -----------------------------------------------------------------------------
// Browser-only verifier
// -----------------------------------------------------------------------------

export interface HandoffVerifierOptions {
  canvas: HTMLCanvasElement;
  /** Current 1-based target frame number of the controller. */
  getTargetFrame: () => number;
  /** URL of the served frame for the active profile. */
  frameUrl: (frameNumber: number) => string;
  onVerified: (info: { frameNumber: number; result: CompareResult; atMs: number; checks: number }) => void;
  onBlocked: (info: { reason: string; last: CompareResult | null; checks: number }) => void;
  windowMs?: number;
  intervalMs?: number;
  compareWidth?: number;
}

export class HandoffVerifier {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly startedAt = performance.now();
  private checks = 0;
  private last: CompareResult | null = null;
  private ref: { frameNumber: number; bitmap: ImageBitmap } | null = null;
  private refLoading: number | null = null;
  private abort = new AbortController();
  private readonly o: Required<Omit<HandoffVerifierOptions, 'onVerified' | 'onBlocked'>> &
    Pick<HandoffVerifierOptions, 'onVerified' | 'onBlocked'>;

  constructor(options: HandoffVerifierOptions) {
    this.o = { windowMs: 15000, intervalMs: 100, compareWidth: 192, ...options };
  }

  start(): void {
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort.abort();
    this.ref?.bitmap.close();
    this.ref = null;
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, ms);
  }

  private async loadReference(frameNumber: number): Promise<void> {
    if (this.refLoading === frameNumber) return;
    this.refLoading = frameNumber;
    try {
      const res = await fetch(this.o.frameUrl(frameNumber), { signal: this.abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      // Same decode options as the engine FrameLoader.
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
      if (this.stopped) {
        bmp.close();
        return;
      }
      this.ref?.bitmap.close();
      this.ref = { frameNumber, bitmap: bmp };
    } catch {
      // transient: retried on a later tick while the window is open
    } finally {
      if (this.refLoading === frameNumber) this.refLoading = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    const elapsed = performance.now() - this.startedAt;
    if (elapsed > this.o.windowMs) {
      this.stop();
      this.o.onBlocked({ reason: 'handoff-window-elapsed', last: this.last, checks: this.checks });
      return;
    }
    const target = this.o.getTargetFrame();
    if (!this.ref || this.ref.frameNumber !== target) {
      await this.loadReference(target);
      this.schedule(this.o.intervalMs);
      return;
    }
    const result = this.compareNow(this.ref.bitmap);
    if (result) {
      this.checks++;
      this.last = result;
      // Re-read the target: if the user scrolled during the comparison, do not hand off.
      if (result.verdict === 'correct' && this.o.getTargetFrame() === target) {
        const info = { frameNumber: target, result, atMs: performance.now(), checks: this.checks };
        this.stop();
        this.o.onVerified(info);
        return;
      }
    }
    this.schedule(this.o.intervalMs);
  }

  private compareNow(refBitmap: ImageBitmap): CompareResult | null {
    const { canvas } = this.o;
    const W = canvas.width;
    const H = canvas.height;
    if (W < 4 || H < 4) return null;
    const w = this.o.compareWidth;
    const h = Math.max(1, Math.round((w * H) / W));

    // Reference at full backing size, using the engine's contain-fit geometry.
    const full = document.createElement('canvas');
    full.width = W;
    full.height = H;
    const fctx = full.getContext('2d');
    if (!fctx) return null;
    const r = containRect(W, H, refBitmap.width, refBitmap.height);
    fctx.drawImage(refBitmap, 0, 0, refBitmap.width, refBitmap.height, r.x, r.y, r.w, r.h);

    // Identical downscale path for both sources.
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    if (!sctx) return null;
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(canvas, 0, 0, W, H, 0, 0, w, h);
    const canvasPx = sctx.getImageData(0, 0, w, h).data;
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(full, 0, 0, W, H, 0, 0, w, h);
    const refPx = sctx.getImageData(0, 0, w, h).data;
    full.width = 0; // release the full-size buffer immediately
    full.height = 0;

    const s = w / W;
    const pad = 2;
    const ov = ENGINE_DEBUG_OVERLAY;
    const overlayRect: MaskRect = {
      x0: Math.max(0, Math.floor(ov.x0 * s) - pad),
      y0: Math.max(0, Math.floor(ov.y0 * s) - pad),
      x1: Math.min(w, Math.ceil(ov.x1 * s) + pad),
      y1: Math.min(h, Math.ceil(ov.y1 * s) + pad),
    };
    return compareCanvasToReference(canvasPx, refPx, w, h, [overlayRect], overlayRect);
  }
}
