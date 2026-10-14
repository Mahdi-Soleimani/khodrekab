# CARNO RUNTIME PERFORMANCE

## 1. Rendering Metrics

- **FPS:** Target is exactly 60 FPS while the user is actively scrolling.
- **Dropped Frames:** Allowed to drop < 2% of frames under heavy scroll velocity.
- **Frame Render Time:** `ctx.drawImage` operation must resolve < 2ms to stay within 16.6ms frame budget.
- **requestAnimationFrame Stability:** Ensures smooth interpolation even if main thread is blocked by other tasks.

## 2. Memory Validation

Memory allocation dynamically restricts `ImageBitmap` cache capacity based on system hardware.

### Low Device
- Profile: `<=4GB RAM`
- Capacity: `8 ImageBitmaps`
- Eviction is extremely aggressive. Keyframes are preserved only if adjacent to active viewing zone.

### Normal Device
- Profile: `4-8GB RAM`
- Capacity: `12 ImageBitmaps`
- Standard LRU behaves reliably.

### High End Device
- Profile: `>8GB RAM`
- Capacity: `20 ImageBitmaps`
- Smooth pre-fetching and caching of adjacent sequences.

## 3. Loading Metrics

- **Manifest ready:** < 50ms locally.
- **First frame ready:** Evaluated via `car_asset_first_frame_ready` analytics event. The UI guarantees frame 1 is decoded instantly.
- **Scroll ready:** Evaluated via `car_scroll_ready` when `Priority 1` and `Priority 2` frames are loaded.

