# CARNO TECHNICAL DECISIONS

## 1. Canvas API over `<img>` Tags
**Decision:** We are using a single `<canvas>` element drawn via `requestAnimationFrame` instead of swapping the `src` attribute of an `<img>` tag or using a massive CSS sprite sheet.
**Reasoning:** 
- Swapping `<img>` tags triggers browser layout recalculations and DOM updates, resulting in severe frame drops and jank during fast scrolling.
- Canvas allows us to bypass the DOM entirely. We write decoded pixel data directly to the GPU context, designed to achieve a smooth 60FPS experience on supported devices.

## 2. Canvas Alpha Strategy
**Decision:** The asset format is WebP RGBA (transparent). We will use `getContext("2d", { alpha: true })` for the initial version.
**Reasoning:**
- Maintaining transparency allows the premium car renders to composite perfectly over dynamic UI elements, gradient storytelling backgrounds, and glowing data layers. If profiling reveals severe compositing costs on low-end mobile devices later, we can selectively switch to `alpha: false` with pre-filled canvas backgrounds.

## 3. `ImageBitmap` over `HTMLImageElement`
**Decision:** Frames are fetched as `Blob`s and decoded using `createImageBitmap()` before being stored in the LRU cache.
**Reasoning:**
- `createImageBitmap()` forces the browser to decode the WebP file off the main thread (asynchronously). When the frame is drawn to the Canvas, the pre-decoded bitmap minimizes scroll-time decoding latency.

## 4. Native CSS Sticky Pin vs. GSAP Pin
**Decision:** We will use native CSS (`position: sticky`, `height: 500vh`) for the scroll container rather than GSAP's `pin: true`.
**Reasoning:**
- Native CSS sticky is handled completely off the main thread by the browser's compositor. It provides the highest possible performance and zero jank. GSAP ScrollTrigger will solely monitor the scroll distance inside this `500vh` container to drive the state machine.

## 5. WebP with Dual Profiles (Desktop/Mobile)
**Decision:** We process two distinct sequence folders (`/desktop/` at 1600px/Q80 and `/mobile/` at 960px/Q75) and serve them conditionally.
**Reasoning:**
- Decoding a 1600px image on an iPhone takes 3x more memory than a 960px image. By serving hardware-specific dimensions, we prevent OOM (Out of Memory) crashes while maintaining Retina-level sharpness on 390px-wide phone screens.

## 6. React `useRef` over `useState`
**Decision:** The current frame index is stored in a `useRef`, and the Canvas pulls from it.
**Reasoning:**
- If we stored `currentFrame` in React state (`useState`), every scroll pixel would trigger a React Virtual DOM reconciliation. At 60FPS, React cannot keep up, and the page would freeze. `useRef` avoids the React lifecycle entirely.
