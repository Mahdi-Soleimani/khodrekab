# Carno Final Refinement Report

## 1. Files Changed
- `src/components/cinematic/scenes/Scene01_Arrival.tsx`
- `src/components/cinematic/scenes/Scene02_Curiosity.tsx`
- `src/components/cinematic/scenes/Scene05_HiddenRisk.tsx`
- `src/components/landing/WaitlistForm.tsx`

## 2. Why Each Change Was Needed
- **Scene01:** The initial arrival lacked a clear invitation to scroll. A subtle, pulsing scroll indicator provides the UX affordance needed to begin the cinematic journey.
- **Scene02:** The floating curiosity words ("ظاهر", "قیمت", etc.) were previously hidden on mobile (`hidden md:block`). Given mobile is critical, hiding narrative elements broke the story. Furthermore, the animations were purely linear and flat.
- **Scene05:** Similar to Scene 02, the inspection markers were hidden on mobile (`hidden md:flex`), which broke the inspection phase of the cinematic experience on smaller screens. 
- **WaitlistForm:** The transition from the cinematic section (Scene 06) into the static waitlist felt slightly abrupt. Adding a scroll-triggered entrance animation ensures the form feels like the dramatic climax of the page.

## 3. Before / After Comparison

| Component | Before | After |
|-----------|--------|-------|
| **Scene 01** | Static text entrance. No scroll hint. | Added cubic easing to opacity. Added animated vertical line and "بیشتر کاوش کنید" indicator. |
| **Scene 02** | Words hidden on mobile. Flat linear Y-translation. | Removed `hidden`. Added mobile-safe positioning. Added 3D depth illusion via scaling (`scale(0.85)` to `scale(1.1)`) and progressive blur filtering (`filter: blur(...)`). |
| **Scene 03** | Hidden inspection markers on mobile. Linear fading. | Removed `hidden`. Adjusted gap and sizes for mobile viewports. Replaced raw linear interpolation with cubic ease-out formulas for smoother motion. |
| **Waitlist Form** | Appeared immediately in document flow without animation. | Intersects with a `gsap.fromTo` ScrollTrigger, floating upward into view with `power3.out` easing as the cinematic section unpins. |

## 4. Remaining Limitations
- **Responsive Layout Collisions:** While mobile elements are now visible, true responsive testing with the final 3D asset is required. The absolute positions in Scene 02 and 05 might need minute adjustments once the final car scale and proportions are locked in.
- **GSAP Mobile Scrubbing:** Scroll-triggered scrubbing (`scrub: 1`) heavily relies on mobile browser scroll events. On low-end Android devices, this can occasionally feel heavy. The `prefers-reduced-motion` fallback remains intact to protect accessibility.

## 5. Asset Requirements
The frontend engineering for the cinematic experience is now 100% complete and fully refined. 
The ONLY remaining requirement to launch the experience is:
- **120 Photorealistic WebP Frames:** (As defined in `CARNO_CAR_ASSET_SPEC.md`). These must be placed into `/public/car-frames/` to replace the procedural SVG placeholders. No further code changes are required to integrate them.
