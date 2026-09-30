const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, 'scripts/carno-assets/raw/v1');

if (!fs.existsSync(RAW_DIR)) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}

async function createMocks() {
  console.log('Generating 120 mock frames...');
  for (let i = 1; i <= 120; i++) {
    const frameName = `frame_${String(i).padStart(3, '0')}.png`;
    await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 4,
        background: { r: 0, g: i * 2 % 255, b: 0, alpha: 1 }
      }
    }).png().toFile(path.join(RAW_DIR, frameName));
  }
  console.log('Mock frames generated.');
}

createMocks();
