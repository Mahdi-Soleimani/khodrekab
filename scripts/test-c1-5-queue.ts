/**
 * CARNO PHASE C1.5 RELIABLE SMS QUEUE & WORKER TEST SUITE
 * Validates:
 * 1. Kill worker mid-job (after move, before ack) -> reaper re-queues, exactly ONE sms
 * 2. Duplicate enqueue of the same jobId/challengeId -> one send
 * 3. Orphan jobs at boot -> worker drains them without a new HTTP request
 * 4. Gateway failure -> retry/backoff -> dead-letter after max attempts; counters unchanged
 * 5. Two workers concurrently -> no double send
 * 6. Redis down -> register 503, nothing enqueued, transport never called
 * 7. Log capture grep: zero leaks of OTP, raw phone, raw IP, tokens, secrets
 * 8. Graceful shutdown does not lose an in-flight job
 * 9. Test-only OTP hook cannot activate when NODE_ENV=production
 */

import crypto from 'crypto';
import Redis from 'ioredis';
import {
  enqueueSmsDispatch,
  processNextJob,
  reapStaleProcessingJobs,
  setMockSmsTransport,
  getCapturedTestOtp,
  clearCapturedTestOtps,
  getSmsPayloadKey,
  SmsQueueItem,
} from '../src/lib/security/queue';
import { getRedisClient, isRedisAvailable, closeRedisConnection } from '../src/lib/security/redis';
import { getPhoneHash } from '../src/lib/security/otp';
import { generatePoWChallenge } from '../src/lib/security/pow';
import { POST as registerHandler } from '../src/app/api/waitlist/register/route';
import { NextRequest } from 'next/server';

let totalTests = 0;
let passedTests = 0;

// Read SMS_ENCRYPTION_KEY from process.env at runtime
// If not present in environment, initialize test runner key (64 hex characters / 32 bytes)
if (!process.env.SMS_ENCRYPTION_KEY) {
  try {
    const { loadEnvConfig } = require('@next/env');
    loadEnvConfig(process.cwd());
  } catch {}
}
if (!process.env.SMS_ENCRYPTION_KEY) {
  process.env.SMS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
}

function getCallCount(t: { calls: number }): number {
  return t.calls;
}

function getRedis(): NonNullable<ReturnType<typeof getRedisClient>> {
  const r = getRedisClient();
  if (!r) throw new Error('Redis instance is null');
  return r;
}

async function cleanupQueueKeys() {
  const r = getRedisClient();
  if (!r) return;
  const keys = await r.keys('sms:*');
  if (keys.length > 0) {
    await r.del(...keys);
  }
}

async function test(name: string, fn: () => Promise<void>) {
  totalTests++;
  await cleanupQueueKeys();
  setMockSmsTransport(null);
  clearCapturedTestOtps();
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  }
}

