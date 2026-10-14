# CARNO ARCHITECTURE FINAL REVIEW
**Phase 2.6: Production Hardening Review**

## 1. Executive Summary
This document serves as the final architecture checkpoint for the Carno Web Experience before entering Phase 3 (Image Loader Engine Implementation). The focus of this review is to harden our data models, tighten our state machine, dynamically optimize memory management, and ensure absolute separation of concerns between narrative, interaction, and engine logic. The architecture is now strictly deterministic and highly scalable.

## 2. Final Decisions

### 2.1 Manifest Contract Refinements
- **`frames` to `frameCount`**: Renamed for semantic clarity.
- **`keyframes` Array**: Added a dedicated array to define explicit keyframes (e.g., `[1, 30, 60, 90, 120]`).
- **`defaultFrame`**: Explicitly set to `1` as the fallback/initial frame.
- **Rule:** No assets or frame data shall be hardcoded in the frontend. All logic must parse `manifest.json`.

### 2.2 Story Timeline Separation
- **Narrative vs. Interaction**: The story contract has been structurally divided. 
  - **Narrative**: User Psychology and Content (Headlines, Descriptions).
  - **Visual Behavior**: Background transitions, glow intensity, data markers, text animation.
  - **Conversion Behavior**: CTA visibility, trust layer appearance.
- **Rule:** Storytelling logic is purely declarative. React components only act as dumb receivers of the current state payload.

### 2.3 State Machine Corrections
- **State Remapping**: The terminal state is now `READY_FOR_CONVERSION` instead of `CTA_COMPLETE`.
- **Event-Driven CTA**: Interactions with the CTA are tracked as transitions/events (`cta_interaction_started`, `cta_clicked`, `registration_started`), NOT as global state phases. 
- **Reasoning**: A user can reach the conversion phase without interacting with it. The state machine represents narrative depth, not granular UI interactions.

### 2.4 Dynamic Memory & LRU Eviction Policy
- **Memory Scaling**:
  - `<= 4GB` RAM (Low memory): Max 8 `ImageBitmaps`.
  - Normal devices: Max 12 `ImageBitmaps`.
  - Desktop/High-end: Max 20 `ImageBitmaps`.
- **Protection Rules**: Core story keyframes (`1, 30, 60, 90, 120`) have elevated eviction protection. They must remain in memory or be the absolute last to be evicted.
- **Garbage Collection**: Evicted frames must strictly call `bitmap.close()` to prevent memory leaks and OOM crashes.

### 2.5 Conversion Trust Model
The user journey is formally modeled as: **Problem → Understanding → Solution → Proof → Action**.
The Trust Layer must credibility answer:
1. Why does this problem matter?
2. Why are current methods insufficient?
3. How does Carno solve it?
4. Why should the user trust the solution?
5. What is the next action?
*Marketing language must remain premium, objective, and evidence-based.*

### 2.6 Engine Folder Scalability
The `engine/` directory is standardized to handle future enhancements cleanly:
```text
engine/
 ├── loader/      # Handles fetch, priorities, aborts, retries
 ├── cache/       # LRU, Memory checks, Eviction protection
 ├── renderer/    # Canvas drawing, rAF loop
 └── scheduler/   # Coordinates idle loading and warmup sequence
```

---

## 3. Updated Contracts

### Manifest Schema Addition
```json
{
  "version": "v1",
  "frameCount": 120,
  "defaultFrame": 1,
  "keyframes": [1, 30, 60, 90, 120],
  "profiles": {
    "desktop": { "width": 1600, "quality": 80, "directory": "desktop" },
    "mobile": { "width": 960, "quality": 75, "directory": "mobile" }
  }
}
```

### Story Phase Separation
```typescript
export interface FinalStoryPhase {
  id: string;
  frameRange: [number, number];
  progressRange: [number, number];
  
  narrative: {
    userPsychology: string; // e.g., 'Desire for better decision'
    content: { headline: string; description: string; };
  };
  
  visualBehavior: {
    backgroundTransition: string;
    glowIntensity: number;
    textAnimation: string;
  };
  
  conversionBehavior: {
    ctaVisible: boolean;
    trustLayerProps: TrustModel;
  };
}
```

### Analytics Funnel Expansion
```typescript
// Final Funnel Path
1. 'hero_loaded'
2. 'story_phase_reached'
3. 'cta_visible'
4. 'cta_interaction_started' // NEW: Modal opened, input focused
5. 'cta_clicked'
6. 'registration_started'
```

---

## 4. Migration Notes
The conceptual contracts defined in Phase 2.5 (`CARNO_DATA_MODEL.md`, `CARNO_MANIFEST_SCHEMA.md`, `CARNO_STORY_CONTRACT.md`, `CARNO_STATE_MACHINE.md`, `CARNO_ANALYTICS_CONTRACT.md`) should be treated as implicitly updated to reflect the hardened definitions in this document. During Phase 3, implementations will utilize these refined typings and states directly.

---

## 5. Implementation Rules for Phase 3
1. **Engine Independence**: The `engine/` must be 100% framework-agnostic. No React dependencies.
2. **Schema Validation**: The Loader must parse and trust the Manifest. No hardcoding of `120` or asset paths.
3. **Memory Limits**: The Cache module must initialize its capacity limit dynamically by checking `navigator.deviceMemory || 4` upon instantiation.
4. **Eviction Protection**: The Cache logic must safeguard the `keyframes` array defined in the manifest.

---

## 6. Confirmation
**✅ No Code Changes Required.** 
All architecture constraints have been successfully documented and validated. The project is completely hardened and is officially ready to begin **PHASE 3 — Image Loader Engine Implementation.**
