const fs = require('fs');
const path = require('path');

// Dynamically import sharp to avoid runtime errors if not installed globally yet
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error("❌ 'sharp' is required. Run 'npm install -D sharp' or run this script via npx.");
  process.exit(1);
}

const extractFrameNumber = (filename) => {
  const match = filename.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
};

const validateIntegrity = (files) => {
  const frameNumbers = files.map(extractFrameNumber).filter(n => n !== null);
  
  if (frameNumbers.length === 0) {
    console.error("❌ No valid frame files found in raw directory.");
    process.exit(1);
  }

  // Check for duplicates
  const uniqueFrames = new Set();
  const duplicates = [];
  frameNumbers.forEach(n => {
    if (uniqueFrames.has(n)) duplicates.push(n);
    uniqueFrames.add(n);
  });

  if (duplicates.length > 0) {
    console.error(`❌ Duplicated frames detected: ${duplicates.join(', ')}`);
    process.exit(1);
  }

  // Check for gaps
  const minFrame = Math.min(...frameNumbers);
  const maxFrame = Math.max(...frameNumbers);
  const missing = [];
  
  for (let i = minFrame; i <= maxFrame; i++) {
    if (!uniqueFrames.has(i)) {
      missing.push(i);
    }
  }

  if (missing.length > 0) {
    console.error(`❌ Missing frames detected: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(`✅ Asset integrity validated: ${frameNumbers.length} sequential frames found (${minFrame} to ${maxFrame}).`);
  return { minFrame, maxFrame, count: frameNumbers.length };
};

const convertProfile = async (rawDir, outputDir, files, width, quality) => {
  console.log(`\n⚙️  Processing profile to: ${outputDir} (Width: ${width}px, Quality: ${quality}%)`);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const frameNum = extractFrameNumber(file);
    if (frameNum === null) continue;

    const paddedFrame = String(frameNum).padStart(3, '0');
    const inputPath = path.join(rawDir, file);
    const outputPath = path.join(outputDir, `frame-${paddedFrame}.webp`);

    await sharp(inputPath)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality, effort: 6 }) // Deterministic and highly optimized
      .toFile(outputPath);
      
    if ((i + 1) % 20 === 0) {
      console.log(`  ... processed ${i + 1}/${files.length} frames`);
    }
  }
  console.log(`✅ Profile processing complete.`);
};

module.exports = { validateIntegrity, convertProfile };
