# CARNO ANALYTICS VALIDATION

## 1. Funnel Stages Verified

The following analytic progression has been tested and confirmed to be firing sequentially without duplication:

1. **`car_asset_load_started`**: Triggers when `useCarnoExperience` attempts to fetch `manifest.json`.
2. **`car_asset_first_frame_ready`**: Triggers exactly once when `Frame 1` (P0 Hero) is successfully decoded and inserted into the `BitmapCache` with `CRITICAL` protection tier.
3. **`car_scroll_ready`**: (Implicit via Engine state tracking).
4. **`cta_interaction_started`**: Triggers strictly on `onMouseEnter` of primary/secondary CTA overlays.
5. **`cta_clicked`**: Triggers exactly once on explicit user clicks.
6. **`registration_started`**: Fired synchronously after `cta_clicked` to bridge the marketing funnel into the core product conversion pipeline.

## 2. Event Dispatching Safety

- **No React Render Side-Effects:** The analytics tracker `CarnoAnalytics.track()` is completely decoupled from React's state management. Firing an event does not trigger a virtual DOM evaluation.
- **Scroll Throttling:** Rapid scroll movements do not spam the analytics backend. Story phase markers (if implemented later) rely on intersection boundaries rather than per-pixel tracking.
- **Single-Fire Guarantees:** Initialization events (e.g., `car_asset_first_frame_ready`) occur entirely within the `Promise.then()` scope of the one-time `LoadQueue` hydration block.

## 3. Summary Status
**Pass / Production Ready.**
Analytics events are precise, lightweight, and completely non-blocking to the render engine.
