# PHASE 3: LOADER IMPLEMENTATION PLAN
**Engine Component: Image Loader**

## 1. Files to Create
All files will be created inside the strict boundary of `src/features/carno-experience/engine/loader/`:
- `types.ts`: Defines interfaces for loading priorities, error structures, manifest typing, and queue jobs.
- `AssetResolver.ts`: Pure class/functions for URL string construction based on manifest and profile.
- `FrameLoader.ts`: The core `fetch()` and `createImageBitmap()` wrapper with AbortController support.
- `LoadQueue.ts`: Priority-based scheduler that manages concurrency and prevents duplicate inflight requests.
- `index.ts`: Public API export boundary for the loader module.

---

## 2. Class Responsibilities

### `AssetResolver`
- **Inputs**: Manifest JSON object, requested frame number, active Profile (desktop/mobile).
- **Duties**: Validates inputs. Pads the frame number with zeroes (e.g., `1` -> `001`). Constructs the final absolute/relative URL using `basePath`, `profile.directory`, and `extension`.
- **Restrictions**: Pure logic. No network requests. 

### `FrameLoader`
- **Inputs**: Frame URL, AbortSignal (optional).
- **Duties**: Executes `fetch(url)`, converts `Response` to `Blob`, and passes it to `createImageBitmap(blob)`.
- **Restrictions**: Does not know about frames, priority, or manifest. Only knows about URLs and `ImageBitmap` creation. Does not store the result.

### `LoadQueue`
- **Inputs**: Job requests (frame number, priority level).
- **Duties**: Maintains a priority queue (Hero = 1, Keyframes = 2, Secondary = 3, Nearby = 4, Background = 5). Executes a controlled number of concurrent `FrameLoader` requests (e.g., 4 at a time to avoid starving the network thread). Cancels outdated or low-priority requests if the user scrolls rapidly.
- **Restrictions**: Does not cache the decoded bitmaps (passes them back via Promise/Callback to be managed by `BitmapCache` later).

---

## 3. Data Flow

```text
Request Frame(s)
       ↓
[LoadQueue] Check if already in-flight. If not, add to priority queue.
       ↓
[LoadQueue] Pops highest priority job when concurrency slot opens.
       ↓
[AssetResolver] Resolves frame 30 + 'desktop' → '/car-frames/v1/desktop/frame-030.webp'
       ↓
[FrameLoader] fetch() with AbortController signal attached.
       ↓
[FrameLoader] blob() → createImageBitmap()
       ↓
Returns `ImageBitmap` to Queue Promise.
       ↓
Queue passes `ImageBitmap` back to caller (to be consumed by Cache module).
```

---

## 4. Error Strategy

We will implement structured Error sub-classes to allow the upper engine to recover gracefully.

- **`ManifestResolutionError`**: Thrown by `AssetResolver` if requested frame exceeds `manifest.frameCount` or if profile is missing.
- **`FrameLoadError`**: Thrown by `FrameLoader` on `404`, network failure, or corrupted Blob. Contains the `url`, `frameNumber`, and original `Error`.
- **`UnsupportedBrowserError`**: Thrown during initialization if `createImageBitmap` does not exist.
- **`AbortError`**: Native DOMException ignored/handled gracefully when `LoadQueue` cancels a pending fetch.

---

## 5. Browser Compatibility Strategy

- **`createImageBitmap` Fallback**: If the browser does not support `createImageBitmap` (extremely rare in modern browsers, but possible in older WebKit), the `FrameLoader` will fallback to creating a standard `HTMLImageElement` via `new Image()`, assigning `img.src = url`, and wrapping the `onload` event in a Promise.
- **Concurrency Limits**: `LoadQueue` will limit active HTTP requests (e.g., `maxConcurrent = 4`) to prevent `net::ERR_INSUFFICIENT_RESOURCES` and UI thread starvation, specifically for mobile Safari.

---

## 6. Architecture Contract Alignment

- **Manifest-Driven**: `AssetResolver` ensures *zero* hardcoded paths or frame counts. Everything is injected from the fetched manifest.
- **Framework-Agnostic**: Absolutely no React (`useState`, `useEffect`), GSAP, or UI code is present in this module. It is a pure TypeScript/DOM API engine.
- **Memory Safety**: `LoadQueue` only facilitates fetching and decoding. It does not retain references to the `ImageBitmap` objects once the Promise resolves. Memory limits (Dynamic LRU) will be strictly enforced by the future `cache` layer.
- **Progressive Warmup**: The Priority Queue natively supports the warmup sequences detailed in `CARNO_ARCHITECTURE_FINAL_REVIEW.md` (`1` -> `30,60...` -> `15,45...`).
