import { AssetIdentity, identityKey } from './assetProfile';

/**
 * Stride ladder from the unified specification: S1 = 8, S2 = 4, S3 = 2, S4 = 1.
 * Each stride divides the previous one, so the candidate sets are nested and cumulative:
 *   S_k = { i in 0..N-1 : i mod s_k = 0 },   S1 ⊂ S2 ⊂ S3 ⊂ S4 = {0..N-1}
 * For N = 120 the sizes are 15, 30, 60, 120.
 */
export const STRIDE_LADDER: readonly number[] = [8, 4, 2, 1];

export function assertLadder(ladder: readonly number[]): void {
  if (ladder.length === 0 || ladder[ladder.length - 1] !== 1) {
    throw new Error('Stride ladder must end with stride 1');
  }
  for (let k = 1; k < ladder.length; k++) {
    if (!(ladder[k] < ladder[k - 1]) || ladder[k - 1] % ladder[k] !== 0) {
      throw new Error(`Stride ladder must be a strictly decreasing divisibility chain; got ${ladder.join(',')}`);
    }
  }
}

/** Candidate set S_k (k is 0-based into the ladder). */
export function strideCandidates(k: number, frameCount: number, ladder: readonly number[] = STRIDE_LADDER): number[] {
  const s = ladder[k];
  if (!s) throw new RangeError(`No stride stage ${k}`);
  const out: number[] = [];
  for (let i = 0; i < frameCount; i += s) out.push(i);
  return out;
}

export function isInStride(logical: number, k: number, ladder: readonly number[] = STRIDE_LADDER): boolean {
  return logical % ladder[k] === 0;
}

/**
 * Historical validation per asset identity.
 * - A logical index is "validated" once a response for that identity completed, decoded and
 *   passed the available checks (decoded width == manifest profile width).
 * - Set semantics: retries and duplicate completions never count twice.
 * - Validation is NOT residency: eviction never removes an index from the ledger.
 */
export class ValidationLedger {
  private readonly sets = new Map<string, Set<number>>();
  private readonly ladder: readonly number[];

  constructor(private readonly frameCount: number, ladder: readonly number[] = STRIDE_LADDER) {
    assertLadder(ladder);
    this.ladder = ladder;
  }

  private setFor(id: AssetIdentity): Set<number> {
    const key = identityKey(id);
    let s = this.sets.get(key);
    if (!s) {
      s = new Set();
      this.sets.set(key, s);
    }
    return s;
  }

  /** Returns true if the index was newly validated for this identity. */
  markValidated(id: AssetIdentity, logical: number): boolean {
    if (!Number.isInteger(logical) || logical < 0 || logical >= this.frameCount) {
      throw new RangeError(`Logical index ${logical} out of range`);
    }
    const s = this.setFor(id);
    if (s.has(logical)) return false;
    s.add(logical);
    return true;
  }

  isValidated(id: AssetIdentity, logical: number): boolean {
    return this.sets.get(identityKey(id))?.has(logical) ?? false;
  }

  validatedCount(id: AssetIdentity): number {
    return this.sets.get(identityKey(id))?.size ?? 0;
  }

  /** coverage_k = |Validated(id) ∩ S_k| for each stage k. */
  strideCoverageCount(id: AssetIdentity): number[] {
    const s = this.sets.get(identityKey(id));
    const cov = this.ladder.map(() => 0);
    if (!s) return cov;
    for (const i of s) {
      for (let k = 0; k < this.ladder.length; k++) {
        if (i % this.ladder[k] === 0) cov[k]++;
      }
    }
    return cov;
  }

  strideStageSizes(): number[] {
    return this.ladder.map((_, k) => strideCandidates(k, this.frameCount, this.ladder).length);
  }

  strideReady(id: AssetIdentity, k: number): boolean {
    return this.strideCoverageCount(id)[k] === this.strideStageSizes()[k];
  }

  /** All frames of this identity validated at least once. Says nothing about residency. */
  allFramesReady(id: AssetIdentity): boolean {
    return this.validatedCount(id) === this.frameCount;
  }
}
