# PHASE 7 — ASSET PIPELINE & PRODUCTION VALIDATION PLAN

## 1. Files to Create

### Scripts (Asset Pipeline)
- `scripts/carno-assets/generate-pipeline.js`: The main orchestrator script that runs the entire build process.
- `scripts/carno-assets/image-converter.js`: Handles resizing, WebP conversion, zero-padding, and deterministic naming using `sharp`.
- `scripts/carno-assets/manifest-generator.js`: Automatically calculates frame counts and generates the `manifest.json` compliant with `CARNO_MANIFEST_SCHEMA.md`.

### Documentation
- `CARNO_PERFORMANCE_VALIDATION.md`: A comprehensive validation matrix detailing LCP metrics, cache capacities, memory handling, and device-specific expectations.

---

## 2. Responsibilities

**Asset Processing (Image Converter)**
- Reads raw output files (e.g., `.png` or `.jpg`) from a source directory (`scripts/carno-assets/raw/`).
- Processes frames deterministically, sorting them alphabetically to ensure frame 1 is `frame-001.webp`.
- Outputs two profiles:
  - **Desktop:** 1600px width, Quality 80
  - **Mobile:** 960px width, Quality 75

**Manifest Generation**
- Scans the generated output directories to determine the exact `frameCount`.
- Computes `keyframes` (e.g., evenly spaced 5 keyframes).
- Writes the `public/car-frames/v1/manifest.json` file.
- **Rule:** Never hardcode the frame count. The manifest is the absolute source of truth.

**Performance Validation (Documentation)**
- Defines measurable KPIs for LCP (`car_asset_first_frame_ready`) and Interaction readiness (`car_scroll_ready`).
- Documents memory behavior mapping device RAM (`navigator.deviceMemory`) to `ImageBitmap` caching capacity.
- Handles accessibility fallbacks (`prefers-reduced-motion`) and varying network capabilities.

---

## 3. Data Flow

1. **Input:** 3D Artist drops 120 raw CGI rendered frames into `scripts/carno-assets/raw/`.
2. **Execution:** Developer runs `npm run carno:generate-assets`.
3. **Processing (Desktop):** Converter resizes assets to 1600w, WebP-80, writes to `public/car-frames/v1/desktop/`.
4. **Processing (Mobile):** Converter resizes assets to 960w, WebP-75, writes to `public/car-frames/v1/mobile/`.
5. **Manifesting:** Generator counts files, builds `CarnoManifest` schema, saves as `public/car-frames/v1/manifest.json`.
6. **Consumption:** `useCarnoExperience` fetches `/car-frames/v1/manifest.json`. The `AssetResolver` dynamically forms URLs. `FrameLoader` fetches WebP. `BitmapCache` manages decoded images.

---

## 4. Validation Strategy

### Architecture Compliance
- **AssetResolver Validation:** Ensure `resolveFrameURL` perfectly maps to the new `public/car-frames/v1/[profile]/frame-[pad].webp` schema without any React changes.
- **Engine Isolation:** Ensure that updating the `v1` path to `v2` in `useCarnoExperience` requires zero logic changes in `Loader` or `Renderer`.

### Memory & Performance Validation
- **Cache Eviction:** Verify that on Low-Memory Devices (<=4GB RAM), the LRU cache is capped at 8 and invokes `bitmap.close()` aggressively.
- **Mobile Safari Limits:** Monitor Canvas memory footprints to ensure Mobile Safari does not crash the GPU context.

### Network Validation
- **Fast 3G vs 4G:** Validate that the priority queue mechanism (Hero -> Keyframes -> Secondary -> Nearby) prevents visual blocking.
- **Connection API:** Document using `navigator.connection` to potentially fallback to lower resolution or skip secondary keyframes on `slow-2g`.

### Accessibility Validation
- **Reduced Motion:** Validate `window.matchMedia('(prefers-reduced-motion: reduce)')` bypasses the `CanvasRenderer` start loop and shows a static hero frame gracefully.
