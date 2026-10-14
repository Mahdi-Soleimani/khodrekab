# CARNO CONVERSION VALIDATION

## 1. Scroll Storytelling Validation
- **Milestones (`CarStoryOverlay`):** The narrative is broken down into four distinct phases: "کشف زیبایی" (Discover), "فناوری فردا" (Technology), "قدرت بی‌نهایت" (Performance), and "آینده اینجاست" (Future).
- **Engine Isolation:** The UI overlay uses native GSAP `ScrollTrigger` bound directly to DOM references (`useRef`). It runs perfectly parallel to the `StoryScroller` engine bindings without introducing a single `useState` hook, preserving strict `Canvas` frame performance.
- **Scroll Sync:** Text opacities and transformations map directly to the 500vh scroll envelope, keeping the user in constant visual sync with the car's physical rotation.

## 2. CTA Architecture & Visibility
- **Placement:** The `CTASection` sits fixed at the bottom of the sticky hero area with a subtle gradient (`bg-gradient-to-t`) guaranteeing legibility over any car asset.
- **Interactions:** Both Primary ("شروع تجربه") and Secondary ("دریافت اطلاعات") buttons utilize hardware-accelerated CSS transitions for hover states, ensuring zero layout thrashing.
- **Analytics:** `car_cta_hover` and `car_cta_click` events are strictly captured via React synthetic events without polling or re-rendering. 

## 3. Trust Layer
- The `TrustSection` appears chronologically at the conclusion of the 3D scroll experience, acting as the bridge to standard page content.
- Reinforces core technology and value propositions (120 cinematic frames, interaction without video, mobile optimization).

## 4. Mobile Layout & Accessibility
- Overlays leverage standard Tailwind breakpoints (`md:text-6xl`, `max-w-lg`) to automatically adapt to portrait orientations.
- Buttons maintain generous padding (`py-4 px-10`) to comply with minimum touch-target sizing guidelines for Android and iOS.

## 5. Summary Status
**Pass / Production Ready.**
The conversion layer seamlessly integrates atop the Engine. The separation of concerns between DOM-based narrative rendering and Canvas-based physical rendering guarantees optimal FPS while achieving an Apple-caliber landing page flow.
