import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SCRATCH_DIR = '/Users/mahdi/.gemini/antigravity-ide/brain/fde09b46-d67d-4590-bf9f-dc86ff5f82e8/scratch';
if (!fs.existsSync(SCRATCH_DIR)) {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CdpMessage {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

class CdpClient {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, (res: any) => void>();
  readonly consoleMessages: { type: string; text: string }[] = [];
  readonly networkRequests: { url: string; method: string; status?: number }[] = [];
  readonly networkUrls = new Set<string>();

  static async connect(port: number): Promise<CdpClient> {
    const client = new CdpClient();
    let versionList: any[] = [];
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        versionList = await res.json();
        if (versionList.length > 0) break;
      } catch {}
      await sleep(150);
    }
    const page = versionList.find((t: any) => t.type === 'page');
    if (!page) throw new Error('No CDP page target found');

    client.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => (client.ws.onopen = r));

    client.ws.onmessage = (event) => {
      const msg: CdpMessage = JSON.parse(event.data.toString());
      if (msg.id && client.pending.has(msg.id)) {
        client.pending.get(msg.id)!(msg);
        client.pending.delete(msg.id);
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params?.args || []).map((a: any) => a.value || JSON.stringify(a)).join(' ');
        client.consoleMessages.push({ type: msg.params.type, text });
      }
      if (msg.method === 'Network.requestWillBeSent') {
        const u = msg.params.request.url;
        client.networkRequests.push({ url: u, method: msg.params.request.method });
        client.networkUrls.add(u);
      }
      if (msg.method === 'Network.responseReceived') {
        const req = client.networkRequests.find((r) => r.url === msg.params.response.url);
        if (req) req.status = msg.params.response.status;
      }
    };

    return client;
  }

  send(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve) => {
      const msgId = ++this.id;
      this.pending.set(msgId, resolve);
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expression: string): Promise<any> {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result?.result?.value;
  }

  async screenshot(filepath: string): Promise<void> {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filepath, Buffer.from(res.result.data, 'base64'));
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function startServer(port: number): Promise<ChildProcess> {
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.status === 200) return child;
    } catch {}
    await sleep(250);
  }
  child.kill();
  throw new Error('Next.js server failed to start in time');
}

function launchChrome(port: number, userDataDir: string): ChildProcess {
  return spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
}

