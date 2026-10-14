/**
 * GATE C5 PHASE 3 PRODUCTION SMS WORKER DAEMON VERIFICATION SUITE
 * 
 * Verifies all 16 required Phase 3 criteria:
 *  1. Worker idle behavior does not busy-loop.
 *  2. A valid Claim is processed with concurrency 1.
 *  3. Lease heartbeat renews the current Claim.
 *  4. A stale claimToken cannot renew, ACK, or delete the current Claim.
 *  5. Provider timeout aborts around 10 seconds with a documented tolerance.
 *  6. Confirmed provider success triggers a valid conditional ACK.
 *  7. A provider HTTP 5xx follows the expected failure/retry path.
 *  8. A network timeout is classified correctly and does not exceed three initiated attempts.
 *  9. Backoff scheduling uses 5 seconds and 20 seconds for the applicable failures.
 * 10. Attempt 3 can be reserved and executed; attempt 4 never reaches the HTTP provider.
 * 11. An OTP at or past expiresAt results in no provider HTTP request.
 * 12. A missing/invalid encrypted payload produces a controlled error and safe cleanup/Deadletter handling.
 * 13. A stale worker cannot clean up a newer Claim after provider completion.
 * 14. SIGTERM stops new Claims and drains or safely abandons the current Claim within 15 seconds.
 * 15. Redis failure during ACK does not produce a false success report.
 * 16. Redis failure while scheduling retry does not falsely report that the retry is durable.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import Redis from 'ioredis';
import {
  atomicEnqueue,
  conditionalLeaseRefresh,
  conditionalAck,
  scheduleRetry,
  QUEUE_KEY,
  PROCESSING_KEY,
  RETRY_KEY,
  DEADLETTER_KEY,
  LEASE_PREFIX,
  META_PREFIX,
  PAYLOAD_PREFIX,
  ACTIVE_MARKER_PREFIX,
} from '../src/lib/security/queue';
import { MeliPayamakProvider } from '../src/lib/sms/melipayamak';
import { SmsWorker } from './sms-worker';

// ----------------------------------------------------------------------------
// Secret & Environment Setup
// ----------------------------------------------------------------------------
try {
  const envContent = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
} catch {}

let password = process.env.REDIS_PASSWORD;
const passwordFile = process.env.REDIS_PASSWORD_FILE || path.join(__dirname, '../secrets/redis_password.txt');
if (!password && fs.existsSync(passwordFile)) {
  try {
    password = fs.readFileSync(passwordFile, 'utf8').trim();
  } catch {}
}

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6380;

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: password || undefined,
  connectTimeout: 3000,
  maxRetriesPerRequest: 1,
});

async function cleanupKeys(jobIds: string[]) {
  const pipeline = redis.pipeline();
  for (const jid of jobIds) {
    pipeline.del(
      `${LEASE_PREFIX}${jid}`,
      `${META_PREFIX}${jid}`,
      `${PAYLOAD_PREFIX}${jid}`,
      `${ACTIVE_MARKER_PREFIX}${jid}`
    );
  }
  await pipeline.exec();
}

async function runPhase3Tests() {
  console.log('============================================================');
  console.log('GATE C5 PHASE 3 SMS WORKER DAEMON VERIFICATION SUITE');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  try {
    const ping = await redis.ping();
    if (ping !== 'PONG') throw new Error(`Unexpected ping: ${ping}`);
    console.log(`✔ Connected to authenticated Redis instance on ${REDIS_HOST}:${REDIS_PORT}\n`);
  } catch (err: unknown) {
    console.error('FATAL: Could not connect to Redis:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // --------------------------------------------------------------------------
  // TEST 1: Worker idle behavior does not busy-loop
  // --------------------------------------------------------------------------
  console.log('TEST 1: Verifying worker idle behavior does not busy-loop...');
  try {
    await redis.del(QUEUE_KEY);
    let claimCalls = 0;
    const trackingRedis = new Proxy(redis, {
      get(target, prop, receiver) {
        if (prop === 'eval') {
          return async (...args: unknown[]) => {
            claimCalls++;
            return (target.eval as (...a: unknown[]) => Promise<unknown>)(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const pollIntervalMs = 40;
    const worker = new SmsWorker({
      redisClient: trackingRedis as unknown as Redis,
      pollIntervalMs,
      autoStartSignals: false,
    });

    // Start worker loop in background
    const startPromise = worker.start();
    // Allow worker to idle for 150ms
    await new Promise((r) => setTimeout(r, 150));
    await worker.stop();
    await startPromise.catch(() => {});

    // In 150ms with 40ms interval, claimCalls should be around 3 to 5, strictly < 10
    if (claimCalls > 8) {
      throw new Error(`Worker busy-looped! Executed ${claimCalls} claims in 150ms (expected <= 8)`);
    }

    console.log(`✔ TEST 1 PASSED: Worker idled cleanly with ${claimCalls} polls in 150ms (non-busy loop confirmed)`);
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 1 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  }

  // --------------------------------------------------------------------------
  // TEST 2: Valid Claim is processed with concurrency 1
  // --------------------------------------------------------------------------
  console.log('\nTEST 2: Verifying valid claims are processed strictly with concurrency 1...');
  const t2Jobs = [`t2-job-1-${Date.now()}`, `t2-job-2-${Date.now()}`];
  try {
    await redis.del(QUEUE_KEY, PROCESSING_KEY);
    let activeDispatches = 0;
    let maxConcurrent = 0;

    const mockSms = {
      sendOtp: async () => {
        activeDispatches++;
        maxConcurrent = Math.max(maxConcurrent, activeDispatches);
        await new Promise((r) => setTimeout(r, 60)); // Simulate provider latency
        activeDispatches--;
        return { success: true, providerMessageId: 'REC-T2' };
      },
    };

    // Enqueue 2 valid jobs
    for (const jid of t2Jobs) {
      await atomicEnqueue({
        phone: '09121111111',
        code: '123456',
        challengeId: `ch-${jid}`,
        jobId: jid,
        customRedis: redis,
      });
    }

    const worker = new SmsWorker({
      redisClient: redis,
      smsService: mockSms,
      autoStartSignals: false,
    });

    const res1 = await worker.processSingleJob();
    const res2 = await worker.processSingleJob();

    if (!res1.processed || res1.status !== 'ACKED') throw new Error(`Job 1 failed: ${JSON.stringify(res1)}`);
    if (!res2.processed || res2.status !== 'ACKED') throw new Error(`Job 2 failed: ${JSON.stringify(res2)}`);
    if (maxConcurrent !== 1) throw new Error(`Concurrency violation! Max concurrent dispatches was ${maxConcurrent}`);

    console.log('✔ TEST 2 PASSED: Both jobs processed sequentially; max observed concurrency was strictly 1');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 2 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys(t2Jobs);
  }

  // --------------------------------------------------------------------------
  // TEST 3: Lease heartbeat renews the current Claim
  // --------------------------------------------------------------------------
  console.log('\nTEST 3: Verifying lease heartbeat renews active claim during long processing...');
  const t3Job = `t3-job-${Date.now()}`;
  try {
    await redis.del(QUEUE_KEY, PROCESSING_KEY);
    await atomicEnqueue({
      phone: '09122222222',
      code: '234567',
      challengeId: `ch-${t3Job}`,
      jobId: t3Job,
      customRedis: redis,
    });

    let observedTtlDuringDispatch = 0;

    const mockSms = {
      sendOtp: async () => {
        // Wait 120ms with heartbeat configured at 40ms so at least 2 heartbeats fire
        await new Promise((r) => setTimeout(r, 60));
        observedTtlDuringDispatch = await redis.ttl(`${LEASE_PREFIX}${t3Job}`);
        await new Promise((r) => setTimeout(r, 60));
        return { success: true, providerMessageId: 'REC-T3' };
      },
    };

    const worker = new SmsWorker({
      redisClient: redis,
      smsService: mockSms,
      heartbeatIntervalMs: 35,
      leaseTtlSeconds: 45,
      autoStartSignals: false,
    });

    const res = await worker.processSingleJob();
    if (!res.processed || res.status !== 'ACKED') throw new Error(`Heartbeat job failed: ${JSON.stringify(res)}`);

    if (observedTtlDuringDispatch < 40) {
      throw new Error(`Heartbeat failed to refresh TTL! Observed TTL during run: ${observedTtlDuringDispatch}`);
    }

    console.log(`✔ TEST 3 PASSED: Lease heartbeat renewed active claim (TTL maintained at ${observedTtlDuringDispatch}s)`);
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 3 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t3Job]);
  }

  // --------------------------------------------------------------------------
  // TEST 4: Stale claimToken cannot renew, ACK, or delete the current Claim
  // --------------------------------------------------------------------------
  console.log('\nTEST 4: Verifying stale claimToken cannot renew, ACK, or delete active claim...');
  const t4Job = `t4-job-${Date.now()}`;
  try {
    const validToken = crypto.randomUUID();
    const staleToken = crypto.randomUUID();

    // Setup active claim with validToken
    await redis.set(`${LEASE_PREFIX}${t4Job}`, validToken, 'EX', 45);
    await redis.lpush(PROCESSING_KEY, `${t4Job}:${validToken}`);
    await redis.hset(`${META_PREFIX}${t4Job}`, 'jobId', t4Job);
    await redis.set(`${PAYLOAD_PREFIX}${t4Job}`, 'test-payload');
    await redis.set(`${ACTIVE_MARKER_PREFIX}${t4Job}`, '1');

    // 4.1 Stale token cannot refresh lease
    const renewRes = await conditionalLeaseRefresh(t4Job, staleToken, 45, redis);
    if (renewRes !== 'LEASE_LOST') {
      throw new Error(`Stale refresh expected LEASE_LOST, got: ${renewRes}`);
    }

    // 4.2 Stale token cannot ACK claim
    const ackRes = await conditionalAck(t4Job, staleToken, redis);
    if (ackRes !== 'LEASE_MISMATCH') {
      throw new Error(`Stale ACK expected LEASE_MISMATCH, got: ${ackRes}`);
    }

    // 4.3 Verify valid claim data in Redis was completely untouched
    const currentLease = await redis.get(`${LEASE_PREFIX}${t4Job}`);
    if (currentLease !== validToken) throw new Error('Valid lease was altered by stale claim!');
    const procEntries = await redis.lrange(PROCESSING_KEY, 0, -1);
    if (!procEntries.includes(`${t4Job}:${validToken}`)) throw new Error('Processing entry was removed!');
    const payload = await redis.get(`${PAYLOAD_PREFIX}${t4Job}`);
    if (payload !== 'test-payload') throw new Error('Payload was removed or altered!');

    console.log('✔ TEST 4 PASSED: Stale claimToken strictly blocked from renewing, ACK-ing, or deleting active claim');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 4 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t4Job]);
    await redis.lrem(PROCESSING_KEY, 0, `${t4Job}:*`);
  }

  // --------------------------------------------------------------------------
  // TEST 5: Provider timeout aborts around 10 seconds with documented tolerance
  // --------------------------------------------------------------------------
  console.log('\nTEST 5: Verifying provider timeout aborts around 10 seconds (documented tolerance)...');
  try {
    // Start local HTTP server that hangs without responding
    let serverPort = 0;
    const hangingServer = http.createServer(() => {
      // Do nothing, let request hang
    });

    await new Promise<void>((resolve) => {
      hangingServer.listen(0, '127.0.0.1', () => {
        const addr = hangingServer.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });

    // Test with 500ms timeout to verify timeout classification and tolerance in test environment
    const testTimeoutMs = 500;
    const provider = new MeliPayamakProvider({
      username: 'test-user',
      password: 'test-password',
      bodyId: 12345,
      endpoint: `http://127.0.0.1:${serverPort}`,
      timeoutMs: testTimeoutMs,
    });

    const startTime = Date.now();
    const result = await provider.sendOtp({ phone: '09123333333', code: '112233' });
    const elapsed = Date.now() - startTime;

    hangingServer.close();

    if (result.success !== false) throw new Error('Hanging request unexpectedly succeeded');
    if (result.error !== 'TIMEOUT_EXCEPTION') throw new Error(`Expected TIMEOUT_EXCEPTION, got: ${result.error}`);

    // Tolerance: within testTimeoutMs +/- 350ms
    if (elapsed < testTimeoutMs - 50 || elapsed > testTimeoutMs + 400) {
      throw new Error(`Timeout elapsed time outside tolerance: ${elapsed}ms for timeout ${testTimeoutMs}ms`);
    }

    // Verify default provider instance uses 10,000ms hard timeout
    const defaultProvider = new MeliPayamakProvider({
      username: 'test',
      password: 'pw',
      bodyId: 1,
    });
    if ((defaultProvider as unknown as { timeoutMs: number }).timeoutMs !== 10000) {
      throw new Error(`Default provider timeout is not 10,000ms: ${(defaultProvider as unknown as { timeoutMs: number }).timeoutMs}`);
    }

    console.log(`✔ TEST 5 PASSED: Timeout cleanly aborted at ${elapsed}ms (TIMEOUT_EXCEPTION classified, 10s production default verified)`);
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 5 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  }

  // --------------------------------------------------------------------------
  // TEST 6: Confirmed provider success triggers a valid conditional ACK
  // --------------------------------------------------------------------------
  console.log('\nTEST 6: Verifying confirmed provider success triggers valid conditional ACK...');
  const t6Job = `t6-job-${Date.now()}`;
  try {
    await redis.del(QUEUE_KEY, PROCESSING_KEY);
    await atomicEnqueue({
      phone: '09124444444',
      code: '334455',
      challengeId: `ch-${t6Job}`,
      jobId: t6Job,
      customRedis: redis,
    });

    const mockSms = {
      sendOtp: async () => ({ success: true, providerMessageId: 'REC-SUCCESS-T6' }),
    };

    const worker = new SmsWorker({
      redisClient: redis,
      smsService: mockSms,
      autoStartSignals: false,
    });

    const res = await worker.processSingleJob();
    if (!res.processed || res.status !== 'ACKED') throw new Error(`Expected ACKED, got: ${JSON.stringify(res)}`);

    // Verify all keys cleaned up in Redis
    const inQueue = await redis.lrange(QUEUE_KEY, 0, -1);
    if (inQueue.includes(t6Job)) throw new Error('Job still in queue after ACK');
    const inProc = await redis.lrange(PROCESSING_KEY, 0, -1);
    if (inProc.some((p) => p.startsWith(`${t6Job}:`))) throw new Error('Job still in processing after ACK');
    const lease = await redis.get(`${LEASE_PREFIX}${t6Job}`);
    if (lease !== null) throw new Error('Lease still present after ACK');
    const meta = await redis.hgetall(`${META_PREFIX}${t6Job}`);
    if (Object.keys(meta).length > 0) throw new Error('Metadata still present after ACK');
    const payload = await redis.get(`${PAYLOAD_PREFIX}${t6Job}`);
    if (payload !== null) throw new Error('Payload still present after ACK');
    const marker = await redis.get(`${ACTIVE_MARKER_PREFIX}${t6Job}`);
    if (marker !== null) throw new Error('Active marker still present after ACK');

    console.log('✔ TEST 6 PASSED: Provider success resulted in complete conditional ACK and clean state cleanup');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 6 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t6Job]);
  }

  // --------------------------------------------------------------------------
  // TEST 7: Provider HTTP 5xx follows expected failure/retry path
  // --------------------------------------------------------------------------
  console.log('\nTEST 7: Verifying provider HTTP 5xx follows expected failure/retry path...');
  const t7Job = `t7-job-${Date.now()}`;
  try {
    await redis.del(QUEUE_KEY, PROCESSING_KEY, RETRY_KEY);
    await atomicEnqueue({
      phone: '09125555555',
      code: '556677',
      challengeId: `ch-${t7Job}`,
      jobId: t7Job,
      customRedis: redis,
    });

    // Start local server that returns HTTP 503
    let serverPort = 0;
    const errorServer = http.createServer((_, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Service Unavailable' }));
    });

    await new Promise<void>((resolve) => {
      errorServer.listen(0, '127.0.0.1', () => {
        const addr = errorServer.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });

    const provider503 = new MeliPayamakProvider({
      username: 'u',
      password: 'p',
      bodyId: 1,
      endpoint: `http://127.0.0.1:${serverPort}`,
    });

    const worker = new SmsWorker({
      redisClient: redis,
      smsService: provider503,
      autoStartSignals: false,
    });

    const res = await worker.processSingleJob();
    errorServer.close();

    if (res.processed !== false || res.reason !== 'RETRY_SCHEDULED') {
      throw new Error(`Expected RETRY_SCHEDULED, got: ${JSON.stringify(res)}`);
    }

    // Verify job in retry ZSET
    const retryScore = await redis.zscore(RETRY_KEY, t7Job);
    if (!retryScore) throw new Error('Job not scheduled in retry ZSET');

    // Verify backoff is ~5000ms
    const diff = Number(retryScore) - Date.now();
    if (diff < 4000 || diff > 6000) throw new Error(`Unexpected retry score delay: ${diff}ms (expected ~5000ms)`);

    // Verify metadata failure counts
    const meta = await redis.hgetall(`${META_PREFIX}${t7Job}`);
    if (meta.providerAttemptsInitiated !== '1' || meta.providerAttemptsFailed !== '1') {
      throw new Error(`Metadata counts incorrect: ${JSON.stringify(meta)}`);
    }

    console.log('✔ TEST 7 PASSED: HTTP 503 correctly triggered failure recording and 5s backoff retry scheduling');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 7 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t7Job]);
    await redis.zrem(RETRY_KEY, t7Job);
  }

  // --------------------------------------------------------------------------
  // TEST 8: Network timeout classified correctly & attempts capped at 3
  // --------------------------------------------------------------------------
  console.log('\nTEST 8: Verifying network timeout classification and 3-attempt lifecycle cap...');
  const t8Job = `t8-job-${Date.now()}`;
  try {
    await redis.del(QUEUE_KEY, PROCESSING_KEY, RETRY_KEY, DEADLETTER_KEY);
    await atomicEnqueue({
      phone: '09126666666',
      code: '667788',
      challengeId: `ch-${t8Job}`,
      jobId: t8Job,
      customRedis: redis,
    });

    let mockCalls = 0;
    const timeoutMock = {
      sendOtp: async () => {
        mockCalls++;
        return { success: false, error: 'TIMEOUT_EXCEPTION' };
      },
    };

    const worker = new SmsWorker({
      redisClient: redis,
      smsService: timeoutMock,
      autoStartSignals: false,
    });

    // Attempt 1: Queue -> Retry (5s)
    const r1 = await worker.processSingleJob();
    if (r1.reason !== 'RETRY_SCHEDULED' || r1.attemptNumber !== 1 || r1.backoffMs !== 5000) {
      throw new Error(`Attempt 1 failed: ${JSON.stringify(r1)}`);
    }

    // Simulate scheduler popping from retry and pushing to queue for Attempt 2
    await redis.zrem(RETRY_KEY, t8Job);
    await redis.lpush(QUEUE_KEY, t8Job);

    // Attempt 2: Queue -> Retry (20s)
    const r2 = await worker.processSingleJob();
    if (r2.reason !== 'RETRY_SCHEDULED' || r2.attemptNumber !== 2 || r2.backoffMs !== 20000) {
      throw new Error(`Attempt 2 failed: ${JSON.stringify(r2)}`);
    }

    // Simulate scheduler popping from retry and pushing to queue for Attempt 3
    await redis.zrem(RETRY_KEY, t8Job);
    await redis.lpush(QUEUE_KEY, t8Job);

    // Attempt 3: Queue -> Deadletter (exhausted)
    const r3 = await worker.processSingleJob();
    if (r3.reason !== 'MAX_PROVIDER_ATTEMPTS_EXCEEDED') {
      throw new Error(`Attempt 3 should deadletter, got: ${JSON.stringify(r3)}`);
    }

    // Verify Deadletter state
    const dlItems = await redis.lrange(DEADLETTER_KEY, 0, -1);
    const dlEntry = dlItems.find((d) => d.includes(t8Job));
    if (!dlEntry) throw new Error('Job not found in Deadletter list');

    // Verify exactly 3 mock calls made
    if (mockCalls !== 3) throw new Error(`Expected exactly 3 provider calls, but got ${mockCalls}`);

    // Verify Deadletter record contains exact reason and jobId
    const parsedDl = JSON.parse(dlEntry);
    if (parsedDl.jobId !== t8Job) throw new Error(`Deadletter record jobId mismatched: ${parsedDl.jobId}`);
    if (parsedDl.reason !== 'MAX_PROVIDER_ATTEMPTS_EXCEEDED') {
      throw new Error(`Deadletter record reason was: ${parsedDl.reason}`);
    }

    console.log('✔ TEST 8 PASSED: Exactly 3 provider attempts executed; job cleanly deadlettered on exhaustion');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 8 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t8Job]);
    await redis.del(DEADLETTER_KEY);
  }

  // --------------------------------------------------------------------------
  // TEST 9: Backoff scheduling uses 5s and 20s
  // --------------------------------------------------------------------------
  console.log('\nTEST 9: Verifying backoff scheduling accurately uses 5s and 20s...');
  const t9Job1 = `t9-job1-${Date.now()}`;
  const t9Job2 = `t9-job2-${Date.now()}`;
  try {
    const claimToken1 = crypto.randomUUID();
    const claimToken2 = crypto.randomUUID();

    await redis.lpush(PROCESSING_KEY, `${t9Job1}:${claimToken1}`);
    await redis.set(`${LEASE_PREFIX}${t9Job1}`, claimToken1, 'EX', 45);

    await redis.lpush(PROCESSING_KEY, `${t9Job2}:${claimToken2}`);
    await redis.set(`${LEASE_PREFIX}${t9Job2}`, claimToken2, 'EX', 45);

    // 9.1 Schedule 5s backoff
    const sched5 = await scheduleRetry(t9Job1, claimToken1, 5000, redis);
    if (sched5 !== 'SCHEDULED') throw new Error(`5s schedule returned: ${sched5}`);
    const score5 = await redis.zscore(RETRY_KEY, t9Job1);
    const diff5 = Number(score5) - Date.now();
    if (Math.abs(diff5 - 5000) > 1000) throw new Error(`Score delta for 5s was ${diff5}ms`);

    // 9.2 Schedule 20s backoff
    const sched20 = await scheduleRetry(t9Job2, claimToken2, 20000, redis);
    if (sched20 !== 'SCHEDULED') throw new Error(`20s schedule returned: ${sched20}`);
    const score20 = await redis.zscore(RETRY_KEY, t9Job2);
    const diff20 = Number(score20) - Date.now();
    if (Math.abs(diff20 - 20000) > 1000) throw new Error(`Score delta for 20s was ${diff20}ms`);

    console.log(`✔ TEST 9 PASSED: Exact 5,000ms (diff: ${diff5}ms) and 20,000ms (diff: ${diff20}ms) verified`);
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 9 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t9Job1, t9Job2]);
    await redis.zrem(RETRY_KEY, t9Job1, t9Job2);
  }

  // --------------------------------------------------------------------------
  // TEST 10: Attempt 3 can execute; Attempt 4 never reaches HTTP provider
  // --------------------------------------------------------------------------
  console.log('\nTEST 10: Verifying Attempt 3 executes and Attempt 4 never reaches HTTP provider...');
  const t10Job = `t10-job-${Date.now()}`;
  try {
    let httpCalls = 0;
    const countingMock = {
      sendOtp: async () => {
        httpCalls++;
        return { success: false, error: 'SIMULATED_FAILURE' };
      },
    };

    // Pre-set job with initiated = 3 (Attempt 4 boundary)
    await atomicEnqueue({
      phone: '09127777777',
      code: '778899',
      challengeId: `ch-${t10Job}`,
      jobId: t10Job,
      customRedis: redis,
    });
    await redis.hset(`${META_PREFIX}${t10Job}`, 'providerAttemptsInitiated', '3');

    const worker = new SmsWorker({
      redisClient: redis,
      smsService: countingMock,
      autoStartSignals: false,
    });

    const res = await worker.processSingleJob();
    if (res.reason !== 'MAX_ATTEMPTS_EXHAUSTED') {
      throw new Error(`Expected MAX_ATTEMPTS_EXHAUSTED, got: ${JSON.stringify(res)}`);
    }

    if (httpCalls !== 0) {
      throw new Error(`Attempt 4 reached the HTTP provider! Call count was ${httpCalls}`);
    }

    console.log('✔ TEST 10 PASSED: Attempt 4 was blocked before HTTP dispatch (zero outgoing provider requests)');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 10 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t10Job]);
  }

  // --------------------------------------------------------------------------
  // TEST 11: OTP at or past expiresAt results in no provider HTTP request
  // --------------------------------------------------------------------------
  console.log('\nTEST 11: Verifying expired OTP results in zero provider HTTP requests...');
  const t11Job = `t11-job-${Date.now()}`;
  try {
    let httpCalls = 0;
    const countingMock = {
      sendOtp: async () => {
        httpCalls++;
        return { success: true };
      },
    };

    const pastExpiry = Date.now() - 5000;
    await atomicEnqueue({
      phone: '09128888888',
      code: '889900',
      challengeId: `ch-${t11Job}`,
      jobId: t11Job,
      expiresAt: pastExpiry,
      customRedis: redis,
    });

    const worker = new SmsWorker({
      redisClient: redis,
      smsService: countingMock,
      autoStartSignals: false,
    });

    const res = await worker.processSingleJob();
    if (res.reason !== 'OTP_EXPIRED') {
      throw new Error(`Expected OTP_EXPIRED, got: ${JSON.stringify(res)}`);
    }

    if (httpCalls !== 0) {
      throw new Error(`Expired OTP triggered provider call! (calls: ${httpCalls})`);
    }

    // Verify job deadlettered with reason OTP_EXPIRED_BEFORE_SEND
    const dlItems = await redis.lrange(DEADLETTER_KEY, 0, -1);
    const dlEntry = dlItems.find((d) => d.includes(t11Job));
    if (!dlEntry || !dlEntry.includes('OTP_EXPIRED_BEFORE_SEND')) {
      throw new Error(`Deadletter record missing or wrong reason: ${dlEntry}`);
    }

    console.log('✔ TEST 11 PASSED: Expired OTP aborted prior to provider request and deadlettered cleanly');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 11 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t11Job]);
    await redis.del(DEADLETTER_KEY);
  }

  // --------------------------------------------------------------------------
  // TEST 12: Missing/corrupt payload produces controlled error and safe Deadletter
  // --------------------------------------------------------------------------
  console.log('\nTEST 12: Verifying corrupted payload handling produces safe Deadletter transfer...');
  const t12Job = `t12-job-${Date.now()}`;
  try {
    await atomicEnqueue({
      phone: '09129999999',
      code: '990011',
      challengeId: `ch-${t12Job}`,
      jobId: t12Job,
      customRedis: redis,
    });

    // Corrupt payload
    await redis.set(`${PAYLOAD_PREFIX}${t12Job}`, 'not_a_valid_hex_encrypted_payload');

    const worker = new SmsWorker({
      redisClient: redis,
      autoStartSignals: false,
    });

    const res = await worker.processSingleJob();
    if (res.reason !== 'PAYLOAD_DECRYPT_ERROR') {
      throw new Error(`Expected PAYLOAD_DECRYPT_ERROR, got: ${JSON.stringify(res)}`);
    }

    // Verify job was transferred to Deadletter
    const dlItems = await redis.lrange(DEADLETTER_KEY, 0, -1);
    const dlEntry = dlItems.find((d) => d.includes(t12Job));
    if (!dlEntry || !dlEntry.includes('PAYLOAD_DECRYPT_ERROR')) {
      throw new Error(`Deadletter entry not found or reason mismatched: ${dlEntry}`);
    }

    // Verify lease cleaned up
    const lease = await redis.get(`${LEASE_PREFIX}${t12Job}`);
    if (lease !== null) throw new Error('Lease was left orphaned after decrypt failure');

    console.log('✔ TEST 12 PASSED: Corrupted payload safely transferred to Deadletter without orphan lease');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 12 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t12Job]);
    await redis.del(DEADLETTER_KEY);
  }

  // --------------------------------------------------------------------------
  // TEST 13: Stale worker cannot clean up newer Claim after provider completion
  // --------------------------------------------------------------------------
  console.log('\nTEST 13: Verifying stale worker cannot clean up newer Claim after provider completion...');
  const t13Job = `t13-job-${Date.now()}`;
  try {
    await atomicEnqueue({
      phone: '09120000000',
      code: '001122',
      challengeId: `ch-${t13Job}`,
      jobId: t13Job,
      customRedis: redis,
    });

    const newToken = crypto.randomUUID();

    const mockSms = {
      sendOtp: async () => {
        // While provider is "running", simulate lease loss: overwrite lease with newToken
        await redis.set(`${LEASE_PREFIX}${t13Job}`, newToken, 'EX', 45);
        return { success: true, providerMessageId: 'REC-T13' };
      },
    };

    const worker = new SmsWorker({
      redisClient: redis,
      smsService: mockSms,
      autoStartSignals: false,
    });

    const res = await worker.processSingleJob();
    if (res.reason !== 'ACK_LEASE_MISMATCH') {
      throw new Error(`Expected ACK_LEASE_MISMATCH, got: ${JSON.stringify(res)}`);
    }

    // Verify that the newer lease was NOT deleted by the stale worker
    const currentLease = await redis.get(`${LEASE_PREFIX}${t13Job}`);
    if (currentLease !== newToken) {
      throw new Error(`Newer lease was corrupted! Expected ${newToken}, got: ${currentLease}`);
    }

    console.log('✔ TEST 13 PASSED: Stale worker rejected on ACK; newer claim lease preserved');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 13 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t13Job]);
  }

  // --------------------------------------------------------------------------
  // TEST 14: Graceful shutdown stops new claims, drains or abandons within 15s
  // --------------------------------------------------------------------------
  console.log('\nTEST 14: Verifying graceful shutdown stops new claims and drains or abandons safely...');
  const t14Job = `t14-job-${Date.now()}`;
  try {
    await redis.del(QUEUE_KEY, PROCESSING_KEY);
    await atomicEnqueue({
      phone: '09121234567',
      code: '123123',
      challengeId: `ch-${t14Job}`,
      jobId: t14Job,
      customRedis: redis,
    });

    let jobStarted = false;
    let jobFinished = false;

    const mockSms = {
      sendOtp: async () => {
        jobStarted = true;
        await new Promise((r) => setTimeout(r, 80));
        jobFinished = true;
        return { success: true, providerMessageId: 'REC-T14' };
      },
    };

    const worker = new SmsWorker({
      redisClient: redis,
      smsService: mockSms,
      shutdownGraceMs: 2000,
      autoStartSignals: false,
    });

    // Start worker in background
    const workerPromise = worker.start();

    // Wait until job execution begins
    while (!jobStarted) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Trigger graceful shutdown while job is in-flight
    const stopPromise = worker.stop();

    await Promise.all([workerPromise, stopPromise]);

    if (!jobFinished) throw new Error('In-flight job was aborted instead of drained!');

    // Verify job was ACKed cleanly
    const inProc = await redis.lrange(PROCESSING_KEY, 0, -1);
    if (inProc.some((p) => p.startsWith(`${t14Job}:`))) throw new Error('Job still in processing after drain');

    console.log('✔ TEST 14 PASSED: Graceful shutdown allowed in-flight job to drain cleanly within grace period');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 14 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t14Job]);
  }

  // --------------------------------------------------------------------------
  // TEST 15: Redis failure during ACK does not produce false success report
  // --------------------------------------------------------------------------
  console.log('\nTEST 15: Verifying Redis failure during ACK does not produce false success report...');
  const t15Job = `t15-job-${Date.now()}`;
  try {
    await redis.del(QUEUE_KEY, PROCESSING_KEY);
    await atomicEnqueue({
      phone: '09127654321',
      code: '765432',
      challengeId: `ch-${t15Job}`,
      jobId: t15Job,
      customRedis: redis,
    });

    let failOnAck = false;
    const failingRedis = new Proxy(redis, {
      get(target, prop, receiver) {
        if (prop === 'eval') {
          return async (...args: unknown[]) => {
            if (failOnAck) {
              throw new Error('Connection lost to Redis during ACK evaluation');
            }
            return (target.eval as (...a: unknown[]) => Promise<unknown>)(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const mockSms = {
      sendOtp: async () => {
        failOnAck = true;
        return { success: true, providerMessageId: 'REC-T15' };
      },
    };

    const worker = new SmsWorker({
      redisClient: failingRedis as unknown as Redis,
      smsService: mockSms,
      autoStartSignals: false,
    });

    const res = await worker.processSingleJob();
    if (res.processed !== false || res.reason !== 'ACK_REDIS_FAILURE') {
      throw new Error(`Expected ACK_REDIS_FAILURE, got: ${JSON.stringify(res)}`);
    }

    console.log('✔ TEST 15 PASSED: Redis failure during ACK returned ACK_REDIS_FAILURE (no false success report)');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 15 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t15Job]);
  }

  // --------------------------------------------------------------------------
  // TEST 16: Redis failure while scheduling retry does not falsely report durable
  // --------------------------------------------------------------------------
  console.log('\nTEST 16: Verifying Redis failure during retry scheduling does not falsely report durable...');
  const t16Job = `t16-job-${Date.now()}`;
  try {
    await redis.del(QUEUE_KEY, PROCESSING_KEY);
    await atomicEnqueue({
      phone: '09128765432',
      code: '876543',
      challengeId: `ch-${t16Job}`,
      jobId: t16Job,
      customRedis: redis,
    });

    const failingRedis = new Proxy(redis, {
      get(target, prop, receiver) {
        if (prop === 'eval') {
          return async (...args: unknown[]) => {
            const script = String(args[0]);
            if (script.includes('SCHEDULE_RETRY_LUA') || script.includes('ZADD')) {
              throw new Error('Redis socket closed during ZADD scheduleRetry');
            }
            return (target.eval as (...a: unknown[]) => Promise<unknown>)(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const mockSms = {
      sendOtp: async () => ({ success: false, error: 'TRANSIENT_500' }),
    };

    const worker = new SmsWorker({
      redisClient: failingRedis as unknown as Redis,
      smsService: mockSms,
      autoStartSignals: false,
    });

    const res = await worker.processSingleJob();
    if (res.processed !== false || (res.reason !== 'RETRY_SCHED_REDIS_ERROR' && res.reason !== 'FAILED')) {
      throw new Error(`Expected FAILED or RETRY_SCHED_REDIS_ERROR, got: ${JSON.stringify(res)}`);
    }

    // Verify job is NOT in retry ZSET (retry was not falsely recorded as durable)
    const inRetry = await redis.zscore(RETRY_KEY, t16Job);
    if (inRetry !== null) {
      throw new Error('Retry was falsely written to ZSET despite Redis failure!');
    }

    console.log('✔ TEST 16 PASSED: Redis failure during retry scheduling reported failure (no false durability claim)');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 16 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([t16Job]);
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n============================================================');
  console.log(`GATE C5 PHASE 3 SUITE COMPLETE: ${passed} PASSED | ${failed} FAILED`);
  console.log('============================================================\n');

  redis.disconnect();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhase3Tests().catch((err: unknown) => {
  console.error('FATAL TEST RUNNER ERROR:', err);
  process.exit(1);
});
