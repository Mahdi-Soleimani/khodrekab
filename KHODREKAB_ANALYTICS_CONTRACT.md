# Analytics Event Contract

Tracking both system performance and user conversion behavior.

## Base Schema

```typescript
export interface AnalyticsEvent {
  eventName: string;
  trigger: string;
  payload: Record<string, any>;
  reason: string;
}
```

## Performance Events

| Event Name | Trigger | Payload | Reason |
|------------|---------|---------|--------|
| `car_asset_load_started` | Frame Loader init | `{ profile: 'desktop'\|'mobile', totalSizeMB: number }` | Monitor start of pipeline |
| `car_asset_first_frame_ready` | Frame 1 decoded | `{ timeToFirstFrameMs: number }` | LCP equivalent metric |
| `car_scroll_ready` | Keyframes warmed up | `{ warmupTimeMs: number }` | Tracks when the user can smoothly scroll |
| `car_memory_warning` | LRU eviction limit hit | `{ deviceMemory: number, currentBitmaps: number }` | Monitor OOM risks |

## Behavior Events

| Event Name | Trigger | Payload | Reason |
|------------|---------|---------|--------|
| `car_scroll_depth` | Scroll hits milestones | `{ depth: 25\|50\|75\|100 }` | Standard scroll tracking |
| `car_story_phase_reached` | Entering new State | `{ phaseId: string }` | Track narrative funnel dropoff |
| `car_story_completed` | Reaching scroll 100% | `{ timeSpentSec: number }` | Successful journey completion |
| `car_story_skipped` | Fast scroll 0 to 100% | `{ scrollSpeedMs: number }` | Identify unengaged users |
| `cta_visible` | CTA enters viewport | `{ ctaType: 'primary'\|'secondary' }` | Impressions for conversion rate |
| `cta_hovered` | Mouse enter on CTA | `{ ctaType: 'primary'\|'secondary' }` | Measure intent/hesitation |
| `cta_clicked` | Mouse click on CTA | `{ ctaType: 'primary'\|'secondary' }` | Primary conversion metric |
| `registration_started` | Post-CTA action | `{ source: 'carno_experience', type: 'reserve'\|'notify' }` | Funnel success |
