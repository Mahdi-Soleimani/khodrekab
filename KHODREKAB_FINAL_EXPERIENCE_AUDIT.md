# Carno Final Experience Audit

## 1. Current Implementation Analysis
The current architecture successfully implements a scroll-driven, single-canvas experience using GSAP ScrollTrigger and a Next.js frontend. The sequence flows smoothly from Scene 01 to Scene 06, mapped over a 600vh scroll container. The visual identity successfully uses a "Light Premium" palette (white background, precise typography, #E31C3D red accents).

## 2. Vision Mismatch List
- **Scroll Affordance:** Scene 01 lacks a visual cue (e.g., a subtle scroll indicator) to invite the user to begin the scroll journey. 
- **Mobile Experience Gap:** Floating words in Scene 02 and inspection markers in Scene 05 are currently hidden on mobile (`hidden md:block` and `hidden md:flex`). Given the user stated "Mobile is critical", hiding these narrative elements fundamentally breaks the cinematic story on mobile devices.

## 3. UX Issues
- **Mobile Composition:** Hiding elements on mobile instead of repositioning them removes the "inspecting the vehicle" feeling on smaller screens. 
- **Climax Flow:** The transition from Scene 06 (Product Reveal) to the Waitlist form feels somewhat disconnected because the cinematic canvas unpins abruptly. The Waitlist section needs to feel like the true climax of the sequence.

## 4. Motion Issues
- **Linear Interpolations:** The manual progress calculations (e.g., `Math.min(progress / 0.15, 1)`) result in linear animations. While `scrub: 1` smooths the scroll, incorporating simple easing (e.g., cubic ease-out) mathematically into the transforms will elevate the "premium" feel.
- **Depth in Floating Elements:** The floating words in Scene 02 are flat. Adding scale or slight blur variations based on their "z-depth" would enhance the spatial composition.

## 5. Visual Issues
- **Mobile Typography Overlap:** When enabling the hidden elements for mobile, there is a high risk that the text will overlap the central car silhouette. Absolute positions must be adjusted specifically for mobile viewports using responsive utility classes or CSS variables.

## 6. Priority Fixes
1. **P0 (Critical):** Fix Scene 02 and Scene 05 so that floating narrative elements (words and markers) are visible and correctly composed on mobile viewports.
2. **P1 (UX):** Add a subtle, premium scroll indicator to Scene 01.
3. **P2 (Motion):** Add subtle scale/depth to the floating words in Scene 02 to increase the cinematic, spatial quality.
4. **P3 (Flow):** Ensure the Waitlist form feels like the seamless climax to Scene 06.
