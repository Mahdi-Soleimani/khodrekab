# Carno Interaction Upgrade Report

## 1. Changed Files
- `src/components/cinematic/scenes/Scene02_Curiosity.tsx`
- `src/components/cinematic/scenes/Scene03_PriceDiscovery.tsx`
- `src/components/cinematic/scenes/Scene04_Opportunity.tsx`

## 2. Interaction Improvements
- **Scene 02 (Curiosity):** The abstract floating words have been entirely removed. In their place, precise automotive telemetry annotations (`بررسی رنگ و بدنه`, `تحلیل قطعات تعویضی`, `سوابق تصادف`) now appear. These annotations feature thin leader lines that point directly to the car's body as it rotates into a side profile, creating a professional vehicle inspection aesthetic rather than a generic text overlay.
- **Scene 03 (Price Discovery):** The market value and ad price data are no longer disconnected blocks of text on the side. They have been visually tethered to the vehicle's side profile using precise leader lines (colored according to the data point, e.g., green for market value). This physically grounds the financial data to the asset being evaluated.
- **Scene 04 (Opportunity):** The large "Opportunity Score" HUD has been moved from the center of the screen to the side and connected via a leader line to the rear three-quarter view of the vehicle. It now acts as a professional appraisal stamp attached to the rear of the car, keeping the vehicle as the primary visual focus.
- **Scene 05 (Hidden Risk):** Retained its high-end scanning markers, which precisely point out body/paint inspection locations on the car surface.
- **Scene 06 (Product Reveal):** Continues to seamlessly fade out all UI as the car returns to the front hero angle, setting up the psychological transition to the waitlist climax below.

## 3. Remaining Limitations
- **Responsive Positioning:** While the annotations and leader lines are designed with responsive gaps and flex directions, the precise absolute positioning (`top`, `left`) of the inspection markers and leader lines will need a final adjustment pass once the final 3D car asset sequence is integrated. The exact shape and dimensions of the car in the 16:9 canvas might cause lines to point slightly off-target until calibrated.

## 4. Final Asset Requirements
- The front-end cinematic sequence is now fully upgraded to a premium automotive product experience. The sole remaining requirement is the integration of the 120-frame photorealistic 3D image sequence in `/public/car-frames/` as specified in `CARNO_CAR_ASSET_SPEC.md`. No further code architecture changes are required.
