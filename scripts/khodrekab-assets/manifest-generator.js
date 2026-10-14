const fs = require('fs');
const path = require('path');

const generateManifest = (version, frameCount, keyframes, defaultFrame, outputDir) => {
  const manifestPath = path.join(outputDir, 'manifest.json');
  
  const manifest = {
    version: version,
    frameCount: frameCount,
    defaultFrame: defaultFrame,
    keyframes: keyframes, // Derived from story config
    profiles: {
      desktop: {
        directory: "desktop",
        width: 1600,
        quality: 80
      },
      mobile: {
        directory: "mobile",
        width: 960,
        quality: 75
      }
    }
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`✅ Manifest generated successfully at: ${manifestPath}`);
  return manifest;
};

module.exports = { generateManifest };
