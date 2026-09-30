# Carno Final Automotive 3D Asset Specification

This document provides the definitive specification for producing the photorealistic automotive image sequence that will serve as the core visual protagonist of the Carno landing page.

---

## 1. Vehicle Style & Identity

- **Design Profile:** Generic contemporary sedan, fastback, or compact executive vehicle, appropriate for the Iranian automotive market.
- **Brand Identity:** STRICTLY unbranded. No visible manufacturer logos, no recognizable grille branding, and no copyrighted visual signatures. License plates must remain blank or carry generic placeholder framing.
- **Aesthetic:** Premium, trustworthy, and expensive. It should feel like a high-end product demonstration rather than a sci-fi or overly futuristic concept car.
- **Materials:** High-quality metallic body paint, realistic automotive glass with accurate refractive properties, realistic alloy wheels, detailed tire rubber, and physically believable lighting housings.

---

## 2. Camera Specification

- **Setup:** Fixed camera 360° turntable. The vehicle rotates on its vertical (Y) axis while the camera remains entirely stationary.
- **Movement:** NO camera orbit, NO zoom, NO shake, and NO translation. 
- **Framing & Composition:** Fixed focal length, fixed distance, fixed height, and fixed target. The composition must remain mathematically identical across every frame, with the vehicle remaining perfectly centered.

---

## 3. Lighting Specification

- **Environment:** Premium automotive studio lighting setup.
- **Rigging:** 
  - Large soft overhead key light (softbox style) to define the vehicle's shoulder line.
  - Controlled fill lights to reveal panel details.
  - Subtle rim lighting to separate the vehicle from the background.
- **Reflections:** Soft floor reflections and controlled highlight reflections on the clearcoat and glass.
- **Consistency:** The lighting rig is static relative to the *camera*, meaning reflections will naturally travel across the car body as it rotates. No dramatic intensity or color shifts between frames.
- **Contrast:** Must remain clearly readable against a light website background.

---

## 4. Background Specification

- **Environment:** Very light neutral studio environment.
- **Color:** Preferred `#FAFAFA` (off-white), or a clean transparent background (alpha channel) if the rendering pipeline allows for high-quality soft shadows and reflections to be composited via alpha.
- **Consistency:** The background is completely static. No environment changes, no horizon shifts.

---

## 5. Output Format & Resolution

- **Primary Format:** WebP (for superior compression and quality).
- **Alternative Format:** JPG (if transparency is not used and WebP is unavailable).
- **Resolution:** 
  - Target ~1600px to 2000px on the longest edge.
  - Must provide sufficient visual fidelity for large desktop viewports and retina displays while remaining optimized. Responsive scaling down for mobile devices is handled by the frontend CSS/Canvas mapping.

---

## 6. Frame Sequence & Naming Convention

- **Total Frames:** 120 frames representing a full 0° to 360° rotation.
- **Naming Convention:** 
  - `frame-001.webp`
  - `frame-002.webp`
  - ...
  - `frame-120.webp`
- **Requirements:** Strictly sequential. No gaps, no duplicated frames, and zero variations in the filename format.

---

## 7. Rendering & Integration Workflow

- **Viewpoint Mapping (Scroll Story):**
  - **Scene 01 (Arrival):** Hero / front three-quarter view.
  - **Scene 02 (Curiosity):** Front-side transitioning to profile view.
  - **Scene 03 (Price Discovery):** Side profile revealing market context.
  - **Scene 04 (Opportunity):** Continuing rotation to rear three-quarter.
  - **Scene 05 (Hidden Risk):** Rear inspection viewpoint.
  - **Scene 06 (Product Reveal):** Completing rotation back toward the hero front three-quarter.
- **Clean Output:** The image frames must contain ONLY the vehicle, floor shadow, and background. All UI, text, numbers, red markers, and HUD elements are rendered dynamically by the frontend application. Do not bake any UI into the renders.
- **Integration Path:** 
  - Once rendered, simply drop the 120 `.webp` files into the `/public/car-frames/` directory of the Carno project.
  - Update `totalFrames=120` in the `<CarCanvas />` props and ensure the `getFramePath` extension points to `.webp`.

---

## 8. Quality Assurance Checklist

Before finalizing the sequence and exporting, the 3D artist/renderer must compile the frames into a test MP4 or GIF and verify:

1. [ ] **Consistency:** Does the car look like one identical physical vehicle throughout?
2. [ ] **Rotation:** Does it appear to physically rotate on a perfect axis without wobble?
3. [ ] **Perspective:** Does perspective change naturally as surfaces turn toward/away from the camera?
4. [ ] **Reflections:** Do reflections behave consistently and travel accurately across the rotating surface?
5. [ ] **Shadows:** Does the floor shadow remain grounded and consistent relative to the rotating vehicle?
6. [ ] **Stability:** Is there zero frame-to-frame morphing, jumping, or scaling?
7. [ ] **Loop Quality:** Do Frame 120 and Frame 001 transition seamlessly without any visible jump in lighting, camera, or body position?
8. [ ] **AI Artifacts:** Are there absolutely NO independent AI-generated hallucination artifacts between frames? (Must be a true 3D render).

---
*NO CODE CHANGES WERE MADE.*
