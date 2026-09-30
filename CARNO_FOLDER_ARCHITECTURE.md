# Production Folder Architecture

Final directory structure mapping for the `carno-experience` feature slice inside the Next.js 16 App Router environment.

## Structure

```
src/
 └── features/
      └── carno-experience/
          ├── components/
          ├── engine/
          ├── story/
          ├── config/
          ├── analytics/
          └── types/
```

## Responsibilities

### `components/`
- **Responsibility:** React components (`CarExperience`, `CarCanvas`, `StoryScroller`). GSAP definitions go here inside `useGSAP`.
- **Restriction:** NO data loading logic, NO direct `ImageBitmap` manipulation, NO state machine business logic. All components should map props and Context securely.

### `engine/`
- **Responsibility:** Vanilla TS classes or standalone functions for performance-critical work (`FrameLoader`, `BitmapCache`, `CanvasRenderer`).
- **Restriction:** NO React dependencies (`useState`, `useEffect`). Must be pure DOM/JS APIs (Canvas, Workers, Fetch) to ensure it runs completely independent of the React lifecycle.

### `story/`
- **Responsibility:** State Machine logic, Phase definitions, Progress mapping (`ExperienceStateMachine`).
- **Restriction:** NO rendering logic. Pure data transformation (e.g., given progress `0.5`, return `Phase 2`).

### `config/`
- **Responsibility:** Static configuration files, constants (`manifest.json` parsing, memory limits).
- **Restriction:** NO side effects. Only pure objects/interfaces.

### `analytics/`
- **Responsibility:** Handlers for dispatching events (`dispatchPerformanceEvent`, `dispatchBehaviorEvent`).
- **Restriction:** Decoupled from the engine. Engine calls `analytics.reportReady()`, analytics decides how to format and send it to Tag Manager or backend.

### `types/`
- **Responsibility:** Global TypeScript interfaces for the feature (`StoryPhase`, `AnalyticsEvent`, `AssetProfile`).
- **Restriction:** TypeScript `type` and `interface` only. No runtime execution code.
