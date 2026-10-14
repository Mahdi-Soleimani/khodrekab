# CARNO: FINAL CGI HANDOFF & READINESS REVIEW

## Executive Summary
This document serves as the final, definitive handoff specification for the 3D CGI team. It synthesizes the technical requirements from the Blender pipeline, the Next.js integration guide, and the frontend calibration system. 

**WARNING: Ambiguity Identified & Resolved**
Before rendering begins, we must resolve two critical ambiguities found during the readiness review:
1. **Background Transparency vs. Baked Background:** The previous pipeline spec requested a `#FAFAFA` world background while also requesting `RGBA` format. This will bake the background into the image, rendering the Alpha channel useless and potentially creating a hard seam if the CSS background ever shifts from exactly `#FAFAFA`. 
   * **Resolution:** The Blender setting `Render Properties > Film > Transparent` MUST be enabled. The output must be true transparent `RGBA` with only the vehicle and the alpha-masked floor shadow visible.
2. **Annotation Alignment Blindspot:** The frontend `calibration.ts` relies on percentage-based viewport tracking (`top: '15%', left: '30%'`). If the 3D artist scales the vehicle arbitrarily in the 1920x1080 frame, the UI lines will miss the vehicle entirely.
   * **Resolution:** The artist must fill exactly 80% of the horizontal frame width with the vehicle at its widest angle (profile). This provides a predictable baseline for the frontend team to tune `calibration.ts`.

---

## 1. Final Instructions for 3D Artist
Your objective is to produce 120 photorealistic, perfectly stable frames of a premium unbranded fastback sedan rotating 360 degrees.
* You are rendering a physical product, not a cinematic animation.
* Precision, stability, and premium material quality (paint, glass) are your only priorities.
* Do not apply any post-processing depth-of-field, motion blur, or lens distortion. The image must be perfectly sharp from bumper to bumper.

## 2. Camera and Lighting Lock Requirements
**Camera:**
* **Absolutely locked.** Do not move the camera, focal length (50mm), or sensor size. 
* Only the vehicle geometry rotates (parented to a null object at `0,0,0`).
* Vehicle must occupy ~80% of the horizontal frame width at side profile to ensure space for frontend UI annotations.

**Lighting:**
* High-end studio setup. Large overhead softbox key light, side reflectors.
* **Absolutely locked.** The light rig does not rotate with the car. The highlights must slide across the metallic paint as the geometry turns.

## 3. Required Model Quality Standards
* **Geometry:** Zero pinching, zero non-manifold edges. Smooth normals across all body panels.
* **Paint:** Metallic silver, utilizing a proper clearcoat node (e.g., Principled BSDF with high clearcoat). 
* **Glass:** Deep tint, physically correct index of refraction.
* **Branding:** Strict zero-logo policy. Wheels, grill, and rear must be unbranded.

## 4. Blender Export Checklist
- [ ] `Render Properties > Film > Transparent` is **CHECKED**.
- [ ] Output format is `PNG` -> `RGBA` (Lossless).
- [ ] Frame rate is 24fps (arbitrary for scroll, but standard).
- [ ] Frame Range: 1 to 120 exactly.
- [ ] Shadow Catcher plane is active at `Z=0` and captures ambient occlusion/contact shadows cleanly into the Alpha channel.

## 5. Frame Naming Rules
The Next.js `useImageSequence` hook requires absolute string matching.
* Format: `frame-001.webp` through `frame-120.webp`.
* Zero-padding to 3 digits is **MANDATORY**. 
* The automated Python conversion script must output exactly these filenames.

## 6. Post-Render QA Process
Before delivering the `.webp` sequence to the engineering team, the CGI Lead must verify:
1. **The Loop Test:** Frame 1 and Frame 120 must create a near-perfect loop (Frame 120 should be Frame 1 minus 3 degrees of rotation).
2. **The Alpha Test:** Drop a frame over a bright red CSS background. Only the car and the soft black shadow should be visible. No white halos.
3. **The Morph Test:** Scrub rapidly through the frames. The geometry must remain 100% solid. Zero morphing or shape shifting.

## 7. Integration Steps into Next.js
Once the CGI team delivers the 120 WebP files:
1. Delete all placeholder/dummy files in `/public/car-frames/`.
2. Drop the new production `frame-001.webp` to `frame-120.webp` into `/public/car-frames/`.
3. Start the dev server (`npm run dev`).
4. **Calibration Sync:** Open `src/components/cinematic/calibration.ts`. 
5. Scroll to Scene 02 (Curiosity). Adjust the `top/left/right` percentages so the leader lines physically touch the new 3D geometry's paint and wheels. Repeat for Scenes 03, 04, and 05.
6. Push to production.
