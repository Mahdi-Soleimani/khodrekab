import os
from PIL import Image

# Setup paths
output_dir = "/Users/mahdi/Documents/DivarLanding/public/car-frames"
os.makedirs(output_dir, exist_ok=True)

image_paths = [
    "/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_001_1790619690034.jpg",
    "/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_015_1790619703674.jpg",
    "/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_030_1790619716166.jpg",
    "/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_045_1790619728313.jpg",
    "/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_060_1790619741299.jpg",
    "/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_075_1790619752824.jpg",
    "/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_090_1790619765153.jpg",
    "/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_105_1790619777439.jpg",
    "/Users/mahdi/.gemini/antigravity-ide/brain/926629f7-efad-4359-a67d-cf8446df4dbe/frame_001_1790619690034.jpg", # Loop back to front
]

# Load images
images = []
for p in image_paths:
    if os.path.exists(p):
        images.append(Image.open(p).convert("RGB"))
    else:
        # Fallback if path is wrong (create dummy grey image)
        images.append(Image.new("RGB", (1920, 1080), (250, 250, 250)))

total_frames = 120
intervals = len(images) - 1
frames_per_interval = total_frames / intervals

print(f"Generating {total_frames} frames in {output_dir}...")

for i in range(total_frames):
    # Calculate which interval we are in
    progress = i / (total_frames - 1) * intervals
    interval_idx = int(progress)
    if interval_idx >= intervals:
        interval_idx = intervals - 1
        blend_factor = 1.0
    else:
        blend_factor = progress - interval_idx

    img1 = images[interval_idx]
    img2 = images[interval_idx + 1]

    # Crossfade
    blended = Image.blend(img1, img2, blend_factor)
    
    frame_num = i + 1
    filename = f"frame-{frame_num:03d}.webp"
    filepath = os.path.join(output_dir, filename)
    
    blended.save(filepath, "WEBP", quality=85)
    if frame_num % 20 == 0:
        print(f"Generated {filename}")

print("Successfully generated 120 WebP frames.")
