# Experience State Machine Definition

Defining the deterministic states and side-effects for the scroll journey. This prevents UI glitches when users scroll erratically.

## States
`ENTRY` → `DISCOVERY` → `INSPECTION` → `RISK_REVEAL` → `SOLUTION` → `CTA_COMPLETE`

## Type Definition

```typescript
export type MachineState = 'ENTRY' | 'DISCOVERY' | 'INSPECTION' | 'RISK_REVEAL' | 'SOLUTION' | 'CTA_COMPLETE';

export interface Transition {
  from: MachineState;
  to: MachineState;
  trigger: 'scroll' | 'click' | 'auto';
  condition: (context: StateContext) => boolean;
  sideEffects: Array<'FIRE_ANALYTICS' | 'PRELOAD_FRAMES' | 'UPDATE_UI' | 'SHOW_TRUST_LAYER'>;
}

export interface StateContext {
  scrollProgress: number; // 0.0 to 1.0
  currentFrame: number;   // 1 to 120
}
```

## State Map

```yaml
State: ENTRY
Transitions:
  - TO: DISCOVERY
    Trigger: scroll
    Condition: scrollProgress > 0.1
    SideEffects:
      - Fire Analytics: { phase: 'DISCOVERY' }
      - Preload: Next adjacent frames

State: DISCOVERY
Transitions:
  - TO: INSPECTION
    Trigger: scroll
    Condition: scrollProgress > 0.25
    SideEffects:
      - Fire Analytics: { phase: 'INSPECTION' }
      - Update UI: { background: 'transition-1' }

State: INSPECTION
Transitions:
  - TO: RISK_REVEAL
    Trigger: scroll
    Condition: scrollProgress > 0.5
    SideEffects:
      - Fire Analytics: { phase: 'RISK_REVEAL' }
      - Update UI: { background: 'transition-risk' }

State: RISK_REVEAL
Transitions:
  - TO: SOLUTION
    Trigger: scroll
    Condition: scrollProgress > 0.75
    SideEffects:
      - Fire Analytics: { phase: 'SOLUTION' }
      - Preload: frames 90-120
      - Update UI: { background: 'transition-solution' }
      - SHOW_TRUST_LAYER: true

State: SOLUTION
Transitions:
  - TO: CTA_COMPLETE
    Trigger: click
    Condition: Primary or Secondary CTA Button Clicked
    SideEffects:
      - Fire Analytics: registration_started
```
