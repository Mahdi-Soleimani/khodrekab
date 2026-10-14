# CARNO SCROLL EXPERIENCE PLAN

## 1. Project Analysis
**Current State:**
- The repository is a Next.js 16 app (`src/` dir structure, App Router).
- Dependencies already include `gsap` and `@gsap/react`, positioning us perfectly for high-performance scroll triggers.
- Production CGI assets are locked, optimized, and ready in `/public/car-frames/v1/desktop/` and `/public/car-frames/v1/mobile/`.
- `manifest.json` is generated and provides exact dimensions, counts, and quality metrics to the frontend.

## 2. Required New Files
To construct the 360-degree storytelling experience, the following core modules will be built:

1. **Architecture Document** (`CARNO_SCROLL_EXPERIENCE_ARCHITECTURE.md`): Detailed blueprint for state, memory, and GSAP integration.
2. **Image Sequence Engine** (`src/hooks/useImageSequence.ts`): Responsible for progressively loading and decoding `ImageBitmap` instances, and managing LRU cache based on device type.
3. **Canvas Renderer** (`src/components/CarCanvas.tsx`): Highly optimized raw HTML5 Canvas component that paints frames using `requestAnimationFrame` and bypasses React state rendering.
4. **Scroll Controller & Story** (`src/components/StoryScroller.tsx` or integrated into `page.tsx`): The GSAP `ScrollTrigger` wrapper that maps scroll progress to frame indexes and manages the textual storytelling overlays (Discovery → Inspection → Hidden Risk → Solution + CTA).

## 3. Risks & Mitigations

| Risk | Consequence | Mitigation |
|------|-------------|------------|
| **Memory Exhaustion** | Browser crash (especially on Safari/iOS) | Implement an LRU cache with strict limits (Mobile: 8-12 bitmaps, Desktop: 12-20) and forcefully call `.close()` on evicted `ImageBitmap` instances. |
| **React Re-rendering Jank** | Severe frame drops during scroll | Do **not** use `useState` for the current frame. Use mutable `useRef` for the active index and a dedicated `requestAnimationFrame` loop in the Canvas component. |
| **First Contentful Paint (LCP) Delay** | Poor initial loading experience | Aggressively preload ONLY `frame-001.webp` to display the hero state immediately. Defer loading story keyframes until the hero is visible. |
| **Layout Shift (CLS)** | Canvas jumping during initialization | Ensure the Canvas container has a CSS aspect-ratio or strict dimensions that match the `manifest.json` data before the first frame loads. |
| **Tightly Coupled Logic** | Hard to maintain/debug | Strictly separate GSAP (which only outputs a number from 1 to 120) from the Canvas Engine (which only takes a number and paints it) and the Image Engine (which only decodes frames). |

## 4. Implementation Order (Phases)

1. **PHASE 1 (Complete):** Analyze current project and create this plan (`CARNO_SCROLL_EXPERIENCE_PLAN.md`).
2. **PHASE 2:** Create architecture document (`CARNO_SCROLL_EXPERIENCE_ARCHITECTURE.md`).
3. **PHASE 3:** Build image loading engine (`useImageSequence.ts`).
4. **PHASE 4:** Build Canvas renderer (`CarCanvas.tsx`).
5. **PHASE 5:** Integrate GSAP timeline.
6. **PHASE 6:** Add storytelling content and CTA.
7. **PHASE 7:** Performance testing (LCP, Memory, FPS).

---
**Status:** PLAN APPROVED AND READY. Awaiting green light for PHASE 2.
