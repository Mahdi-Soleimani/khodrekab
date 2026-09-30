# Carno Interaction Upgrade Audit

## 1. Current Cinematic Quality
The current landing page provides a robust foundation for a premium automotive experience. The GSAP ScrollTrigger architecture flawlessly scrubs through a 60-frame canvas sequence, and the text overlays fade smoothly in sync with the scroll progress. The aesthetic matches the intended "Light Premium" direction (white background, precise #111111 typography, #E31C3D accents). However, the interaction currently feels like two disconnected layers: a car rotating in the background, and text animating in the foreground.

## 2. Missing Automotive Behaviors
- **Disconnection from the Product:** The narrative overlays do not visually interact with or "attach" to the physical vehicle. The text floats independently of the car's changing geometry.
- **Generic Floating Words:** In Scene 02, the words (ظاهر, قیمت, etc.) float randomly. This feels abstract rather than resembling a professional automotive inspection.
- **Lack of Spatial Connection:** In Scene 03 and Scene 04, data points (Market Value, Opportunity Score) appear to the side rather than feeling integrated into the vehicle's spatial environment.
- **Absence of Scanning Lines:** A true high-end automotive presentation uses precise annotations (thin lines extending from physical car parts to labels) to ground the intelligence in the physical product.

## 3. Interaction Improvements Required
- **Scene 01 (Arrival):** Keep typography minimal. Ensure the hero angle dominates the viewport.
- **Scene 02 (Curiosity):** Replace abstract floating words with "automotive scanning" annotations. Thin lines should point toward the vehicle as it rotates towards the side profile.
- **Scene 03 (Price Discovery):** Integrate the price data closer to the vehicle profile, creating a relationship between the "physical asset" and its "market value".
- **Scene 04 (Opportunity):** Refine the HUD score to feel locked to the rear 3/4 perspective of the car.
- **Scene 05 (Hidden Risks):** Upgrade the inspection markers to feel like professional telemetry (pointing specifically to body panels, paint, etc.) rather than simple dots.
- **Scene 06 (Product Reveal):** Enhance the disappearance of UI as the car returns to the hero angle, creating a clean psychological transition to the Waitlist climax.
