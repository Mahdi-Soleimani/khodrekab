# CARNO: FINAL CGI EXECUTION ORDER

**STATUS: ISSUED TO 3D RENDER TEAM**
**HOLD ON FULL PRODUCTION IMPOSED**

## Phase 1: Test Frame Validation (Mandatory)
Before the full 120-frame sequence is rendered, the CGI team MUST render and deliver only the following 6 narrative keyframes:
- **`frame-001.webp`** (Hero Front 3/4)
- **`frame-024.webp`** (Front-Side Transition)
- **`frame-048.webp`** (Perfect Side Profile)
- **`frame-072.webp`** (Rear 3/4)
- **`frame-096.webp`** (Rear Inspection Angle)
- **`frame-120.webp`** (Hero Front 3/4 Return)

## Phase 2: Technical & Visual Audit
Upon receiving the 6 frames, the Technical Art Director will validate against the following absolute requirements:
- [ ] **Scale:** Vehicle occupies exactly 80% width at the widest angle (Frame 048).
- [ ] **Camera:** Absolutely static. Zero translation. Zero focal length shift.
- [ ] **Lighting:** Absolutely static. Reflections must slide across the paint due to model rotation only.
- [ ] **Post-Processing:** NO motion blur. NO Depth of Field (DOF). Image must be perfectly sharp.
- [ ] **Branding:** NO logos or brand markers anywhere on the vehicle.
- [ ] **Background:** Rendered as Transparent RGBA.
- [ ] **Floor:** Shadow catcher successfully baked into the Alpha channel for seamless CSS integration.

## Phase 3: Frontend Calibration Sync (Scene 03)
Frame 048 (Side Profile) will be placed in the frontend against `calibration.ts` values:
```javascript
  scene03: {
    marketIntelligence: {
      top: '20%',
      left: '25%',
      lineH: '120px'
    }
  }
```
*   **Verification:** The `marketIntelligence` leader line must physically point to an empty area above the front-left quarter panel/hood of the vehicle, clearing the geometry perfectly while remaining visually attached to the silhouette.

## Phase 4: Full Production Release
**ONLY** upon written approval of the 6 test frames and successful calibration sync will the CGI team be cleared to render the full `frame-001.webp` through `frame-120.webp` sequence.

*   **NO interpolation.**
*   **NO AI frame generation.**
*   **NO crossfading.**
*   **NO camera animation.**

The final sequence must be a physically correct, brute-force 3D rotation render.
