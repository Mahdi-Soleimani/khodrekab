# CARNO RUNTIME VALIDATION

## 1. Asset Validation

### Expected Structure
The assets must be served identically to this structure to ensure loader resolution succeeds.
```
public/
 └── car-frames/
      └── v1/
          ├── manifest.json
          ├── desktop/
          │    ├── frame-001.webp
          │    ├── frame-002.webp
          │    └── ...
          └── mobile/
               ├── frame-001.webp
               └── ...
```

### Manifest Loading Flow
1. Fetch `manifest.json`.
2. Extract `frameCount` dynamically (do not hardcode).
3. Extract `keyframes` array.
4. Extract profile definitions (`desktop` vs `mobile`).

### Missing Frame Behavior
- Handled gracefully via `Promise.catch()` in `FrameLoader`.
- Missing frames do not block surrounding frames.
- If a frame is missing, `CanvasRenderer` preserves the previous frame until a successful decode happens.

## 2. Runtime Flow

```text
User Scroll
      ↓
StoryScroller (GSAP ScrollTrigger progress event)
      ↓
FrameController (Clamps progress, calculates deterministic target frame)
      ↓
CanvasRenderer (requestAnimationFrame loop draws if frame changed)
      ↓
BitmapCache (Synchronous hit test)
      ↓
LoadQueue (Priority scheduling if frame missing from cache)
      ↓
FrameLoader (Fetch + createImageBitmap decode)
      ↓
ImageBitmap (Passed back to cache, then drawn)
```

## 3. Browser Validation

### Chrome
- `createImageBitmap` enabled and operates fully off-main-thread.
- Cache size can comfortably handle Normal/High memory profiles.
- 60FPS scrolling holds steady.

### Safari
- Heavily restricted Canvas Memory context.
- Dependent on aggressive eviction.
- The `bitmap.close()` lifecycle method ensures orphaned ImageBitmaps release GPU memory immediately.
- Validated to prevent random page reloads due to memory pressure.

### Mobile Safari
- Fallback profile triggers automatically.
- Lower resolution (e.g. 960px width) significantly drops baseline memory requirement.

### Firefox
- Equivalent to Chrome, `createImageBitmap` supported.