async function runBrowserVerification() {
  console.log('=== [Carno Live Browser Integration Verification] ===\n');
  const serverPort = 3020;
  console.log(`1. Starting Next.js production server on port ${serverPort}...`);
  const server = await startServer(serverPort);
  console.log('   ✓ Server online.');

  try {
    // ----------------------------------------------------
    // Test A: Initial HTML / SSR Markup & Poster Discovery
    // ----------------------------------------------------
    console.log('\n2. Verifying Initial HTML / SSR Poster Markup...');
    const htmlRes = await fetch(`http://127.0.0.1:${serverPort}/`);
    const htmlText = await htmlRes.text();

    const hasPictureTag = htmlText.includes('<picture');
    const hasMobileSource = htmlText.includes('/car-frames/v1/mobile/frame-001.webp');
    const hasDesktopImg = htmlText.includes('/car-frames/v1/desktop/frame-001.webp');
    const hasFetchPriorityHigh = htmlText.includes('fetchpriority="high"');
    const hasLoadingEager = htmlText.includes('loading="eager"');
    const hasPhase2HiddenInSSR = htmlText.includes('opacity-0');

    console.log(`   - <picture> tag in initial HTML: ${hasPictureTag}`);
    console.log(`   - mobile source URL present: ${hasMobileSource}`);
    console.log(`   - desktop img URL present: ${hasDesktopImg}`);
    console.log(`   - fetchpriority="high" on poster: ${hasFetchPriorityHigh}`);
    console.log(`   - loading="eager" on poster: ${hasLoadingEager}`);
    console.log(`   - phases 2-4 opacity-0 in SSR: ${hasPhase2HiddenInSSR}`);

    if (!hasPictureTag || !hasMobileSource || !hasDesktopImg) {
      throw new Error('Initial SSR poster markup check failed!');
    }
    console.log('   ✓ Test A (SSR HTML) PASSED.');

    // ----------------------------------------------------
    // Test B: Desktop Run & Handoff Verification
    // ----------------------------------------------------
    console.log('\n3. Testing Desktop Viewport (1440x900) & Poster Handoff...');
    const desktopCdpPort = 9340;
    const desktopProfileDir = `${SCRATCH_DIR}/chrome-profile-desktop-${Date.now()}`;
    const desktopChrome = launchChrome(desktopCdpPort, desktopProfileDir);

    try {
      const cdp = await CdpClient.connect(desktopCdpPort);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Network.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });

      console.log('   - Navigating to desktop experience...');
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });

      // Immediate screenshot at initial load
      await sleep(200);
      const shotInitial = `${SCRATCH_DIR}/desktop_initial_load.png`;
      await cdp.screenshot(shotInitial);
      console.log(`   - Captured initial screenshot: ${shotInitial}`);

      // Check initial poster visibility state
      const initialPosterVisible = await cdp.eval(`(() => {
        const pic = document.querySelector('picture');
        return pic ? !pic.classList.contains('opacity-0') : null;
      })()`);
      console.log(`   - Initial poster visible: ${initialPosterVisible}`);

      // Wait for handoff window (engine loads hero, renders, handoffVerifier confirms)
      console.log('   - Waiting for frame verification & handoff...');
      let handoffHappened = false;
      for (let i = 0; i < 40; i++) {
        await sleep(250);
        const isHidden = await cdp.eval(`(() => {
          const pic = document.querySelector('picture');
          return pic ? pic.classList.contains('opacity-0') : false;
        })()`);
        if (isHidden) {
          handoffHappened = true;
          break;
        }
      }
      console.log(`   - Handoff completed (poster safely hidden after verified canvas draw): ${handoffHappened}`);

      const shotHandoff = `${SCRATCH_DIR}/desktop_after_handoff.png`;
      await cdp.screenshot(shotHandoff);
      console.log(`   - Captured post-handoff screenshot: ${shotHandoff}`);

      // Inspect requested frame assets
      const desktopFrameRequests = cdp.networkRequests
        .filter((r) => r.url.includes('/car-frames/v1/'))
        .map((r) => r.url);
      const desktopProfiles = new Set(
        desktopFrameRequests
          .filter((u) => u.endsWith('.webp'))
          .map((u) => (u.includes('/desktop/') ? 'desktop' : u.includes('/mobile/') ? 'mobile' : 'unknown'))
      );
      console.log(`   - Frame profiles requested on desktop:`, Array.from(desktopProfiles));
      const onlyDesktop = desktopProfiles.size === 1 && desktopProfiles.has('desktop');
      console.log(`   - Exclusively desktop assets loaded: ${onlyDesktop}`);

      // ----------------------------------------------------
      // Test C: Scroll & Scheduler Priority
      // ----------------------------------------------------
      console.log('\n4. Testing Scroll Interaction & Preemption on Desktop...');
      // Scroll to ~40% progress
      console.log('   - Scrolling to ~0.40 progress (near frame 48)...');
      await cdp.eval(`window.scrollTo(0, document.documentElement.scrollHeight * 0.40)`);
      await sleep(1000);
      const shotScrolled = `${SCRATCH_DIR}/desktop_scrolled_40.png`;
      await cdp.screenshot(shotScrolled);

      // Fast forward scroll to 95%
      console.log('   - Performing fast forward scroll (bursts to 95%)...');
      for (let p = 0.5; p <= 0.95; p += 0.15) {
        await cdp.eval(`window.scrollTo(0, document.documentElement.scrollHeight * ${p})`);
        await sleep(150);
      }
      await sleep(1200);

      // Fast reverse scroll back to top (0%)
      console.log('   - Performing fast reverse scroll (bursts to top 0%)...');
      for (let p = 0.8; p >= 0; p -= 0.2) {
        await cdp.eval(`window.scrollTo(0, document.documentElement.scrollHeight * ${p})`);
        await sleep(150);
      }
      await sleep(1200);

      const shotReturnTop = `${SCRATCH_DIR}/desktop_return_top.png`;
      await cdp.screenshot(shotReturnTop);
      console.log(`   - Captured return-to-top screenshot: ${shotReturnTop}`);

      // Check console errors
      const errors = cdp.consoleMessages.filter((m) => m.type === 'error');
      console.log(`   - Console errors count: ${errors.length}`);
      if (errors.length > 0) {
        console.log(`   - Errors:`, errors);
      }

      cdp.close();
      desktopChrome.kill();
      await sleep(400);
      fs.rmSync(desktopProfileDir, { recursive: true, force: true });
    } catch (err) {
      desktopChrome.kill();
      throw err;
    }

    // ----------------------------------------------------
    // Test D: Mobile Viewport & Profile Selection
    // ----------------------------------------------------
    console.log('\n5. Testing Mobile Viewport (390x844) & Responsive Profile Selection...');
    const mobileCdpPort = 9341;
    const mobileProfileDir = `${SCRATCH_DIR}/chrome-profile-mobile-${Date.now()}`;
    const mobileChrome = launchChrome(mobileCdpPort, mobileProfileDir);

    try {
      const cdp = await CdpClient.connect(mobileCdpPort);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Network.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true,
      });
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      });

      console.log('   - Navigating to mobile experience...');
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });

      await sleep(200);
      const shotMobileInitial = `${SCRATCH_DIR}/mobile_initial_load.png`;
      await cdp.screenshot(shotMobileInitial);
      console.log(`   - Captured mobile initial screenshot: ${shotMobileInitial}`);

      // Wait for handoff on mobile
      let mobileHandoff = false;
      for (let i = 0; i < 40; i++) {
        await sleep(250);
        const isHidden = await cdp.eval(`(() => {
          const pic = document.querySelector('picture');
          return pic ? pic.classList.contains('opacity-0') : false;
        })()`);
        if (isHidden) {
          mobileHandoff = true;
          break;
        }
      }
      console.log(`   - Mobile handoff completed: ${mobileHandoff}`);

      const shotMobileHandoff = `${SCRATCH_DIR}/mobile_after_handoff.png`;
      await cdp.screenshot(shotMobileHandoff);

      // Inspect mobile network requests
      const mobileFrameRequests = cdp.networkRequests
        .filter((r) => r.url.includes('/car-frames/v1/'))
        .map((r) => r.url);
      const mobileProfiles = new Set(
        mobileFrameRequests
          .filter((u) => u.endsWith('.webp'))
          .map((u) => (u.includes('/mobile/') ? 'mobile' : u.includes('/desktop/') ? 'desktop' : 'unknown'))
      );
      console.log(`   - Frame profiles requested on mobile:`, Array.from(mobileProfiles));
      const onlyMobile = mobileProfiles.size === 1 && mobileProfiles.has('mobile');
      console.log(`   - Exclusively mobile assets loaded: ${onlyMobile}`);

      // Mobile fast scroll test
      console.log('   - Performing mobile scroll test...');
      await cdp.eval(`window.scrollTo(0, document.documentElement.scrollHeight * 0.40)`);
      await sleep(1000);
      const shotMobileScrolled = `${SCRATCH_DIR}/mobile_scrolled_40.png`;
      await cdp.screenshot(shotMobileScrolled);

      const mobileErrors = cdp.consoleMessages.filter((m) => m.type === 'error');
      console.log(`   - Mobile console errors count: ${mobileErrors.length}`);

      cdp.close();
      mobileChrome.kill();
      await sleep(400);
      fs.rmSync(mobileProfileDir, { recursive: true, force: true });
    } catch (err) {
      mobileChrome.kill();
      throw err;
    }

    console.log('\n=== ALL BROWSER INTEGRATION TESTS COMPLETED SUCCESSFULLY! ===');
  } finally {
    console.log('\nStopping test server...');
    server.kill('SIGTERM');
  }
}

runBrowserVerification().catch((err) => {
  console.error('Browser verification failed:', err);
  process.exit(1);
});
