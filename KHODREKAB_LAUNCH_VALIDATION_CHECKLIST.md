# CARNO: LAUNCH VALIDATION CHECKLIST

This checklist is the final gate before Carno goes live. It ensures the product maintains its premium, automotive AI aesthetic once the 120-frame 3D sequence is integrated.

## 1. Before Asset Arrival
- [x] **Code Readiness:** `useImageSequence` and `CarCanvas` are fully operational with fallback scrubbing logic to prevent frame jumps.
- [x] **Calibration Readiness:** Spatial coordinates are centralized in `src/components/cinematic/calibration.ts`.
- [x] **Performance Readiness:** Image pre-loading strategy is optimized (Frame 0 -> 10 spaced frames -> remaining queue).
- [x] **Conversion Readiness:** Waitlist and Early Access sections use exclusive, premium copy ("Get early access", "First-generation access") rather than generic SaaS forms.

## 2. After Asset Arrival (The "Day 1" Test)
- [ ] **Frame Replacement:** Drop `frame-001.webp` through `frame-120.webp` into `/public/car-frames/`.
- [ ] **Calibration Tuning:** Adjust X/Y coordinates in `calibration.ts` so every UI marker attaches perfectly to the car's body panels.
- [ ] **Desktop Validation:** Scrub the page slowly. Ensure the 3D car's rotation perfectly matches the narrative (e.g. Side profile exactly matches the Price Discovery scene).
- [ ] **Mobile Validation:** Test on iOS (Safari) and Android (Chrome). Verify that decoding 120 WebP frames does not crash Safari's strict memory limits.

## 3. Final Acceptance Criteria
The experience passes only if:
- [ ] **First Impression:** User understands the product within 10 seconds of reading "Before buying a car, what you can't see is more important."
- [ ] **Visual Hierarchy:** The car remains the protagonist. UI elements feel like a HUD attached to the vehicle, not an overlay ignoring the car.
- [ ] **Scroll Feel:** Scroll feels intentional, heavy, and cinematic.
- [ ] **Rotation Sync:** The vehicle rotation matches the text exactly. We do not talk about the rear bumper while looking at the headlights.
- [ ] **Believability:** The AI inspection feels like a real, intelligent diagnostic tool.
- [ ] **Conversion:** The user naturally reaches the Early Access section feeling desire, not pressure.
- [ ] **Purity:** No part of the site feels like an AI-generated template or a generic SaaS landing page.
