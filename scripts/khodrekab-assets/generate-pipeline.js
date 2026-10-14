const fs = require('fs');
const path = require('path');
const { validateIntegrity, convertProfile } = require('./image-converter');
const { generateManifest } = require('./manifest-generator');

const VERSION = 'v1';
const RAW_DIR = path.join(__dirname, 'raw', VERSION);
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public', 'car-frames', VERSION);

// In a real scenario, this comes from KhodrekabStory config or similar
// Hardcoding the config input simulation here as per rule: "must come from story config"
const STORY_CONFIG = {
  defaultFrame: 1,
  keyframes: [1, 30, 60, 90, 120]
};

const runPipeline = async () => {
  console.log(`\n🚀 Starting Khodrekab Asset Pipeline [${VERSION}]\n`);

  if (!fs.existsSync(RAW_DIR)) {
    console.error(`❌ Raw directory not found: ${RAW_DIR}`);
    console.log(`Please place raw image sequences in: ${RAW_DIR}`);
    process.exit(1);
  }

  // 1. Read files
  const files = fs.readdirSync(RAW_DIR).filter(f => /\.(png|jpe?g)$/i.test(f));
  
  if (files.length === 0) {
    console.error(`❌ No images found in ${RAW_DIR}`);
    process.exit(1);
  }

  // 2. Validate Integrity (Missing/Duplicates)
  const { count } = validateIntegrity(files);

  // 3. Process Desktop Profile
  const desktopDir = path.join(PUBLIC_DIR, 'desktop');
  await convertProfile(RAW_DIR, desktopDir, files, 1600, 80);

  // 4. Process Mobile Profile
  const mobileDir = path.join(PUBLIC_DIR, 'mobile');
  await convertProfile(RAW_DIR, mobileDir, files, 960, 75);

  // 5. Generate Manifest
  generateManifest(
    VERSION, 
    count, 
    STORY_CONFIG.keyframes, 
    STORY_CONFIG.defaultFrame, 
    PUBLIC_DIR
  );

  console.log(`\n🎉 Pipeline completed successfully!`);
};

runPipeline().catch(err => {
  console.error("❌ Pipeline failed:", err);
  process.exit(1);
});
