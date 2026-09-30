# CARNO PRODUCTION CHECKLIST

## Architecture
- [x] Engine independent (No UI coupled inside the engine layer)
- [x] No React animation state (`useState` does not trigger on scroll)
- [x] No hardcoded assets (URL paths dynamic based on profile)
- [x] Manifest driven (`frameCount` strictly dictated by `manifest.json`)

## Performance
- [x] 60FPS tested across Chrome, Safari, and Mobile
- [x] Memory bounded (LRU Capacity strictly governed by device memory)
- [x] Mobile Safari checked (Aggressive `bitmap.close()` prevents crashes)
- [x] Reduced motion fallback verified (Static hero frame displayed if preferred)

## Assets
- [x] All frames generated deterministically via pipeline
- [x] Manifest valid (`validateIntegrity` passed)
- [x] Desktop profile generated (1600px width, 80 quality WebP)
- [x] Mobile profile generated (960px width, 75 quality WebP)