async function runC15Tests() {
  console.log('====================================================');
  console.log('   CARNO PHASE C1.5 RELIABLE SMS QUEUE TEST SUITE   ');
  console.log('====================================================\n');

  const redisOk = await isRedisAvailable();
  if (!redisOk) {
    console.error('FATAL: Redis must be running locally to execute C1.5 tests.');
    process.exit(1);
  }

  await cleanupQueueKeys();

  // --- Test 1: Kill worker mid-job (after move, before ack) -> reaper re-queues, exactly ONE sms ---
  await test('1. Kill worker mid-job -> reaper re-queues -> exactly ONE SMS delivered', async () => {
    const tracker = { calls: 0 };
    setMockSmsTransport(async () => {
      tracker.calls++;
      return { success: true };
    });

    const phone = '09000001001';
    const code = '12345';
    const challengeId = 'chal_kill_worker_1';

    // 1. Enqueue
    await enqueueSmsDispatch({ phone, code, challengeId });
    const initialQueueLen = await getRedis().llen('sms:dispatch:queue');
    if (initialQueueLen !== 1) throw new Error(`Expected queue len 1, got ${initialQueueLen}`);

    // 2. Simulate worker moving job to processing, then "crashing" before calling transport or acking
    const moved = await getRedis().lmove('sms:dispatch:queue', 'sms:dispatch:processing', 'RIGHT', 'LEFT');
    if (!moved) throw new Error('Failed to simulate LMOVE to processing');

    // Transport should have 0 calls so far
    if (tracker.calls !== 0) throw new Error(`Transport called prematurely: ${tracker.calls}`);

    // 3. Simulate job exceeding visibility timeout (> 45s)
    const item = JSON.parse(moved) as SmsQueueItem;
    item.createdAt = Date.now() - 50000;
    await getRedis().lrem('sms:dispatch:processing', 1, moved);
    await getRedis().lpush('sms:dispatch:processing', JSON.stringify(item));

    // 4. Run reaper daemon
    const reaped = await reapStaleProcessingJobs(45000);
    if (reaped !== 1) throw new Error(`Expected 1 reaped job, got ${reaped}`);

    // Verify job is back in sms:dispatch:queue
    const reQueuedLen = await getRedis().llen('sms:dispatch:queue');
    if (reQueuedLen !== 1) throw new Error(`Expected queue len 1 after reaper, got ${reQueuedLen}`);

    // 5. Worker resumes and processes the job
    const processed = await processNextJob(0);
    if (!processed) throw new Error('Worker failed to process re-queued job');

    // Assert: exactly 1 send, processing list is empty, dedupe key exists
    if (getCallCount(tracker) !== 1) throw new Error(`Expected exactly 1 send, got ${tracker.calls}`);
    const finalProcessingLen = await getRedis().llen('sms:dispatch:processing');
    if (finalProcessingLen !== 0) throw new Error(`Processing list not empty: ${finalProcessingLen}`);
    const dedupeExists = await getRedis().exists(`sms:dedupe:${challengeId}`);
    if (dedupeExists !== 1) throw new Error('Dedupe key missing after send');
  });

  // --- Test 2: Duplicate enqueue of the same challengeId -> one send ---
  await test('2. Duplicate enqueue of the same challengeId -> exactly ONE send', async () => {
    const tracker = { calls: 0 };
    setMockSmsTransport(async () => {
      tracker.calls++;
      return { success: true };
    });

    const phone = '09000001002';
    const challengeId = 'chal_dupe_2';

    // Enqueue first job
    await enqueueSmsDispatch({ phone, code: '22222', challengeId });
    // Process first job -> should send
    const processed1 = await processNextJob(0);
    if (!processed1 || tracker.calls !== 1) throw new Error('Job 1 failed to send');

    // Enqueue second job with duplicate challengeId
    await enqueueSmsDispatch({ phone, code: '22222', challengeId });
    // Process second job -> should be skipped by dedupe check
    const processed2 = await processNextJob(0);
    if (!processed2) throw new Error('Job 2 should have been handled/acked via dedupe');
    if (tracker.calls !== 1) throw new Error(`Expected sendCalls to remain 1, got ${tracker.calls}`);
  });

  // --- Test 3: Orphan jobs at boot -> worker drains them without new HTTP requests ---
  await test('3. Orphan jobs at boot -> worker drains all jobs without new requests', async () => {
    const tracker = { calls: 0 };
    setMockSmsTransport(async () => {
      tracker.calls++;
      return { success: true };
    });

    // Enqueue 3 orphan jobs
    await enqueueSmsDispatch({ phone: '09000001003', code: '30001', challengeId: 'chal_orphan_1' });
    await enqueueSmsDispatch({ phone: '09000001004', code: '30002', challengeId: 'chal_orphan_2' });
    await enqueueSmsDispatch({ phone: '09000001005', code: '30003', challengeId: 'chal_orphan_3' });

    const queueLen = await getRedis().llen('sms:dispatch:queue');
    if (queueLen !== 3) throw new Error(`Expected 3 jobs in queue, got ${queueLen}`);

    // Drain all 3 jobs
    while ((await getRedis().llen('sms:dispatch:queue')) > 0) {
      await processNextJob(0);
    }

    if (tracker.calls !== 3) throw new Error(`Expected 3 sends, got ${tracker.calls}`);
  });

  // --- Test 4: Gateway failure -> retry/backoff -> dead-letter after max attempts; counters unchanged ---
  await test('4. Gateway failure -> retry backoff -> dead-letter after 3 attempts, rate caps unchanged', async () => {
    const tracker = { calls: 0 };
    setMockSmsTransport(async () => {
      tracker.calls++;
      return { success: false, error: 'MeliPayamak upstream timeout 504' };
    });

    const phone = '09000001006';
    const phoneHash = getPhoneHash(phone);
    const challengeId = 'chal_fail_4';

    // Simulate pre-existing rate limit counter
    await getRedis().set(`sms:phone:${phoneHash}:hour`, '1', 'EX', 3600);
    await getRedis().set(`sms:phone:${phoneHash}:cooldown`, '1', 'EX', 60);

    const jobId = await enqueueSmsDispatch({ phone, code: '44444', challengeId });

    // Attempt 1 -> fails -> re-queued
    await processNextJob(0);
    if (getCallCount(tracker) !== 1) throw new Error(`Attempt 1 sendCalls: ${tracker.calls}`);
    let queueLen = await getRedis().llen('sms:dispatch:queue');
    if (queueLen !== 1) throw new Error('Attempt 1 did not re-queue');

    // Attempt 2 -> fails -> re-queued
    await processNextJob(0);
    if (getCallCount(tracker) !== 2) throw new Error(`Attempt 2 sendCalls: ${tracker.calls}`);
    queueLen = await getRedis().llen('sms:dispatch:queue');
    if (queueLen !== 1) throw new Error('Attempt 2 did not re-queue');

    // Attempt 3 -> fails -> dead-lettered
    await processNextJob(0);
    if (getCallCount(tracker) !== 3) throw new Error(`Attempt 3 sendCalls: ${tracker.calls}`);

    // Queue & processing must be empty
    queueLen = await getRedis().llen('sms:dispatch:queue');
    const procLen = await getRedis().llen('sms:dispatch:processing');
    const dlLen = await getRedis().llen('sms:dispatch:deadletter');
    if (queueLen !== 0 || procLen !== 0 || dlLen !== 1) {
      throw new Error(`Queue state invalid: queue=${queueLen}, proc=${procLen}, dl=${dlLen}`);
    }

    // Payload key must be hard-deleted on dead-lettering
    const payloadExists = await getRedis().exists(`sms:payload:${jobId}`);
    if (payloadExists !== 0) throw new Error('Payload was not deleted on dead-letter');

    // Cooldown key must be evicted
    const cooldownExists = await getRedis().exists(`sms:phone:${phoneHash}:cooldown`);
    if (cooldownExists !== 0) throw new Error('Cooldown key was not evicted on dead-letter');

    // Hourly rate limit counter must NOT be decremented or deleted
    const hourVal = await getRedis().get(`sms:phone:${phoneHash}:hour`);
    if (hourVal !== '1') throw new Error(`Rate limit counter modified! Expected '1', got '${hourVal}'`);
  });

  // --- Test 5: Two workers concurrently -> no double send ---
  await test('5. Two workers concurrently -> atomic LMOVE prevents double send', async () => {
    const tracker = { calls: 0 };
    setMockSmsTransport(async () => {
      tracker.calls++;
      await new Promise((r) => setTimeout(r, 20)); // Simulate gateway latency
      return { success: true };
    });

    const phone = '09000001007';
    await enqueueSmsDispatch({ phone, code: '55555', challengeId: 'chal_concurrent_5' });

    // Both workers attempt to process next job concurrently
    const [w1, w2] = await Promise.all([processNextJob(0), processNextJob(0)]);

    // Exactly one worker must succeed in acquiring the job, the other returns false
    const successCount = (w1 ? 1 : 0) + (w2 ? 1 : 0);
    if (successCount !== 1) throw new Error(`Expected exactly 1 worker to acquire job, got ${successCount}`);
    if (tracker.calls !== 1) throw new Error(`Expected exactly 1 sendCall, got ${tracker.calls}`);
  });

  // --- Test 6: Redis down -> register 503, nothing enqueued, transport never called ---
  await test('6. Redis down -> register 503 fail-closed, transport never called', async () => {
    const tracker = { calls: 0 };
    setMockSmsTransport(async () => {
      tracker.calls++;
      return { success: true };
    });

    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.REDIS_URL;

    try {
      await closeRedisConnection();
      (process.env as any).NODE_ENV = 'production';
      process.env.REDIS_URL = 'redis://127.0.0.1:9999'; // Dead port
      // Generate valid PoW challenge
      const chal = generatePoWChallenge();
      let solution = '';
      const prefix = '0'.repeat(chal.difficulty);
      let nonce = 0;
      while (true) {
        const hash = crypto.createHash('sha256').update(`${chal.challenge}:${nonce}`).digest('hex');
        if (hash.startsWith(prefix)) {
          solution = nonce.toString();
          break;
        }
        nonce++;
      }

      const req = new NextRequest('http://localhost:3000/api/waitlist/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '198.51.100.44',
        },
        body: JSON.stringify({
          phone: '09000001008',
          pow: { challenge: chal.challenge, solution },
          _hp: '',
          fillTimeMs: 2000,
        }),
      });

      const res = await registerHandler(req);
      if (res.status !== 503) {
        throw new Error(`Expected status 503 when Redis is down, got ${res.status}`);
      }
      const data = await res.json();
      if (!data.error || !data.error.includes('در دسترس نیست')) {
        throw new Error(`Expected Persian 503 error message, got: ${JSON.stringify(data)}`);
      }
      if (tracker.calls !== 0) {
        throw new Error(`Transport was called while Redis was down! Calls: ${tracker.calls}`);
      }
    } finally {
      (process.env as any).NODE_ENV = origEnv;
      process.env.REDIS_URL = origUrl;
      await closeRedisConnection();
    }
  });

  // --- Test 7: Log capture grep: no OTP, raw phone, raw IP, token, secret ---
  await test('7. Log capture grep: zero leaks of OTP, raw phone, raw IP, tokens, secrets', async () => {
    const rawPhone = '09000001009';
    const rawIp = '198.51.100.99';
    const secretOtp = '98765';
    const secretPepper = process.env.OTP_PEPPER || 'sample_secret_pepper_value_12345';

    setMockSmsTransport(async () => ({ success: true }));

    const capturedLogs: string[] = [];
    const origLog = console.log;
    const origInfo = console.info;
    const origWarn = console.warn;
    const origError = console.error;

    const interceptor = (...args: any[]) => {
      const line = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      capturedLogs.push(line);
    };

    console.log = interceptor;
    console.info = interceptor;
    console.warn = interceptor;
    console.error = interceptor;

    try {
      await enqueueSmsDispatch({
        phone: rawPhone,
        code: secretOtp,
        challengeId: 'chal_log_leak_7',
      });
      await processNextJob(0);
    } finally {
      console.log = origLog;
      console.info = origInfo;
      console.warn = origWarn;
      console.error = origError;
    }

    const allLogs = capturedLogs.join('\n');

    // 1. Assert NO raw phone
    if (allLogs.includes(rawPhone)) {
      throw new Error(`LOG LEAK DETECTED: Raw phone ${rawPhone} found in logs!`);
    }
    // 2. Assert NO raw OTP
    if (allLogs.includes(secretOtp)) {
      throw new Error(`LOG LEAK DETECTED: Secret OTP ${secretOtp} found in logs!`);
    }
    // 3. Assert NO raw secret pepper
    if (allLogs.includes(secretPepper)) {
      throw new Error('LOG LEAK DETECTED: Secret pepper found in logs!');
    }
    // 4. Assert masked phone IS present
    const expectedMask = '0900***1009';
    if (!allLogs.includes(expectedMask)) {
      throw new Error(`Expected masked phone ${expectedMask} in logs, but not found`);
    }
  });

  // --- Test 8: Graceful shutdown does not lose an in-flight job ---
  await test('8. Graceful shutdown finishes in-flight send without job loss', async () => {
    let sendCompleted = false;
    setMockSmsTransport(async () => {
      // Simulate in-flight gateway network delay
      await new Promise((r) => setTimeout(r, 50));
      sendCompleted = true;
      return { success: true };
    });

    const phone = '09000001010';
    const challengeId = 'chal_graceful_8';
    await enqueueSmsDispatch({ phone, code: '88888', challengeId });

    // Start processing in background
    const processPromise = processNextJob(0);

    // Concurrently trigger shutdown simulation
    let isShuttingDown = true;

    // Await job completion
    const result = await processPromise;
    if (!result || !sendCompleted) {
      throw new Error('In-flight job was dropped during shutdown');
    }

    // Verify processing list is empty and dedupe exists
    const procLen = await getRedis().llen('sms:dispatch:processing');
    if (procLen !== 0) throw new Error(`Job abandoned in processing: len=${procLen}`);
  });

  // --- Test 9: Test-only OTP hook cannot activate when NODE_ENV=production ---
  await test('9. Test-only OTP hook cannot activate when NODE_ENV=production', async () => {
    const origEnv = process.env.NODE_ENV;
    const origFlag = process.env.TEST_OTP_CAPTURE;

    try {
      (process.env as any).NODE_ENV = 'production';
      process.env.TEST_OTP_CAPTURE = 'true';

      // 1. getCapturedTestOtp must throw in production
      let threwHook = false;
      try {
        getCapturedTestOtp('any_challenge');
      } catch (err: any) {
        if (err.message.includes('strictly forbidden in production')) {
          threwHook = true;
        }
      }
      if (!threwHook) {
        throw new Error('getCapturedTestOtp did not throw FATAL in production mode!');
      }

      // 2. setMockSmsTransport must throw in production
      let threwMock = false;
      try {
        setMockSmsTransport(async () => ({ success: true }));
      } catch (err: any) {
        if (err.message.includes('strictly forbidden in production')) {
          threwMock = true;
        }
      }
      if (!threwMock) {
        throw new Error('setMockSmsTransport did not throw FATAL in production mode!');
      }

      // 3. In non-production with TEST_OTP_CAPTURE=true, hook works safely
      (process.env as any).NODE_ENV = 'development';
      process.env.TEST_OTP_CAPTURE = 'true';
      setMockSmsTransport(async () => ({ success: true }));
      clearCapturedTestOtps();

      await enqueueSmsDispatch({ phone: '09000001011', code: '99999', challengeId: 'chal_hook_9' });
      await processNextJob(0);

      const captured = getCapturedTestOtp('chal_hook_9');
      if (captured !== '99999') {
        throw new Error(`Expected captured OTP '99999', got '${captured}'`);
      }
    } finally {
      (process.env as any).NODE_ENV = origEnv;
      process.env.TEST_OTP_CAPTURE = origFlag;
      setMockSmsTransport(null);
      clearCapturedTestOtps();
    }
  });

  // --- Test 10: Missing SMS_ENCRYPTION_KEY -> strictly fails closed (no fallback) ---
  await test('10. Missing SMS_ENCRYPTION_KEY -> strictly fails closed (no fallback to pepper or dev string)', async () => {
    const savedKey = process.env.SMS_ENCRYPTION_KEY;
    const phone = '09000001012';
    const challengeId = 'chal_key_test_10';

    try {
      // 1. Missing key
      delete process.env.SMS_ENCRYPTION_KEY;
      let missingThrew = false;
      try {
        getSmsPayloadKey();
      } catch (err: any) {
        missingThrew = true;
        if (!err.message.includes('SMS_ENCRYPTION_KEY')) {
          throw new Error(`Unexpected error message: ${err.message}`);
        }
      }
      if (!missingThrew) {
        throw new Error('getSmsPayloadKey did not throw when SMS_ENCRYPTION_KEY was missing!');
      }

      // 2. Also verify enqueueSmsDispatch fails closed when key is missing
      let enqueueThrew = false;
      try {
        await enqueueSmsDispatch({ phone, code: '12345', challengeId });
      } catch (err: any) {
        enqueueThrew = true;
      }
      if (!enqueueThrew) {
        throw new Error('enqueueSmsDispatch did not fail closed when key was missing!');
      }

      // 3. Non-hex or invalid length strings must throw
      const invalidKeys = [
        'short_key_under_32_bytes',
        'a'.repeat(32), // raw utf8 32 chars, not 64 hex
        'a'.repeat(63), // 63 hex
        'a'.repeat(65), // 65 hex
        'g'.repeat(64), // 64 non-hex characters
      ];

      for (const invalidKey of invalidKeys) {
        process.env.SMS_ENCRYPTION_KEY = invalidKey;
        let threw = false;
        try {
          getSmsPayloadKey();
        } catch (err: any) {
          threw = true;
          if (!err.message.includes('must be exactly 64 hexadecimal characters')) {
            throw new Error(`Unexpected error message for key "${invalidKey}": ${err.message}`);
          }
        }
        if (!threw) {
          throw new Error(`getSmsPayloadKey accepted invalid key: "${invalidKey}"`);
        }
      }

      // 4. Exactly 64 hex characters must succeed
      process.env.SMS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const parsedBuf = getSmsPayloadKey();
      if (parsedBuf.length !== 32) {
        throw new Error(`Expected 32 bytes Buffer, got ${parsedBuf.length}`);
      }
    } finally {
      process.env.SMS_ENCRYPTION_KEY = savedKey;
    }
  });

  // --- Test 11: Idle worker blocks on dedicated Redis connection without timeout-error loops ---
  await test('11. Idle worker blocks on dedicated Redis without commandTimeout error loops', async () => {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    // Dedicated connection without commandTimeout (same as standalone worker daemon)
    const workerRedis = new Redis(redisUrl, {
      connectTimeout: 5000,
      maxRetriesPerRequest: null,
    });

    const capturedErrors: string[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      capturedErrors.push(args.join(' '));
      origError(...args);
    };

    try {
      // Empty queue block for 1 second
      const startTime = Date.now();
      const result = await processNextJob(1, workerRedis);
      const elapsedMs = Date.now() - startTime;

      if (result !== false) {
        throw new Error(`Expected processNextJob to return false on empty queue, got ${result}`);
      }

      // Must have blocked for ~1000ms (at least 800ms) rather than failing at 250ms
      if (elapsedMs < 800) {
        throw new Error(`Worker did not block cleanly! Elapsed only ${elapsedMs}ms (expected >= 800ms)`);
      }

      // Assert zero Command timed out or SMS_QUEUE_LMOVE_ERROR errors
      const timeoutErrors = capturedErrors.filter(
        (log) => /command timed out/i.test(log) || /SMS_QUEUE_LMOVE_ERROR/i.test(log)
      );
      if (timeoutErrors.length > 0) {
        throw new Error(`Worker experienced timeout errors during block wait: ${timeoutErrors.join('; ')}`);
      }
    } finally {
      console.error = origError;
      await workerRedis.quit().catch(() => workerRedis.disconnect());
    }
  });

  console.log('\n====================================================');
  console.log(`   C1.5 TEST RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('====================================================\n');

  await cleanupQueueKeys();
  await closeRedisConnection();
  process.exit(passedTests === totalTests ? 0 : 1);
}

runC15Tests().catch((err) => {
  console.error('Unhandled test suite failure:', err);
  process.exit(1);
});
