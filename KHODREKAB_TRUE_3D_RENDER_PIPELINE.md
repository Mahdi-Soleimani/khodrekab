# CARNO: TRUE 3D RENDER PIPELINE SPECIFICATION

## 1. Blender Scene Setup
**Environment:**
- Unit System: Metric (Meters)
- Vehicle positioning: 3D Cursor at `(0, 0, 0)`. The vehicle pivot point MUST be exactly at the center of the chassis, ground level.

**Animation Rigging (The Rotation):**
- Create an Empty (Null object) at `(0, 0, 0)`.
- Parent all vehicle geometry to this Empty.
- Keyframe Z-Axis Rotation on the Empty:
  - Frame 1: Z = 0°
  - Frame 121: Z = -360° (Using Linear interpolation. Render frames 1-120 to achieve a perfect seamless loop returning to the start on frame 1).
- Set keyframe interpolation to **Linear** (No ease-in/ease-out).

## 2. Camera Settings
**Lock Status:** Absolute Lock (No animation on camera)
- **Type:** Perspective
- **Focal Length:** 50mm (Minimal perspective distortion, grounded realistic look).
- **Sensor Size:** 36mm (Full Frame).
- **Positioning:** Fixed slightly above the beltline, pointing down slightly at the center of the vehicle.
- **Composition:** Ensure the vehicle stays fully within the 1920x1080 frame at all times during the 360-degree rotation. No cropping of the bumpers at the maximum width points.

## 3. Lighting Setup
**Philosophy:** Premium Studio Environment (Apple/Porsche aesthetic).
- **World Background:** Color: `#FAFAFA`, Strength: 0.8.
- **Key Light (Overhead Softbox):** Large Area Light positioned top-front-center. Illuminates the roofline, hood, and shoulder lines.
- **Fill Lights (Side Reflectors):** Area lights on left and right, acting as bounce cards to trace the side profile geometry without overpowering the key light.
- **Shadow Catcher:** A plane at `Z=0` with a Shadow Catcher material. This must render an alpha shadow that seamlessly blends into the frontend's CSS `#FAFAFA` background.

## 4. Material Requirements
- **Paint (Clearcoat):** High-gloss metallic silver. Use principled BSDF with high metallic value, medium-low roughness, and a clearcoat layer (Clearcoat: 1.0, Roughness: 0.05).
- **Glass:** Highly transmissive, dark tint, physically correct IOR (1.45). Must reflect the softbox cleanly without noise.
- **Tires/Rubber:** Matte dark grey/black (Roughness: 0.8). Avoid deep blacks to maintain detail.
- **Exclusion:** Zero logos, zero brand badges.

## 5. Render Settings
- **Render Engine:** Cycles
- **Device:** GPU Compute
- **Sampling:** 
  - Render: 512 samples
  - Denoiser: OpenImageDenoise (Albedo + Normal)
- **Resolution:** 1920 x 1080 (16:9)
- **Frame Rate:** 24 fps (Arbitrary for scroll sequence, but standard).
- **Output Properties:** 
  - File Format: PNG or TIFF (Lossless, RGBA). WebP conversion handled post-render to ensure maximum quality control.
  - Color Space: sRGB.

## 6. Export Automation Script (Blender Python)
This script automates the rendering and converts the output to high-quality WebP directly from Blender.

```python
import bpy
import os
import subprocess

# --- Configuration ---
OUTPUT_DIR = "/path/to/carno_project/public/car-frames"
START_FRAME = 1
END_FRAME = 120
RESOLUTION_X = 1920
RESOLUTION_Y = 1080
# ---------------------

def setup_render():
    scene = bpy.context.scene
    scene.render.resolution_x = RESOLUTION_X
    scene.render.resolution_y = RESOLUTION_Y
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

def render_and_convert():
    scene = bpy.context.scene
    
    for frame in range(START_FRAME, END_FRAME + 1):
        scene.frame_set(frame)
        
        # Temp PNG path
        png_path = os.path.join(OUTPUT_DIR, f"temp_{frame:03d}.png")
        scene.render.filepath = png_path
        
        # Render frame
        print(f"Rendering Frame {frame}...")
        bpy.ops.render.render(write_still=True)
        
        # Convert to WebP using cwebp (requires WebP tools installed on system)
        webp_filename = f"frame-{frame:03d}.webp"
        webp_path = os.path.join(OUTPUT_DIR, webp_filename)
        
        print(f"Converting Frame {frame} to WebP...")
        subprocess.run(["cwebp", "-q", "85", png_path, "-o", webp_path], check=True)
        
        # Cleanup temp PNG
        os.remove(png_path)
        
    print("Render and Conversion Complete.")

if __name__ == "__main__":
    setup_render()
    render_and_convert()
```

## 7. QA Checklist & Frame Mapping
Before delivering the sequence to the engineering team, verify:

**Narrative Alignment:**
- [ ] **Frame 001:** Front 3/4 hero angle.
- [ ] **Frame 048:** Side profile (pure perpendicular to camera).
- [ ] **Frame 072:** Rear 3/4 view.
- [ ] **Frame 120:** Return to exact start position (Front 3/4) minus 1 degree, creating a perfect loop with Frame 001.

**Technical QA:**
- [ ] **Geometry Stability:** No morphing or artifacts.
- [ ] **Lighting:** Reflections slide smoothly across the body lines; no light popping.
- [ ] **Shadow:** Floor shadow remains grounded, correctly masked, and visually identical in tone to the CSS background `#FAFAFA`.
- [ ] **Format:** Exact naming convention `frame-001.webp` through `frame-120.webp` is preserved.
