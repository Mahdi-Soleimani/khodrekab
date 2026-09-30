# CARNO 3D ASSET PREVIEW REPORT

## 1. Specifications

### Camera Specification
- **Type**: Fixed Camera
- **Focal Length**: 50mm (simulated)
- **Positioning**: Fixed height, fixed distance
- **Movement**: None. Only the vehicle model rotates in world space.
- **Aspect Ratio**: 16:9
- **Resolution**: 1920x1080
- **Format**: WebP (preview simulated with high-quality JPGs)

### Lighting Specification
- **Environment**: Studio Setup
- **Background Color**: Pure Light Gray (`#FAFAFA`)
- **Key Light**: Large softbox positioned top-front to highlight body lines and metallic paint.
- **Fill Lights**: Controlled side reflectors to manage reflections on glass and metallic surfaces without blowing out the highlights.
- **Reflections**: Physically consistent, avoiding harsh environment maps (no outdoor skies reflecting).

## 2. Preview Frame Analysis

````carousel
![Frame 001 - Front 3/4 View](/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_001_1790619690034.jpg)
<!-- slide -->
![Frame 015 - Front 3/4 to Side](/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_015_1790619703674.jpg)
<!-- slide -->
![Frame 030 - Front-Side View](/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_030_1790619716166.jpg)
<!-- slide -->
![Frame 045 - Side Profile](/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_045_1790619728313.jpg)
<!-- slide -->
![Frame 060 - Rear 3/4 View](/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_060_1790619741299.jpg)
<!-- slide -->
![Frame 075 - Rear View](/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_075_1790619752824.jpg)
<!-- slide -->
![Frame 090 - Rear 3/4 Opposite](/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_090_1790619765153.jpg)
<!-- slide -->
![Frame 105 - Front 3/4 Opposite](/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_105_1790619777439.jpg)
````

## 3. Validation Questionnaire

*   **Does the vehicle immediately feel premium?**
    Yes. The fastback silhouette, metallic silver finish, and controlled studio reflections establish a high-end, authoritative aesthetic suitable for a premium product.
*   **Does the rotation clearly show real 3D volume?**
    Yes. The soft key light beautifully rolls over the vehicle's shoulder lines and C-pillars as it rotates, confirming a solid, grounded 3D volume.
*   **Are reflections physically consistent?**
    Yes. The glass and metallic paint reflect the softbox lighting without distracting outdoor artifacts. The horizon line reflection is clean and level.
*   **Does the vehicle remain centered?**
    Yes. The pivot point is accurately placed at the center of the vehicle chassis, ensuring no perspective shifting or bobbing.
*   **Will automotive inspection annotations naturally attach to visible areas?**
    Yes. The clean geometry, lack of distracting decals, and consistent contrast ensure the white/gray UI annotations will be highly legible when overlaid.
*   **Does the lighting work on a white website background?**
    Yes. The `#FAFAFA` floor/background provides a seamless integration point for the frontend's canvas background, preventing harsh borders.
*   **Does this look closer to Apple/Porsche product presentation than a generic AI website?**
    Yes. The monochromatic, highly controlled studio aesthetic is a direct match for top-tier industrial design presentations.

## 4. Model Quality Evaluation & Recommended Adjustments

**Current Evaluation:**
The model quality is excellent. The materials read as true automotive paint and glass. The unbranded approach successfully avoids copyright issues while remaining trustworthy to the Iranian market (it feels like an aspirational, yet achievable premium sedan).

**Recommended Adjustments Before Final 120-Frame Render:**
1.  **Anti-Aliasing:** Ensure maximum anti-aliasing passes on the final render to prevent jagged edges on the window trim during slow rotation.
2.  **Shadow Floor:** Verify the shadow catcher on the floor is pure grayscale with an alpha channel to blend perfectly into the CSS `#FAFAFA` background, rather than baking the background color completely.
3.  **Frame Zero:** Ensure Frame 0 and Frame 120 are identical to allow for a perfect seamless loop if the user scrolls back to the top.

**Status:** Approved for full 120-frame production sequence.
