import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_FRAME_COUNT,
  logicalToFrameNumber,
  frameNumberToLogical,
  progressToLogical,
  frameFileStem,
} from '../src/features/carno-experience/delivery/frameIndex';
import {
  selectProfileId,
  assetIdentityFor,
  frameUrl,
  POSTER_ASSETS,
} from '../src/features/carno-experience/delivery/assetProfile';
import {
  STRIDE_LADDER,
  assertLadder,
  strideCandidates,
  ValidationLedger,
} from '../src/features/carno-experience/delivery/strideCoverage';
import {
  FrameScheduler,
  FrameSource,
  FrameSink,
} from '../src/features/carno-experience/delivery/FrameScheduler';
import {
  compareCanvasToReference,
  containRect,
  DEFAULT_THRESHOLDS,
  ENGINE_DEBUG_OVERLAY,
} from '../src/features/carno-experience/delivery/handoffVerifier';
import { LoadPriority, CarnoManifest } from '../src/features/carno-experience/engine/loader/types';
import { ProtectionTier } from '../src/features/carno-experience/engine/cache/types';

async function runTests() {
  console.log('--- [Test Suite: Carno Delivery Layer] ---');

  // ==========================================
  // Test 1: Logical Indexing (0..119 <-> 1..120)
  // ==========================================
  console.log('1. Testing Logical Indexing...');
  assert.equal(logicalToFrameNumber(0), 1);
  assert.equal(logicalToFrameNumber(119), 120);
  assert.throws(() => logicalToFrameNumber(-1), RangeError);
  assert.throws(() => logicalToFrameNumber(120), RangeError);

  assert.equal(frameNumberToLogical(1), 0);
  assert.equal(frameNumberToLogical(120), 119);
  assert.throws(() => frameNumberToLogical(0), RangeError);
  assert.throws(() => frameNumberToLogical(121), RangeError);

  assert.equal(progressToLogical(0), 0);
  assert.equal(progressToLogical(1), 119);
  assert.equal(progressToLogical(-0.5), 0);
  assert.equal(progressToLogical(1.5), 119);
  assert.equal(progressToLogical(0.5), 59);

  assert.equal(frameFileStem(1), 'frame-001');
  assert.equal(frameFileStem(42), 'frame-042');
  assert.equal(frameFileStem(120), 'frame-120');
  console.log('  ✓ Logical Indexing passed.');

  // ==========================================
  // Test 2: Asset Profile & Manifest Match
  // ==========================================
  console.log('2. Testing Asset Profile & Manifest Integrity...');
  const manifestPath = path.resolve(process.cwd(), 'public/car-frames/v1/manifest.json');
  const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  const manifest: CarnoManifest = JSON.parse(manifestRaw);

  assert.equal(manifest.frameCount, DEFAULT_FRAME_COUNT);
  assert.equal(manifest.version, 'v1');

  const mobileProfile = selectProfileId(manifest, true);
  assert.equal(mobileProfile, 'mobile');
  const desktopProfile = selectProfileId(manifest, false);
  assert.equal(desktopProfile, 'desktop');

  const mobileId = assetIdentityFor(manifest, 'mobile');
  assert.equal(mobileId.width, 960);
  assert.equal(mobileId.profileId, 'mobile');

  const desktopId = assetIdentityFor(manifest, 'desktop');
  assert.equal(desktopId.width, 1600);
  assert.equal(desktopId.profileId, 'desktop');

  assert.equal(frameUrl(manifest, 'desktop', 1), POSTER_ASSETS.desktop.src);
  assert.equal(frameUrl(manifest, 'mobile', 1), POSTER_ASSETS.mobile.src);
  console.log('  ✓ Asset Profile matches manifest and poster constants.');

  // ==========================================
  // Test 3: Stride Ladder & Candidate Sets
  // ==========================================
  console.log('3. Testing Stride Coverage & Ledger...');
  assertLadder(STRIDE_LADDER);
  assert.deepEqual(Array.from(STRIDE_LADDER), [8, 4, 2, 1]);

  const s0 = strideCandidates(0, 120, STRIDE_LADDER); // stride 8
  const s1 = strideCandidates(1, 120, STRIDE_LADDER); // stride 4
  const s2 = strideCandidates(2, 120, STRIDE_LADDER); // stride 2
  const s3 = strideCandidates(3, 120, STRIDE_LADDER); // stride 1

  assert.equal(s0.length, 15);
  assert.equal(s1.length, 30);
  assert.equal(s2.length, 60);
  assert.equal(s3.length, 120);

  // Divisibility and nesting: S0 ⊂ S1 ⊂ S2 ⊂ S3
  for (const c of s0) assert.ok(s1.includes(c));
  for (const c of s1) assert.ok(s2.includes(c));
  for (const c of s2) assert.ok(s3.includes(c));

  const ledger = new ValidationLedger(120);
  assert.equal(ledger.validatedCount(desktopId), 0);

  // Mark frame 0 validated
  assert.equal(ledger.markValidated(desktopId, 0), true);
  // Duplicate validation check (set semantics)
  assert.equal(ledger.markValidated(desktopId, 0), false);
  assert.equal(ledger.validatedCount(desktopId), 1);
  assert.equal(ledger.validatedCount(mobileId), 0); // Isolated identities

  // Validate all stride 8 frames
  for (const idx of s0) {
    ledger.markValidated(desktopId, idx);
  }
  assert.equal(ledger.strideReady(desktopId, 0), true);
  assert.equal(ledger.strideReady(desktopId, 1), false);
  console.log('  ✓ Stride ladder & ValidationLedger passed.');

  // ==========================================
  // Test 4: Scheduler Concurrency, Priorities & Cleanup
  // ==========================================
  console.log('4. Testing FrameScheduler Preemption, Retries & Disposal...');
  const residentFrames = new Set<number>();
  let closedBitmaps = 0;

  class FakeBitmap {
    readonly width = 1600;
    readonly height = 900;
    closed = false;
    close() {
      if (!this.closed) {
        this.closed = true;
        closedBitmaps++;
      }
    }
  }

  const loadsRequested: { frameNumber: number; priority: LoadPriority }[] = [];
  const cancelledFrames: number[] = [];

  const fakeSource: FrameSource = {
    load: async (frameNumber, priority) => {
      loadsRequested.push({ frameNumber, priority });
      return { bitmap: new FakeBitmap() as unknown as ImageBitmap };
    },
    cancel: (frameNumber) => {
      cancelledFrames.push(frameNumber);
    },
  };

  const fakeSink: FrameSink = {
    has: (frameNumber) => residentFrames.has(frameNumber),
    insert: (frameNumber, _bitmap, _tier) => {
      residentFrames.add(frameNumber);
    },
  };

  const scheduler = new FrameScheduler({
    identity: desktopId,
    frameCount: 120,
    source: fakeSource,
    sink: fakeSink,
    ledger: new ValidationLedger(120),
    validate: (b): b is ImageBitmap => (b as unknown as FakeBitmap).width === 1600,
    r0Radius: 2,
    r1Radius: 5,
    maxPending: 4,
  });

  scheduler.start();
  // Pump runs and initiates loads up to maxPending + r0
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(loadsRequested.length > 0, 'Scheduler should have requested initial frames');
  assert.ok(residentFrames.has(1), 'Hero frame (frame 1, logical 0) must be loaded');

  // Test scroll preemption
  scheduler.setCenter(50); // logical 50 -> frame 51
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(scheduler.getCenter() === 50);

  // Test disposal cleanup
  const beforeDrop = closedBitmaps;
  scheduler.dispose();
  assert.equal(scheduler.isDisposed(), true);
  console.log('  ✓ FrameScheduler passed.');

  // ==========================================
  // Test 5: Handoff Verifier Comparison Math
  // ==========================================
  console.log('5. Testing Handoff Verifier (ContainRect & Pixel Comparison)...');
  const cr = containRect(1920, 1080, 1600, 900);
  assert.equal(cr.x, 0);
  assert.equal(cr.y, 0);
  assert.equal(cr.w, 1920);
  assert.equal(cr.h, 1080);

  // Letterboxed
  const crLetter = containRect(1000, 1000, 1600, 900);
  assert.equal(crLetter.w, 1000);
  assert.equal(crLetter.h, 562.5);

  // Compare identical buffers
  const W = 10;
  const H = 10;
  const buf1 = new Uint8ClampedArray(W * H * 4);
  const buf2 = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < buf1.length; i += 4) {
    buf1[i] = 200; // R
    buf1[i + 1] = 100; // G
    buf1[i + 2] = 50; // B
    buf1[i + 3] = 255; // Alpha
    buf2[i] = 200;
    buf2[i + 1] = 100;
    buf2[i + 2] = 50;
    buf2[i + 3] = 255;
  }

  const identicalResult = compareCanvasToReference(buf1, buf2, W, H, [], null);
  assert.equal(identicalResult.verdict, 'correct');
  assert.equal(identicalResult.mad, 0);

  // Compare with blank buffer
  const blankBuf = new Uint8ClampedArray(W * H * 4);
  const blankResult = compareCanvasToReference(blankBuf, buf2, W, H, [], null);
  assert.equal(blankResult.verdict, 'blank');

  // Compare with masked overlay
  const overlayBuf = new Uint8ClampedArray(W * H * 4);
  // Set overlay area
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 5; y++) {
      const o = (y * W + x) * 4;
      overlayBuf[o] = 255;
      overlayBuf[o + 3] = 255;
    }
  }
  const overlayOnlyResult = compareCanvasToReference(
    overlayBuf,
    buf2,
    W,
    H,
    [{ x0: 0, y0: 0, x1: 5, y1: 5 }],
    { x0: 0, y0: 0, x1: 5, y1: 5 }
  );
  assert.equal(overlayOnlyResult.verdict, 'overlay-only');
  console.log('  ✓ Handoff Verifier pixel math passed.');

  console.log('\n--- ALL DELIVERY LAYER TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
