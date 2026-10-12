import { spawn } from 'node:child_process';

async function testCacheHeaders() {
  console.log('--- [Testing Next.js Cache-Control Headers on Production Server] ---');
  const port = 3019;
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => {
    // console.log('[server]', d.toString().trim());
  });
  child.stderr.on('data', (d) => {
    // console.error('[server err]', d.toString().trim());
  });

  // Wait for server to start
  const maxWaitMs = 15000;
  const start = Date.now();
  let online = false;

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/car-frames/v1/manifest.json`);
      if (res.status === 200) {
        online = true;
        break;
      }
    } catch {
      // wait
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!online) {
    child.kill('SIGTERM');
    throw new Error('Server did not become ready within timeout');
  }

  try {
    const urls = [
      '/car-frames/v1/manifest.json',
      '/car-frames/v1/desktop/frame-001.webp',
      '/car-frames/v1/mobile/frame-001.webp',
    ];

    for (const u of urls) {
      const res = await fetch(`http://127.0.0.1:${port}${u}`);
      console.log(`URL: ${u}`);
      console.log(`  Status: ${res.status}`);
      console.log(`  Cache-Control: ${res.headers.get('cache-control')}`);
      console.log(`  X-Content-Type-Options: ${res.headers.get('x-content-type-options')}`);
    }
  } finally {
    child.kill('SIGTERM');
  }
  console.log('\n--- Cache header verification finished ---');
}

testCacheHeaders().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
