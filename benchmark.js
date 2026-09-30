const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const frames = ['001', '024', '048', '072', '096', '120'];
const sourceDir = path.join(__dirname, 'public/car-frames');

const desktopWidth = 1600;
const desktopQualities = [75, 80, 85, 90];

const mobileWidth = 960;
const mobileQualities = [70, 75, 80, 85];

async function runBenchmark() {
  const results = {
    desktop: {},
    mobile: {}
  };

  for (const quality of desktopQualities) results.desktop[quality] = { totalOrigSize: 0, totalNewSize: 0, items: [] };
  for (const quality of mobileQualities) results.mobile[quality] = { totalOrigSize: 0, totalNewSize: 0, items: [] };

  for (const frame of frames) {
    const filePath = path.join(sourceDir, `frame-${frame}.webp`);
    const origStat = fs.statSync(filePath);
    const origSize = origStat.size;

    // Desktop
    for (const quality of desktopQualities) {
      const buffer = await sharp(filePath)
        .resize({ width: desktopWidth })
        .webp({ quality, alphaQuality: quality })
        .toBuffer();
      
      const newSize = buffer.length;
      results.desktop[quality].totalOrigSize += origSize;
      results.desktop[quality].totalNewSize += newSize;
      results.desktop[quality].items.push({ frame, origSize, newSize, ratio: newSize / origSize });
    }

    // Mobile
    for (const quality of mobileQualities) {
      const buffer = await sharp(filePath)
        .resize({ width: mobileWidth })
        .webp({ quality, alphaQuality: quality })
        .toBuffer();
      
      const newSize = buffer.length;
      results.mobile[quality].totalOrigSize += origSize;
      results.mobile[quality].totalNewSize += newSize;
      results.mobile[quality].items.push({ frame, origSize, newSize, ratio: newSize / origSize });
    }
  }

  // Print results
  console.log("=== DESKTOP BENCHMARK (1600px) ===");
  for (const quality of desktopQualities) {
    const res = results.desktop[quality];
    const avgOrig = res.totalOrigSize / frames.length;
    const avgNew = res.totalNewSize / frames.length;
    const ratio = res.totalNewSize / res.totalOrigSize;
    const estTotal120 = avgNew * 120 / (1024 * 1024);
    console.log(`Quality ${quality}: Avg Size: ${(avgNew / 1024).toFixed(1)} KB | Ratio: ${(ratio * 100).toFixed(1)}% | Est. 120-Frame Total: ${estTotal120.toFixed(1)} MB`);
  }

  console.log("\n=== MOBILE BENCHMARK (960px) ===");
  for (const quality of mobileQualities) {
    const res = results.mobile[quality];
    const avgOrig = res.totalOrigSize / frames.length;
    const avgNew = res.totalNewSize / frames.length;
    const ratio = res.totalNewSize / res.totalOrigSize;
    const estTotal120 = avgNew * 120 / (1024 * 1024);
    console.log(`Quality ${quality}: Avg Size: ${(avgNew / 1024).toFixed(1)} KB | Ratio: ${(ratio * 100).toFixed(1)}% | Est. 120-Frame Total: ${estTotal120.toFixed(1)} MB`);
  }
}

runBenchmark().catch(console.error);
