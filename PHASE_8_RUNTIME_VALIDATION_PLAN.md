# PHASE 8 — RUNTIME VALIDATION PLAN

## 1. Files to Modify/Create

### Documentation & Validation
- **`CARNO_RUNTIME_VALIDATION.md`** (Create): Will document the expected folder structure for assets, manifest rules, frame availability, and browser load flow.
- **`CARNO_RUNTIME_PERFORMANCE.md`** (Create): Will specify how loading, rendering (60 FPS), and memory limits are measured and enforced across devices.
- **`CARNO_PRODUCTION_CHECKLIST.md`** (Create): The final architectural and UX checklist before releasing to production.

### Source Code
- **`src/features/carno-experience/debug/CarnoDebugPanel.tsx`** (Create): A development-only React component that overlays current Engine metrics (Frame, FPS, Cache capacity, memory profile).
- **`src/features/carno-experience/hooks/useCarnoExperience.ts`** (Modify): Minor refinements to expose a safe, read-only stats object to the `CarnoDebugPanel` without triggering re-renders in the main animation loop.

---

## 2. Why Each Modification is Needed

- **Validation Docs:** The 3 Markdown files act as living contracts to ensure that when assets change or the project scales, developers can verify memory behavior, safari limits, and pipeline integrity.
- **CarnoDebugPanel:** Because the Canvas rendering is detached from React state, it is impossible to debug dropped frames or cache evictions using standard React DevTools. A dedicated panel is necessary to monitor the `BitmapCache` and `CanvasRenderer` health in real-time.
- **useCarnoExperience:** Needs to ensure that the initial P0/P1 frame priorities (Hero and Keyframes) are executing perfectly and exposing read-only refs for the debug panel.

---

## 3. Connection to Existing Architecture

- The **`CarnoDebugPanel`** will be imported inside `CarnoExperience.tsx` but guarded by an environment check (e.g., `process.env.NODE_ENV === 'development'`).
- The panel will read directly from the `engineRef.current.cache` and `engineRef.current.controller` using a `setInterval` or `requestAnimationFrame` polling mechanism. It will *not* bind to `useState` hooks driven by the scroll progress, ensuring the engine stays perfectly decoupled.
- The **Manifest logic** inside `useCarnoExperience` connects the output from Phase 7 (`manifest.json`) directly into the `AssetResolver` and `FrameLoader`.

---

## 4. Avoiding Breakage of Previous Phases

- **No Engine Modifications:** `BitmapCache`, `CanvasRenderer`, `FrameController`, and `LoadQueue` remain exactly as they were implemented in Phases 3-5.
- **No React Render Loops:** By polling data in the debug panel instead of lifting state up, we prevent React from re-rendering the `CarCanvas` boundary.
- **Production Isolation:** The debug component will be tree-shaken in production builds, meaning Phase 8 adds zero runtime cost to the end user.
- **Dependency Isolation:** No new libraries (like Three.js or GSAP plugins) will be added. The Canvas API remains the sole graphics target.
