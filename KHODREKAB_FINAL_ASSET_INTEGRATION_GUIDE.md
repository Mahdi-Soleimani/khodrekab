# CARNO: FINAL ASSET INTEGRATION GUIDE

This document outlines the requirements and process for integrating the final photorealistic 120-frame vehicle sequence into the Carno pre-production environment.

## 1. Vehicle Render Requirements

To ensure a seamless, premium, and performant experience, the 3D output must adhere to the following specifications:

*   **Total Frames:** Exactly 120 frames.
*   **Format:** WebP (crucial for performance/quality ratio).
*   **Camera & Lighting:** Fixed camera position and fixed studio lighting throughout the sequence. The framing must remain identical across all 120 frames.
*   **Background:** Clean studio background (or transparent if utilizing CSS backgrounds).
*   **Aesthetics:** Realistic reflections and premium materials matching an AI vehicle inspection studio vibe.

## 2. Export Settings

Recommended settings for the final 3D render export:

*   **Resolution:** 1920x1080 (16:9 aspect ratio). The `CarCanvas` uses `object-fit: contain` logic to ensure the vehicle remains visible across viewport sizes.
*   **Compression:** WebP quality at 80-90% to balance visual fidelity with loading speed.
*   **Naming Convention:** `frame-001.webp` through `frame-120.webp` (padded with zeros).

## 3. Vehicle Rotation Mapping (Scroll to Rotation)

The GSAP ScrollTrigger maps the user's scroll progress (0% to 100%) to the 120 frames. The 3D artist must align the vehicle's rotation to the following narrative milestones:

*   **0% Scroll (Frame 1):** Vehicle hero front 3/4 view (Arrival scene)
*   **20% Scroll (Frame 24):** Front-side transition (Curiosity scene - Paint & Body)
*   **40% Scroll (Frame 48):** Side profile (Price Discovery scene)
*   **60% Scroll (Frame 72):** Rear 3/4 view (Opportunity scene - Scoring)
*   **80% Scroll (Frame 96):** Inspection angle (Hidden Risk scene - Chassis/Replacements)
*   **100% Scroll (Frame 120):** Return to premium hero angle (Product Reveal & CTA)

*Note: The narrative text on screen will match these angles. The user should never see text explaining one area while the vehicle shows another unrelated angle.*

## 4. Integration Steps

Once the assets are rendered and exported:

1.  **Replace Assets:** Drop the 120 WebP files into the `/public/car-frames/` directory, overwriting any existing placeholders (from `frame-001.webp` to `frame-120.webp`).
2.  **Calibrate Annotations:** Open `src/components/cinematic/calibration.ts`. Adjust the `top`, `left`, `right`, and `lineH` values to perfectly align the UI markers with the physical geometry of the new 3D vehicle.
3.  **Build:** Run `npm run build` (or `npm run dev` for testing).
4.  **Validate:** Test the experience on:
    *   Desktop (Chrome, Safari)
    *   Mobile (iPhone class, Android mid-range)
    *   Check scroll performance, first content load, and visual alignment.
