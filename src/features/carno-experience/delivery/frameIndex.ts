/**
 * Single source of truth for frame indexing in the delivery layer.
 *
 * - The delivery layer works with LOGICAL indexes 0..frameCount-1.
 * - The protected engine (LoadQueue, BitmapCache, FrameController, CanvasRenderer)
 *   works with 1-based FRAME NUMBERS that also name the files (frame-001 .. frame-120).
 *
 * Every conversion between the two spaces must go through these helpers.
 */

export const DEFAULT_FRAME_COUNT = 120;

function assertFrameCount(frameCount: number): void {
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new RangeError(`Invalid frameCount ${frameCount}`);
  }
}

/** Logical index (0-based) -> engine frame number (1-based, also the file number). */
export function logicalToFrameNumber(logical: number, frameCount: number = DEFAULT_FRAME_COUNT): number {
  assertFrameCount(frameCount);
  if (!Number.isInteger(logical) || logical < 0 || logical >= frameCount) {
    throw new RangeError(`Logical index ${logical} out of range 0..${frameCount - 1}`);
  }
  return logical + 1;
}

/** Engine frame number (1-based) -> logical index (0-based). */
export function frameNumberToLogical(frameNumber: number, frameCount: number = DEFAULT_FRAME_COUNT): number {
  assertFrameCount(frameCount);
  if (!Number.isInteger(frameNumber) || frameNumber < 1 || frameNumber > frameCount) {
    throw new RangeError(`Frame number ${frameNumber} out of range 1..${frameCount}`);
  }
  return frameNumber - 1;
}

/**
 * Scroll progress (0..1, clamped) -> logical index.
 * Mirrors the public behaviour of FrameController.updateProgress:
 *   frameNumber = floor(clamp(p) * (frameCount - 1)) + 1
 */
export function progressToLogical(progress: number, frameCount: number = DEFAULT_FRAME_COUNT): number {
  assertFrameCount(frameCount);
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return Math.floor(p * (frameCount - 1));
}

/** Zero-padded file stem used by the served assets, e.g. 1 -> "frame-001". */
export function frameFileStem(frameNumber: number): string {
  return `frame-${String(frameNumber).padStart(3, '0')}`;
}
