const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'public', 'car-frames');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

for (let i = 1; i <= 60; i++) {
  const num = i.toString().padStart(3, '0');
  const angle = (i / 60) * 360;
  
  // Premium light studio environment — neutral off-white background
  // The car silhouette uses dark grey (#111) and red accent (#E31C3D)
  const svg = `<svg width="800" height="400" viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg${i}" cx="50%" cy="60%" r="60%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#F0F0F0"/>
    </radialGradient>
  </defs>
  <rect width="800" height="400" fill="url(#bg${i})" />
  <g transform="translate(400, 190) rotate(${angle})">
    <rect x="-160" y="-70" width="320" height="140" fill="#111111" rx="16" opacity="0.9" />
    <rect x="-140" y="-55" width="280" height="110" fill="#1a1a1a" rx="10" />
    <circle cx="110" cy="0" r="18" fill="#E31C3D" opacity="0.9" />
    <circle cx="-110" cy="0" r="18" fill="#E31C3D" opacity="0.6" />
    <rect x="-60" y="-40" width="120" height="30" fill="#333333" rx="4" opacity="0.5" />
  </g>
  <line x1="0" y1="320" x2="800" y2="320" stroke="#E5E5E5" stroke-width="1"/>
  <text x="400" y="360" font-family="system-ui, sans-serif" font-size="13" fill="#999999" text-anchor="middle" letter-spacing="3">FRAME ${num} — ${Math.round(angle)}°</text>
</svg>`;

  fs.writeFileSync(path.join(dir, `frame-${num}.svg`), svg);
}

console.log('Created 60 light-mode placeholder SVG frames in public/car-frames/');
