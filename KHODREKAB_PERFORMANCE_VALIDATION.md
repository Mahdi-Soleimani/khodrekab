# CARNO PERFORMANCE VALIDATION MATRIX

## 1. Metrics & KPIs

### Initial Loading (Time to First Frame)
- **Manifest Fetch Time:** Expected < 50ms (Cache Hit) or < 150ms (Network).
- **First Frame Decode:** `createImageBitmap` on WebP format is off-main-thread and should complete in < 20ms.
- **First Visual Render Time:** Target is < 800ms to ensure the `car_asset_first_frame_ready` event triggers quickly without disrupting LCP.

### Warmup Performance (Scroll Readiness)
- **Keyframe Loading Duration:** Priority 2 keyframes must load seamlessly in the background without blocking the main thread.
- **Event Target:** `car_scroll_ready` should fire when the minimum keyframes are cached.

### Runtime Performance
- **Target FPS:** 60FPS lock during active scroll.
- **Dropped Frames:** Tolerable drop rate is < 2% on mobile devices, achieved by preemptive decoding.
- **Memory Growth:** Controlled via LRU Cache; expected stabilized memory usage ~40MB to 100MB depending on cache capacity.

---

## 2. Device Testing Matrix

| Device Profile | RAM | Cache Capacity | Eviction Policy | Expected Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **High-end Desktop** | > 8GB | 20+ bitmaps | Lazy eviction | Smooth 60FPS; full caching of adjacent and keyframes. |
| **Normal Device** | 4-8GB | 12 bitmaps | Standard | Stable 60FPS; keyframes persist, intermediate frames cycle. |
| **Low Memory Device**| <= 4GB | 8 bitmaps | Aggressive | Dependent on fast decodes over network; strict `bitmap.close()` calls on eviction to prevent OOM. |
| **Mobile Safari** | Varies | 8-12 bitmaps | Strict Limit | Canvas memory strictly bounded. Relies heavily on immediate bitmap closure after drawing to prevent WebKit GPU context crashes. |

---

## 3. Network Optimization Strategy

We utilize `navigator.connection` to influence load prioritization conceptually:
- **4G / Fast Connection:** Normal queue behavior. Hero -> Keyframes -> Preload adjacent.
- **3G / Slow Connection:** Priority shifts to heavily ensure Hero and sparse Keyframes are loaded first. Background loading is throttled.

---

## 4. Accessibility & Fallbacks

### Reduced Motion
Validating `window.matchMedia('(prefers-reduced-motion: reduce)')`:
- If `true`, the `CanvasRenderer` does not start the aggressive rendering loop.
- The Engine gracefully defaults to displaying a static hero frame with CSS transitions (e.g., opacity fades) across the story phases instead of full 3D rotation.

---

## 5. Asset Pipeline Validation

- **Missing/Duplicated Frames:** Build script (`generate-pipeline.js`) explicitly checks sequential integrity.
- **Manifest Source of Truth:** Frame count is parsed from `readdir` outputs; keyframes are verified mathematically against boundaries.
- **WebP Output:** Confirmed determinism in resizing to 1600px/960px with Sharp's WebP codec, drastically saving bandwidth vs raw PNGs.
