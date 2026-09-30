# Carno Manifest Schema

Frontend will fetch and parse this contract dynamically. Nothing should be hardcoded regarding asset dimensions, frame counts, or file paths.

## Schema Definition (`manifest.json`)

```json
{
  "version": "v1",
  "frames": 120,
  "basePath": "/car-frames/v1",
  "extension": "webp",
  "profiles": {
    "desktop": {
      "width": 1600,
      "quality": 80,
      "estimatedSizeMB": 9.8,
      "directory": "desktop"
    },
    "mobile": {
      "width": 960,
      "quality": 75,
      "estimatedSizeMB": 4.0,
      "directory": "mobile"
    }
  },
  "loadingStrategy": {
    "priorities": [
      {
        "name": "hero",
        "frames": [1]
      },
      {
        "name": "keyframes",
        "frames": [30, 60, 90, 120]
      },
      {
        "name": "secondary_keyframes",
        "frames": [15, 45, 75, 105]
      }
    ]
  }
}
```
