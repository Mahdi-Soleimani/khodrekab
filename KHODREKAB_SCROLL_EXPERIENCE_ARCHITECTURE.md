# CARNO SCROLL EXPERIENCE ARCHITECTURE

## 1. System Data Flow

Designed to achieve a smooth 60FPS experience on supported devices, responsibilities are strictly separated:

**GSAP ScrollTrigger**  
*(Calculates scroll progress 0.0 - 1.0 via CSS `position: sticky` and `height: 500vh` scroll distance)*  
⬇  
**Experience State Machine**  
*(Manages high-level phases: DISCOVERY, INSPECTION, RISK_REVEAL, SOLUTION, CTA)*  
⬇  
**Story Timeline Controller**  
*(Orchestrates storytelling UI, dispatches analytics events, maps states to logical story points.)*  
⬇  
**Frame Controller (React hook)**  
*(Maps 0.0-1.0 to integer frame 1-120. Updates `useRef` ONLY. Triggers render loop.)*  
⬇  
**Image Sequence Loader (Worker / Async Loader)**  
*(Downloads WebP assets according to priority matrix and warmup strategy.)*  
⬇  
**ImageBitmap Cache (Dynamic LRU Memory Manager)**  
*(Decodes bytes to GPU-ready `ImageBitmap`. Evicts old frames to prevent OOM.)*  
⬇  
**Canvas Renderer**  
*(Pulls current frame index from `useRef`, fetches `ImageBitmap` from cache, draws via `requestAnimationFrame`.)*

---

## 2. Next.js 16 App Router Separation

To preserve Server Components (RSC) benefits:
- `app/page.tsx` remains a **Server Component**.
- `<CarExperience />` is the main **Client Component** boundary.
- Sub-components (`CarCanvas`, `StoryScroller`, `useImageSequence`) live entirely client-side.

---

## 3. Analytics Integration

The experience is heavily instrumented:

### Performance Events
- `car_asset_load_started`
- `car_asset_first_frame_ready`
- `car_scroll_ready`
- `car_memory_warning`

### Behavior Events
- `car_story_completed`
- `car_story_skipped`
- `cta_visible`
- `cta_hovered`
- `cta_clicked`

---

## 4. Accessibility & Fallbacks

### Prefers Reduced Motion
If a user has `prefers-reduced-motion: reduce` enabled on their OS:
- The scroll-driven 3D rotation is disabled.
- The 3D view is locked to a static, high-value angle.
- Text content fades in during scroll instead of triggering spatial translation.

---

## 5. Memory Management Strategy (Dynamic LRU)

We implement a **Dynamic LRU Cache** based on device capabilities (`navigator.deviceMemory`):

- **Low Memory (<= 4GB):** Max 8 active `ImageBitmap` instances.
- **High Memory (> 4GB) / Desktop:** Max 12-20 active `ImageBitmap` instances.
- **Eviction Protocol:** When a frame is evicted, we explicitly call `bitmap.close()` to free GPU memory immediately.

---

## 6. Progressive Loading & Asset Warmup Strategy

Images are fetched and decoded in a strict sequence to prevent scroll jank:

1. **Priority 1 (Hero):** Load and Decode `frame-001.webp`.
2. **Priority 2 (Warmup Keyframes):** Load and Decode `030`, `060`, `090`, `120`. (Prevents jank if user scrolls fast early).
3. **Priority 3 (Secondary Warmup):** Load and Decode `015`, `045`, `075`, `105`.
4. **Priority 4 (Near Scroll):** Frames directly adjacent to the current scroll index.
5. **Priority 5 (Background):** Remaining frames during idle time.
