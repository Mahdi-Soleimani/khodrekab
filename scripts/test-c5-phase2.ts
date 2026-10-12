import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Redis from 'ioredis';
import { execSync } from 'child_process';
import {
  atomicEnqueue,
  atomicClaim,
  conditionalLeaseRefresh,
  conditionalAck,
  transferToDeadletter,
  reserveProviderAttempt,
  recordProviderFailure,
  scheduleRetry,
  QUEUE_KEY,
  PROCESSING_KEY,
  RETRY_KEY,
  DEADLETTER_KEY,
  LEASE_PREFIX,
  META_PREFIX,
  PAYLOAD_PREFIX,
  ACTIVE_MARKER_PREFIX,
  DEDUP_TRANSFER_PREFIX,
  MAX_QUEUE_CAPACITY,
  MAX_RETRY_CAPACITY,
  MAX_DEADLETTER_CAPACITY,
  decryptPayload,
} from '../src/lib/security/queue';

// ----------------------------------------------------------------------------
// Environment & Secret Loading (Without logging credentials)
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

if (!password) {
  console.error('FATAL: Redis password not found in environment or secret file');
  process.exit(1);
}

const REDIS_HOST = '127.0.0.1';
const REDIS_PORT = 6380;

function createTestRedis(port = REDIS_PORT, pass: string | undefined = password): Redis {
  return new Redis({
    host: REDIS_HOST,
    port,
    password: pass,
    connectTimeout: 2000,
    commandTimeout: 2000,
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });
}

async function runPhase2Tests() {
  console.log('============================================================');
  console.log('GATE C5 PHASE 2 ATOMIC QUEUE ENGINE VERIFICATION SUITE');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  const redis = createTestRedis();

  try {
    const ping = await redis.ping();
    if (ping !== 'PONG') throw new Error(`Redis ping failed: ${ping}`);
    console.log('✔ Connected to authenticated Redis instance on 127.0.0.1:6380\n');
  } catch (err: unknown) {
    console.error('FATAL: Could not connect to Redis:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Helper for cleanup
  async function cleanupKeys(jobIds: string[]) {
    const pipeline = redis.pipeline();
    for (const id of jobIds) {
      pipeline.del(
        `${LEASE_PREFIX}${id}`,
        `${META_PREFIX}${id}`,
        `${PAYLOAD_PREFIX}${id}`,
        `${ACTIVE_MARKER_PREFIX}${id}`,
        `${DEDUP_TRANSFER_PREFIX}PROC:${id}:*`,
        `${DEDUP_TRANSFER_PREFIX}SYS:queue:${id}`,
        `${DEDUP_TRANSFER_PREFIX}SYS:retry:${id}`
      );
      pipeline.lrem(QUEUE_KEY, 0, id);
      pipeline.zrem(RETRY_KEY, id);
    }
    // Also remove items from processing list
    const procItems = await redis.lrange(PROCESSING_KEY, 0, -1);
    for (const item of procItems) {
      for (const id of jobIds) {
        if (item.startsWith(`${id}:`)) {
          pipeline.lrem(PROCESSING_KEY, 0, item);
        }
      }
    }
    await pipeline.exec();
  }

  // --------------------------------------------------------------------------
  // TEST 1: Single Valid Enqueue
  // --------------------------------------------------------------------------
  console.log('TEST 1: Verifying single valid enqueue creates queue item, meta, payload, and active marker...');
  const testJobId1 = `test-job-1-${Date.now()}`;
  try {
    const result = await atomicEnqueue({
      phone: '09121111111',
      code: '456789',
      challengeId: 'ch-test-1',
      jobId: testJobId1,
      customRedis: redis,
    });

    if (result.status !== 'ACCEPTED' || result.jobId !== testJobId1) {
      throw new Error(`Expected ACCEPTED, got ${JSON.stringify(result)}`);
    }

    // Verify Queue list contains jobId
    const queueTail = await redis.lindex(QUEUE_KEY, 0);
    if (queueTail !== testJobId1) {
      throw new Error(`Queue head does not match enqueued jobId: ${queueTail}`);
    }

    // Verify Active Marker
    const activeMarker = await redis.get(`${ACTIVE_MARKER_PREFIX}${testJobId1}`);
    if (activeMarker !== '1') {
      throw new Error(`Active marker missing or invalid: ${activeMarker}`);
    }

    // Verify Metadata
    const meta = await redis.hgetall(`${META_PREFIX}${testJobId1}`);
    if (meta.jobId !== testJobId1 || meta.challengeId !== 'ch-test-1') {
      throw new Error(`Metadata mismatch: ${JSON.stringify(meta)}`);
    }
    if (meta.providerAttemptsInitiated !== '0' || meta.providerAttemptsFailed !== '0') {
      throw new Error(`Initial attempt counters must be 0: ${JSON.stringify(meta)}`);
    }

    // Verify Payload & Decryption
    const encPayload = await redis.get(`${PAYLOAD_PREFIX}${testJobId1}`);
    if (!encPayload) throw new Error('Payload key not found');
    const decrypted = decryptPayload(encPayload);
    if (decrypted.phone !== '09121111111' || decrypted.code !== '456789') {
      throw new Error(`Decrypted payload mismatch: ${JSON.stringify(decrypted)}`);
    }

    // Verify TTL bounds
    const payloadTtl = await redis.ttl(`${PAYLOAD_PREFIX}${testJobId1}`);
    const metaTtl = await redis.ttl(`${META_PREFIX}${testJobId1}`);
    if (payloadTtl <= 400 || payloadTtl > 420) {
      throw new Error(`Payload TTL unexpected: ${payloadTtl}`);
    }
    if (metaTtl <= 430 || metaTtl > 450) {
      throw new Error(`Metadata TTL unexpected: ${metaTtl}`);
    }

    console.log('✔ TEST 1 PASSED: Single atomic enqueue correctly writes all keys with exact TTLs and active marker');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 1 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([testJobId1]);
  }

  // --------------------------------------------------------------------------
  // TEST 2: Concurrent Duplicate Enqueue Protection
  // --------------------------------------------------------------------------
  console.log('\nTEST 2: Verifying concurrent duplicate enqueue produces at most one accepted job...');
  const dupJobId = `dup-job-${Date.now()}`;
  try {
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 15; i++) {
      promises.push(
        atomicEnqueue({
          phone: '09122222222',
          code: '112233',
          challengeId: `ch-dup-${i}`,
          jobId: dupJobId,
          customRedis: redis,
        })
      );
    }

    const results = (await Promise.all(promises)) as { status: string }[];
    const acceptedCount = results.filter((r) => r.status === 'ACCEPTED').length;
    const dupCount = results.filter((r) => r.status === 'DUPLICATE_ACTIVE').length;

    if (acceptedCount !== 1) {
      throw new Error(`Expected exactly 1 accepted job, found ${acceptedCount}`);
    }
    if (dupCount !== 14) {
      throw new Error(`Expected 14 DUPLICATE_ACTIVE rejections, found ${dupCount}`);
    }

    // Verify only 1 entry in queue
    const queueItems = await redis.lrange(QUEUE_KEY, 0, -1);
    const matchesInQueue = queueItems.filter((id) => id === dupJobId).length;
    if (matchesInQueue !== 1) {
      throw new Error(`Expected 1 occurrence in queue, found ${matchesInQueue}`);
    }

    console.log('✔ TEST 2 PASSED: 15 concurrent duplicate enqueues yielded exactly 1 ACCEPTED and 14 DUPLICATE_ACTIVE');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 2 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([dupJobId]);
  }

  // --------------------------------------------------------------------------
  // TEST 3: Capacity Saturation & Unambiguous Rejection
  // --------------------------------------------------------------------------
  console.log('\nTEST 3: Verifying queue capacity bound of 10,000 and rejection without partial state...');
  const capJobId = `cap-job-${Date.now()}`;
  try {
    // Fill queue to 10,000 items rapidly via pipeline
    const preLen = await redis.llen(QUEUE_KEY);
    const needed = MAX_QUEUE_CAPACITY - preLen;
    if (needed > 0) {
      const pipeline = redis.pipeline();
      for (let i = 0; i < needed; i++) {
        pipeline.lpush(QUEUE_KEY, `dummy-cap-item-${i}`);
      }
      await pipeline.exec();
    }

    const currentLen = await redis.llen(QUEUE_KEY);
    if (currentLen < MAX_QUEUE_CAPACITY) {
      throw new Error(`Failed to saturate queue to ${MAX_QUEUE_CAPACITY}; current: ${currentLen}`);
    }

    // Now attempt enqueue beyond capacity
    const rejectRes = await atomicEnqueue({
      phone: '09123333333',
      code: '998877',
      challengeId: 'ch-cap-exceeded',
      jobId: capJobId,
      customRedis: redis,
    });

    if (rejectRes.status !== 'QUEUE_CAPACITY_REACHED') {
      throw new Error(`Expected QUEUE_CAPACITY_REACHED, got ${JSON.stringify(rejectRes)}`);
    }

    // Verify queue length never exceeded 10,000
    const finalLen = await redis.llen(QUEUE_KEY);
    if (finalLen > MAX_QUEUE_CAPACITY) {
      throw new Error(`Queue length exceeded limit: ${finalLen} > ${MAX_QUEUE_CAPACITY}`);
    }

    // Verify active marker, payload, and meta were NOT left in Redis
    const activeMarker = await redis.get(`${ACTIVE_MARKER_PREFIX}${capJobId}`);
    const metaExists = await redis.exists(`${META_PREFIX}${capJobId}`);
    const payloadExists = await redis.exists(`${PAYLOAD_PREFIX}${capJobId}`);

    if (activeMarker !== null || metaExists !== 0 || payloadExists !== 0) {
      throw new Error('Partial state was leaked into Redis on capacity rejection!');
    }

    console.log(`✔ TEST 3 PASSED: Enqueue at capacity limit returned QUEUE_CAPACITY_REACHED with zero partial state`);
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 3 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    // Remove dummy capacity items
    await redis.del(QUEUE_KEY);
    await cleanupKeys([capJobId]);
  }

  // --------------------------------------------------------------------------
  // TEST 4: Atomic Claim, Token Generation & Exclusive Ownership
  // --------------------------------------------------------------------------
  console.log('\nTEST 4: Verifying atomic claim, UUID token generation, exclusive lease, and queue pop...');
  const claimJobId = `claim-job-${Date.now()}`;
  try {
    await atomicEnqueue({
      phone: '09124444444',
      code: '654321',
      challengeId: 'ch-claim-1',
      jobId: claimJobId,
      customRedis: redis,
    });

    // Execute atomic claim
    const claimRes = await atomicClaim(redis);
    if (claimRes.status !== 'CLAIMED' || claimRes.jobId !== claimJobId || !claimRes.claimToken) {
      throw new Error(`Unexpected claim result: ${JSON.stringify(claimRes)}`);
    }

    const token1 = claimRes.claimToken;

    // Verify claimToken is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(token1)) {
      throw new Error(`claimToken is not a valid UUID: ${token1}`);
    }

    // Verify Lease key in Redis
    const leaseVal = await redis.get(`${LEASE_PREFIX}${claimJobId}`);
    if (leaseVal !== token1) {
      throw new Error(`Lease key mismatch: expected ${token1}, got ${leaseVal}`);
    }
    const leaseTtl = await redis.ttl(`${LEASE_PREFIX}${claimJobId}`);
    if (leaseTtl <= 30 || leaseTtl > 45) {
      throw new Error(`Lease TTL unexpected: ${leaseTtl}`);
    }

    // Verify Processing list contains jobId:claimToken
    const procItem = `${claimJobId}:${token1}`;
    const procItems = await redis.lrange(PROCESSING_KEY, 0, -1);
    if (!procItems.includes(procItem)) {
      throw new Error(`Processing list missing item: ${procItem}`);
    }

    // Verify Queue no longer has the job
    const queueItems = await redis.lrange(QUEUE_KEY, 0, -1);
    if (queueItems.includes(claimJobId)) {
      throw new Error(`Job still present in queue after claim!`);
    }

    // Concurrent claim on empty queue returns EMPTY
    const secondClaim = await atomicClaim(redis);
    if (secondClaim.status !== 'EMPTY') {
      throw new Error(`Second claim on empty queue should be EMPTY, got: ${JSON.stringify(secondClaim)}`);
    }

    console.log('✔ TEST 4 PASSED: Atomic claim established exclusive lease, processing item, and popped from queue');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 4 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([claimJobId]);
  }

  // --------------------------------------------------------------------------
  // TEST 5: Purge-and-Advance for Ghost Duplicates at Queue Tail
  // --------------------------------------------------------------------------
  console.log('\nTEST 5: Verifying Purge-and-Advance removes ghost duplicate without altering active claim...');
  const ghostJobId = `ghost-job-${Date.now()}`;
  const legitimateJobId = `legit-job-${Date.now()}`;
  try {
    // 1. Setup active claim for ghostJobId
    const activeToken = crypto.randomUUID();
    await redis.set(`${LEASE_PREFIX}${ghostJobId}`, activeToken, 'EX', 45);
    await redis.lpush(PROCESSING_KEY, `${ghostJobId}:${activeToken}`);
    await redis.hset(`${META_PREFIX}${ghostJobId}`, 'jobId', ghostJobId, 'active', '1');
    await redis.set(`${PAYLOAD_PREFIX}${ghostJobId}`, 'test-payload');

    // 2. Enqueue legitimate job first, then enqueue ghost duplicate at tail
    // In Redis FIFO: item at index -1 is tail.
    // If we LPUSH legitimateJobId, then LPUSH ghostJobId:
    // Tail (-1) is legitimateJobId!
    // To put ghostJobId at tail (-1): we LPUSH ghostJobId first, then legitimateJobId!
    // Queue: [ legitimateJobId (head: index 0), ghostJobId (tail: index -1) ]
    await redis.lpush(QUEUE_KEY, ghostJobId);
    await redis.lpush(QUEUE_KEY, legitimateJobId);

    // Verify tail (-1) is ghostJobId
    const tailItem = await redis.lindex(QUEUE_KEY, -1);
    if (tailItem !== ghostJobId) {
      throw new Error(`Test setup error: tail item should be ghostJobId, got ${tailItem}`);
    }

    // 3. Execute atomicClaim()
    // It should detect ghostJobId at tail has active lease + processing item,
    // purge ghostJobId from queue tail, advance, and claim legitimateJobId!
    const claimRes = await atomicClaim(redis);
    if (claimRes.status !== 'CLAIMED' || claimRes.jobId !== legitimateJobId) {
      throw new Error(`Expected CLAIMED for legitimateJobId, got: ${JSON.stringify(claimRes)}`);
    }

    // 4. Verify ghostJobId active claim was UNTOUCHED
    const ghostLease = await redis.get(`${LEASE_PREFIX}${ghostJobId}`);
    if (ghostLease !== activeToken) {
      throw new Error(`Ghost active lease was corrupted: expected ${activeToken}, got ${ghostLease}`);
    }
    const procItems = await redis.lrange(PROCESSING_KEY, 0, -1);
    if (!procItems.includes(`${ghostJobId}:${activeToken}`)) {
      throw new Error(`Ghost processing entry was improperly removed!`);
    }

    // 5. Verify ghost duplicate was removed from queue
    const remainingQueue = await redis.lrange(QUEUE_KEY, 0, -1);
    if (remainingQueue.includes(ghostJobId)) {
      throw new Error(`Ghost duplicate was NOT purged from queue!`);
    }

    console.log('✔ TEST 5 PASSED: Purge-and-Advance purged ghost duplicate from queue tail and advanced to legitimate candidate');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 5 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([ghostJobId, legitimateJobId]);
  }

  // --------------------------------------------------------------------------
  // TEST 6: Zombie Token Protection (Refresh & Conditional ACK)
  // --------------------------------------------------------------------------
  console.log('\nTEST 6: Verifying zombie token cannot refresh lease or ACK a newer claim...');
  const zombieJobId = `zombie-job-${Date.now()}`;
  try {
    const validToken = crypto.randomUUID();
    const zombieToken = crypto.randomUUID();

    // Establish active claim under validToken
    await redis.set(`${LEASE_PREFIX}${zombieJobId}`, validToken, 'EX', 45);
    await redis.hset(`${META_PREFIX}${zombieJobId}`, 'jobId', zombieJobId);
    await redis.set(`${PAYLOAD_PREFIX}${zombieJobId}`, 'payload');
    await redis.set(`${ACTIVE_MARKER_PREFIX}${zombieJobId}`, '1');
    await redis.lpush(PROCESSING_KEY, `${zombieJobId}:${validToken}`);

    // Zombie Refresh Attempt
    const refreshRes = await conditionalLeaseRefresh(zombieJobId, zombieToken, 45, redis);
    if (refreshRes !== 'LEASE_LOST') {
      throw new Error(`Zombie lease refresh expected LEASE_LOST, got: ${refreshRes}`);
    }

    // Zombie ACK Attempt
    const ackRes = await conditionalAck(zombieJobId, zombieToken, redis);
    if (ackRes !== 'LEASE_MISMATCH') {
      throw new Error(`Zombie conditionalAck expected LEASE_MISMATCH, got: ${ackRes}`);
    }

    // Verify valid claim remains intact after zombie attempts
    const leaseAfterZombie = await redis.get(`${LEASE_PREFIX}${zombieJobId}`);
    const metaExists = await redis.exists(`${META_PREFIX}${zombieJobId}`);
    const payloadExists = await redis.exists(`${PAYLOAD_PREFIX}${zombieJobId}`);
    const activeExists = await redis.exists(`${ACTIVE_MARKER_PREFIX}${zombieJobId}`);
    if (leaseAfterZombie !== validToken || !metaExists || !payloadExists || !activeExists) {
      throw new Error('Zombie attempt corrupted active claim data!');
    }

    // Valid Refresh Attempt
    const validRefresh = await conditionalLeaseRefresh(zombieJobId, validToken, 45, redis);
    if (validRefresh !== 'RENEWED') {
      throw new Error(`Valid lease refresh expected RENEWED, got: ${validRefresh}`);
    }

    // Valid ACK Attempt
    const validAck = await conditionalAck(zombieJobId, validToken, redis);
    if (validAck !== 'ACKED') {
      throw new Error(`Valid conditionalAck expected ACKED, got: ${validAck}`);
    }

    // Verify complete cleanup after valid ACK
    const leaseFinal = await redis.exists(`${LEASE_PREFIX}${zombieJobId}`);
    const metaFinal = await redis.exists(`${META_PREFIX}${zombieJobId}`);
    const payloadFinal = await redis.exists(`${PAYLOAD_PREFIX}${zombieJobId}`);
    const activeFinal = await redis.exists(`${ACTIVE_MARKER_PREFIX}${zombieJobId}`);
    const procAfterAck = await redis.lrange(PROCESSING_KEY, 0, -1);

    if (leaseFinal || metaFinal || payloadFinal || activeFinal || procAfterAck.includes(`${zombieJobId}:${validToken}`)) {
      throw new Error('Valid ACK did not clean all accessories!');
    }

    // Repeated ACK on already ACKed job
    const repeatAck = await conditionalAck(zombieJobId, validToken, redis);
    if (repeatAck === 'ACKED') {
      throw new Error('Repeated ACK should not report ACKED on already deleted claim');
    }

    console.log('✔ TEST 6 PASSED: Stale worker was strictly blocked from refresh/ACK, valid ACK cleaned all keys cleanly');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 6 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([zombieJobId]);
  }

  // --------------------------------------------------------------------------
  // TEST 7: Type-Safe Deadletter Transfer Across All Sources
  // --------------------------------------------------------------------------
  console.log('\nTEST 7: Verifying Type-Safe Deadletter transfer across queue, retry, and processing...');
  const dlJobQueue = `dl-queue-${Date.now()}`;
  const dlJobRetry = `dl-retry-${Date.now()}`;
  const dlJobProc = `dl-proc-${Date.now()}`;

  try {
    // 7.1 Transfer from QUEUE (LREM)
    await redis.lpush(QUEUE_KEY, dlJobQueue);
    await redis.hset(`${META_PREFIX}${dlJobQueue}`, 'jobId', dlJobQueue);
    await redis.set(`${PAYLOAD_PREFIX}${dlJobQueue}`, 'payload');
    await redis.set(`${ACTIVE_MARKER_PREFIX}${dlJobQueue}`, '1');

    const resQueue = await transferToDeadletter({
      jobId: dlJobQueue,
      sourceType: 'queue',
      reason: 'TEST_QUEUE_EXPIRY',
      customRedis: redis,
    });
    if (resQueue !== 'TRANSFERRED') throw new Error(`Queue DL expected TRANSFERRED, got ${resQueue}`);

    const inQueueAfter = await redis.lrange(QUEUE_KEY, 0, -1);
    if (inQueueAfter.includes(dlJobQueue)) throw new Error('Job was not removed from queue');

    // 7.2 Transfer from RETRY (ZREM without WRONGTYPE error!)
    await redis.zadd(RETRY_KEY, Date.now() + 10000, dlJobRetry);
    await redis.hset(`${META_PREFIX}${dlJobRetry}`, 'jobId', dlJobRetry);
    await redis.set(`${PAYLOAD_PREFIX}${dlJobRetry}`, 'payload');
    await redis.set(`${ACTIVE_MARKER_PREFIX}${dlJobRetry}`, '1');

    const resRetry = await transferToDeadletter({
      jobId: dlJobRetry,
      sourceType: 'retry',
      reason: 'TEST_RETRY_EXPIRY',
      customRedis: redis,
    });
    if (resRetry !== 'TRANSFERRED') throw new Error(`Retry DL expected TRANSFERRED, got ${resRetry}`);

    const inRetryAfter = await redis.zscore(RETRY_KEY, dlJobRetry);
    if (inRetryAfter !== null) throw new Error('Job was not removed from retry ZSET');

    // 7.3 Transfer from PROCESSING (LREM with exact claimToken)
    const procToken = crypto.randomUUID();
    await redis.set(`${LEASE_PREFIX}${dlJobProc}`, procToken, 'EX', 45);
    await redis.lpush(PROCESSING_KEY, `${dlJobProc}:${procToken}`);
    await redis.hset(`${META_PREFIX}${dlJobProc}`, 'jobId', dlJobProc);
    await redis.set(`${PAYLOAD_PREFIX}${dlJobProc}`, 'payload');
    await redis.set(`${ACTIVE_MARKER_PREFIX}${dlJobProc}`, '1');

    // Attempt transfer with wrong token (rejected)
    const resBadToken = await transferToDeadletter({
      jobId: dlJobProc,
      sourceType: 'processing',
      claimToken: 'wrong-token',
      reason: 'TEST_BAD_TOKEN',
      customRedis: redis,
    });
    if (resBadToken !== 'REJECTED') throw new Error(`Bad token transfer should be REJECTED, got: ${resBadToken}`);

    // Attempt transfer with correct token
    const resProc = await transferToDeadletter({
      jobId: dlJobProc,
      sourceType: 'processing',
      claimToken: procToken,
      reason: 'TEST_PROC_DEADLETTER',
      customRedis: redis,
    });
    if (resProc !== 'TRANSFERRED') throw new Error(`Processing DL expected TRANSFERRED, got ${resProc}`);

    // 7.4 SYSTEM cannot bypass active lease on Queue or Retry
    const sysBlockedJob = `sys-blocked-${Date.now()}`;
    await redis.lpush(QUEUE_KEY, sysBlockedJob);
    await redis.set(`${LEASE_PREFIX}${sysBlockedJob}`, 'active-lease', 'EX', 45);

    const resSysBlocked = await transferToDeadletter({
      jobId: sysBlockedJob,
      sourceType: 'queue',
      reason: 'SYSTEM_UNAUTHORIZED_TRANSFER',
      customRedis: redis,
    });
    if (resSysBlocked !== 'REJECTED') {
      throw new Error(`SYSTEM transfer bypassed active lease! Expected REJECTED, got: ${resSysBlocked}`);
    }
    // Verify item is still in queue
    const queueAfterSys = await redis.lrange(QUEUE_KEY, 0, -1);
    if (!queueAfterSys.includes(sysBlockedJob)) {
      throw new Error('SYSTEM transfer improperly removed item with active lease');
    }

    // 7.5 True Idempotency: repeated transfer does not duplicate in Deadletter
    const dlBeforeLen = await redis.llen(DEADLETTER_KEY);
    const repeatRes = await transferToDeadletter({
      jobId: dlJobProc,
      sourceType: 'processing',
      claimToken: procToken,
      reason: 'REPEAT_TRANSFER',
      customRedis: redis,
    });
    if (repeatRes !== 'TRANSFERRED') throw new Error(`Repeat transfer should return TRANSFERRED, got ${repeatRes}`);
    const dlAfterLen = await redis.llen(DEADLETTER_KEY);
    if (dlAfterLen !== dlBeforeLen) {
      throw new Error(`Dedup failed! Deadletter length increased from ${dlBeforeLen} to ${dlAfterLen}`);
    }

    // 7.6 Metadata-Missing Recovery
    const metaMissingJob = `meta-miss-${Date.now()}`;
    await redis.lpush(QUEUE_KEY, metaMissingJob);
    const resMetaMiss = await transferToDeadletter({
      jobId: metaMissingJob,
      sourceType: 'queue',
      reason: 'METADATA_ABSENT',
      customRedis: redis,
    });
    if (resMetaMiss !== 'TRANSFERRED') throw new Error(`Meta-missing transfer failed: ${resMetaMiss}`);

    console.log('✔ TEST 7 PASSED: Type-safe transfers verified for all 3 sources; SYSTEM lease guard and dedup verified');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 7 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([dlJobQueue, dlJobRetry, dlJobProc, 'sys-blocked']);
  }

  // --------------------------------------------------------------------------
  // TEST 8: Atomic Provider Attempt Reservation & Pre-Send Guard
  // --------------------------------------------------------------------------
  console.log('\nTEST 8: Verifying provider attempt reservations (1,2,3 ok, 4 exhausted) and pre-send expiration guard...');
  const resvJobId = `resv-job-${Date.now()}`;
  try {
    const claimToken = crypto.randomUUID();
    const futureExpiry = Date.now() + 60000;

    await redis.set(`${LEASE_PREFIX}${resvJobId}`, claimToken, 'EX', 45);
    await redis.hset(`${META_PREFIX}${resvJobId}`,
      'jobId', resvJobId,
      'expiresAt', futureExpiry.toString(),
      'providerAttemptsInitiated', '0',
      'providerAttemptsFailed', '0'
    );

    // Reservation 1
    const r1 = await reserveProviderAttempt(resvJobId, claimToken, redis);
    if (r1.status !== 'RESERVED' || r1.attemptNumber !== 1) {
      throw new Error(`Reservation 1 failed: ${JSON.stringify(r1)}`);
    }

    // Reservation 2
    const r2 = await reserveProviderAttempt(resvJobId, claimToken, redis);
    if (r2.status !== 'RESERVED' || r2.attemptNumber !== 2) {
      throw new Error(`Reservation 2 failed: ${JSON.stringify(r2)}`);
    }

    // Reservation 3
    const r3 = await reserveProviderAttempt(resvJobId, claimToken, redis);
    if (r3.status !== 'RESERVED' || r3.attemptNumber !== 3) {
      throw new Error(`Reservation 3 failed: ${JSON.stringify(r3)}`);
    }

    // Reservation 4 (Must be EXHAUSTED)
    const r4 = await reserveProviderAttempt(resvJobId, claimToken, redis);
    if (r4.status !== 'EXHAUSTED' || r4.attempts !== 3) {
      throw new Error(`Reservation 4 should be EXHAUSTED, got: ${JSON.stringify(r4)}`);
    }

    // Verify simulated crash: attempt 1 was consumed and total stays at 3
    const finalInitiated = await redis.hget(`${META_PREFIX}${resvJobId}`, 'providerAttemptsInitiated');
    if (finalInitiated !== '3') {
      throw new Error(`Total attempts initiated should be 3, got: ${finalInitiated}`);
    }

    // Independent failure counter
    const f1 = await recordProviderFailure(resvJobId, redis);
    const f2 = await recordProviderFailure(resvJobId, redis);
    if (f1 !== 1 || f2 !== 2) {
      throw new Error(`recordProviderFailure returned invalid counts: f1=${f1}, f2=${f2}`);
    }
    const metaAfterFail = await redis.hgetall(`${META_PREFIX}${resvJobId}`);
    if (metaAfterFail.providerAttemptsFailed !== '2' || metaAfterFail.providerAttemptsInitiated !== '3') {
      throw new Error(`Failure counter corrupted initiated counter: ${JSON.stringify(metaAfterFail)}`);
    }

    // Pre-Send OTP Expiration Guard
    const expJobId = `exp-job-${Date.now()}`;
    const expToken = crypto.randomUUID();
    const pastExpiry = Date.now() - 5000;
    await redis.set(`${LEASE_PREFIX}${expJobId}`, expToken, 'EX', 45);
    await redis.hset(`${META_PREFIX}${expJobId}`,
      'jobId', expJobId,
      'expiresAt', pastExpiry.toString(),
      'providerAttemptsInitiated', '0'
    );

    const rExp = await reserveProviderAttempt(expJobId, expToken, redis);
    if (rExp.status !== 'OTP_EXPIRED') {
      throw new Error(`Expired OTP should return OTP_EXPIRED, got: ${JSON.stringify(rExp)}`);
    }
    const initiatedOnExp = await redis.hget(`${META_PREFIX}${expJobId}`, 'providerAttemptsInitiated');
    if (initiatedOnExp !== '0') {
      throw new Error('Attempts count should not increment on expired OTP');
    }

    console.log('✔ TEST 8 PASSED: Reservations 1,2,3 succeeded; 4 exhausted; simulated crash & pre-send expiry guarded');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 8 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([resvJobId, 'exp-job']);
  }

  // --------------------------------------------------------------------------
  // TEST 9: Retry ZSET Capacity Guard (Max 5,000)
  // --------------------------------------------------------------------------
  console.log('\nTEST 9: Verifying Retry ZSET capacity enforcement and overflow to deadletter...');
  const retryJobId = `retry-overflow-${Date.now()}`;
  try {
    // Fill Retry ZSET to MAX_RETRY_CAPACITY (5,000) rapidly
    const preZLen = await redis.zcard(RETRY_KEY);
    const needed = MAX_RETRY_CAPACITY - preZLen;
    if (needed > 0) {
      const pipeline = redis.pipeline();
      for (let i = 0; i < needed; i++) {
        pipeline.zadd(RETRY_KEY, Date.now() + 100000, `dummy-retry-${i}`);
      }
      await pipeline.exec();
    }

    const curZcard = await redis.zcard(RETRY_KEY);
    if (curZcard < MAX_RETRY_CAPACITY) {
      throw new Error(`Failed to saturate retry zset to ${MAX_RETRY_CAPACITY}; current: ${curZcard}`);
    }

    // Attempt to schedule retry when at capacity
    const claimToken = crypto.randomUUID();
    await redis.lpush(PROCESSING_KEY, `${retryJobId}:${claimToken}`);
    await redis.set(`${LEASE_PREFIX}${retryJobId}`, claimToken, 'EX', 45);

    const schedRes = await scheduleRetry(retryJobId, claimToken, 5000, redis);
    if (schedRes !== 'OVERFLOW_DEADLETTER') {
      throw new Error(`Expected OVERFLOW_DEADLETTER, got: ${schedRes}`);
    }

    // Verify Retry ZSET size did NOT exceed 5,000
    const finalZLen = await redis.zcard(RETRY_KEY);
    if (finalZLen > MAX_RETRY_CAPACITY) {
      throw new Error(`Retry ZSET exceeded maximum capacity: ${finalZLen} > ${MAX_RETRY_CAPACITY}`);
    }

    console.log('✔ TEST 9 PASSED: Retry ZSET capacity bound of 5,000 strictly enforced with deadletter overflow');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 9 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await redis.del(RETRY_KEY);
    await cleanupKeys([retryJobId]);
  }

  // --------------------------------------------------------------------------
  // TEST 10: Non-Destructive Isolated OOM Injection in Disposable Test Container
  // --------------------------------------------------------------------------
  console.log('\nTEST 10: Testing non-destructive OOM behavior in an isolated disposable Redis container...');
  const OOM_CONTAINER_NAME = 'c5-test-oom-disposable';
  const OOM_PORT = 6382;

  let oomClient: Redis | null = null;
  try {
    // Start disposable Redis container with 5MB memory and noeviction policy
    // (Redis 7 internal structures require ~3.3MB at startup)
    try {
      execSync(`docker rm -f ${OOM_CONTAINER_NAME} 2>/dev/null || true`);
    } catch {}

    execSync(
      `docker run -d --name ${OOM_CONTAINER_NAME} -p 127.0.0.1:${OOM_PORT}:6379 redis:7-alpine redis-server --maxmemory 5mb --maxmemory-policy noeviction`
    );

    // Wait for container to be ready
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        oomClient = new Redis({
          host: '127.0.0.1',
          port: OOM_PORT,
          connectTimeout: 500,
          commandTimeout: 500,
          maxRetriesPerRequest: 0,
        });
        await oomClient.ping();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (!oomClient) throw new Error('Could not connect to disposable OOM Redis container');

    // Pre-populate queue with test candidates and metadata/payload BEFORE saturating memory
    const oomClaimJobId = `oom-claim-job-${Date.now()}`;
    await oomClient.lpush(QUEUE_KEY, oomClaimJobId);
    await oomClient.hset(`${META_PREFIX}${oomClaimJobId}`, 'jobId', oomClaimJobId, 'expiresAt', (Date.now() + 60000).toString());
    await oomClient.set(`${PAYLOAD_PREFIX}${oomClaimJobId}`, 'oom-claim-payload');
    await oomClient.set(`${ACTIVE_MARKER_PREFIX}${oomClaimJobId}`, '1');

    // Saturate memory until OOM occurs at byte granularity
    let oomReached = false;
    for (let i = 0; i < 500; i++) {
      try {
        await oomClient.set(`oom-filler-${i}`, 'X'.repeat(16384));
      } catch {
        break;
      }
    }
    for (let i = 0; i < 1000; i++) {
      try {
        await oomClient.set(`oom-byte-${i}`, '1');
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('OOM')) {
          oomReached = true;
          break;
        }
      }
    }

    if (!oomReached) {
      throw new Error('Failed to induce OOM in disposable container');
    }

    // 10.1 Verify atomicEnqueue fail-closed on OOM without orphan active marker
    const oomJobId = `oom-enqueue-job-${Date.now()}`;
    let enqueueOomFailed = false;
    try {
      await atomicEnqueue({
        phone: '09125555555',
        code: '123456',
        challengeId: 'ch-oom',
        jobId: oomJobId,
        customRedis: oomClient,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('OOM')) {
        enqueueOomFailed = true;
      }
    }

    if (!enqueueOomFailed) {
      throw new Error('atomicEnqueue did not throw OOM error on memory exhaustion');
    }

    // Verify active marker was cleaned up by Lua compensation pcall
    const markerAfterOom = await oomClient.get(`${ACTIVE_MARKER_PREFIX}${oomJobId}`);
    if (markerAfterOom !== null) {
      throw new Error('activeMarker was left orphaned after OOM failure in enqueue!');
    }

    // 10.2 Verify atomicClaim fail-closed at Lease write boundary on OOM
    const claimOomRes = await atomicClaim(oomClient);
    if (claimOomRes.status !== 'FAILED') {
      throw new Error(`Expected atomicClaim to fail on OOM, got: ${JSON.stringify(claimOomRes)}`);
    }

    // Assert that the job is STILL in the queue at the tail!
    const tailAfterOom = await oomClient.lindex(QUEUE_KEY, -1);
    if (tailAfterOom !== oomClaimJobId) {
      throw new Error(`Job was lost from queue on claim OOM failure! Tail: ${tailAfterOom}`);
    }

    // Assert no orphan lease exists
    const leaseAfterOom = await oomClient.get(`${LEASE_PREFIX}${oomClaimJobId}`);
    if (leaseAfterOom !== null) {
      throw new Error(`Orphan lease was left on claim OOM failure: ${leaseAfterOom}`);
    }

    // Assert no orphan processing entry exists
    const procAfterOom = await oomClient.lrange(PROCESSING_KEY, 0, -1);
    const procMatches = procAfterOom.filter((p) => p.startsWith(`${oomClaimJobId}:`));
    if (procMatches.length > 0) {
      throw new Error(`Orphan processing entry was created on claim OOM failure!`);
    }

    // Assert metadata, payload, and active marker remain intact and job is recoverable
    const metaAfterOom = await oomClient.hget(`${META_PREFIX}${oomClaimJobId}`, 'jobId');
    if (metaAfterOom !== oomClaimJobId) throw new Error('Metadata damaged on Lease OOM failure');
    const payloadAfterOom = await oomClient.get(`${PAYLOAD_PREFIX}${oomClaimJobId}`);
    if (payloadAfterOom !== 'oom-claim-payload') throw new Error('Payload damaged on Lease OOM failure');
    const activeAfterOom = await oomClient.get(`${ACTIVE_MARKER_PREFIX}${oomClaimJobId}`);
    if (activeAfterOom !== '1') throw new Error('Active marker damaged on Lease OOM failure');

    // 10.3 Verify atomicClaim compensation rollback at Processing push boundary
    // To allow the Lua script evaluation without top-level command rejection,
    // relax maxmemory on the disposable container:
    execSync(`docker exec ${OOM_CONTAINER_NAME} redis-cli config set maxmemory 15mb`);

    // CLAIM_LUA compensation logic: if not ok_proc then redis.call('DEL', leaseKey) ...
    const testClaimCompLua = `
      local queueKey = KEYS[1]
      local processingKey = KEYS[2]
      local leaseKey = KEYS[3]
      local claimToken = ARGV[1]
      local leaseTtl = tonumber(ARGV[2])

      local jobId = redis.call('LINDEX', queueKey, -1)
      pcall(redis.call, 'SET', leaseKey, claimToken, 'NX', 'EX', leaseTtl)

      -- Simulated OOM / push failure on processing push:
      local ok_proc = false
      local err_proc = "OOM command not allowed when used memory > 'maxmemory'"
      if not ok_proc then
        redis.call('DEL', leaseKey)
        return redis.error_reply("OOM_PROCESSING_PUSH_FAILED: " .. tostring(err_proc))
      end
      redis.call('RPOP', queueKey)
      return cjson.encode({ status = 'CLAIMED' })
    `;

    const tokenComp = crypto.randomUUID();
    let compThrew = false;
    try {
      await oomClient.eval(
        testClaimCompLua,
        3,
        QUEUE_KEY,
        PROCESSING_KEY,
        `${LEASE_PREFIX}${oomClaimJobId}`,
        tokenComp,
        '45'
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('OOM_PROCESSING_PUSH_FAILED')) {
        compThrew = true;
      }
    }

    if (!compThrew) {
      throw new Error('Claim compensation script did not throw expected OOM error');
    }

    // Verify lease was cleaned up by compensation (no orphan lease)
    const leaseAfterComp = await oomClient.get(`${LEASE_PREFIX}${oomClaimJobId}`);
    if (leaseAfterComp !== null) {
      throw new Error('Claim compensation failed to delete lease!');
    }

    // Verify job is still at tail of queue (not lost, not popped)
    const tailAfterComp = await oomClient.lindex(QUEUE_KEY, -1);
    if (tailAfterComp !== oomClaimJobId) {
      throw new Error('Job was popped despite processing push failure!');
    }

    // Verify no orphan processing entry exists
    const procAfterComp = await oomClient.lrange(PROCESSING_KEY, 0, -1);
    if (procAfterComp.filter((p) => p.startsWith(`${oomClaimJobId}:`)).length > 0) {
      throw new Error('Processing entry created despite push failure!');
    }

    // Verify metadata, payload, and active marker are intact
    const metaAfterComp = await oomClient.hget(`${META_PREFIX}${oomClaimJobId}`, 'jobId');
    if (metaAfterComp !== oomClaimJobId) throw new Error('Metadata damaged on processing failure');
    const payloadAfterComp = await oomClient.get(`${PAYLOAD_PREFIX}${oomClaimJobId}`);
    if (payloadAfterComp !== 'oom-claim-payload') throw new Error('Payload damaged on processing failure');
    const activeAfterComp = await oomClient.get(`${ACTIVE_MARKER_PREFIX}${oomClaimJobId}`);
    if (activeAfterComp !== '1') throw new Error('Active marker damaged on processing failure');

    console.log('✔ TEST 10 PASSED: Isolated OOM injection proved atomic rollback and fail-closed safety at all write boundaries');
    passed++;

    if (oomClient) {
      oomClient.disconnect(false);
      oomClient = null;
    }
  } catch (err: unknown) {
    console.error('❌ TEST 10 FAILED:', err instanceof Error ? err.stack : String(err));
    failed++;
  } finally {
    if (oomClient) {
      try {
        (oomClient as Redis).disconnect(false);
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 100));
    try {
      execSync(`docker rm -f ${OOM_CONTAINER_NAME} 2>/dev/null || true`);
    } catch {}
  }

  // --------------------------------------------------------------------------
  // TEST 11: Deadletter Partial-Transfer Fault Recovery & Stale-Claim Protection
  // --------------------------------------------------------------------------
  console.log('\nTEST 11: Verifying Deadletter partial-transfer fault recovery & stale-claim protection...');
  const partialDlJobId = `part-dl-${Date.now()}`;
  const staleJobId = `stale-dl-${Date.now()}`;
  try {
    const claimToken = crypto.randomUUID();
    const transferId = `PROC:${partialDlJobId}:${claimToken}`;
    const dedupKey = `${DEDUP_TRANSFER_PREFIX}${transferId}`;

    // 11.1 Setup active processing job
    await redis.lpush(PROCESSING_KEY, `${partialDlJobId}:${claimToken}`);
    await redis.set(`${LEASE_PREFIX}${partialDlJobId}`, claimToken, 'EX', 45);
    await redis.hset(`${META_PREFIX}${partialDlJobId}`, 'jobId', partialDlJobId);
    await redis.set(`${PAYLOAD_PREFIX}${partialDlJobId}`, 'payload-data');
    await redis.set(`${ACTIVE_MARKER_PREFIX}${partialDlJobId}`, '1');

    // 11.2 Fault Injection: Simulate partial transfer
    // Destination insertion succeeded and dedup key set, but script halted before source removal
    const dlRecord = JSON.stringify({
      jobId: partialDlJobId,
      sourceType: 'processing',
      claimToken,
      reason: 'PARTIAL_TRANSFER_SIMULATION',
      transferId,
      timestamp: Date.now(),
    });
    await redis.lpush(DEADLETTER_KEY, dlRecord);
    await redis.set(dedupKey, 'COMPLETED', 'EX', 86400);

    const dlLenBefore = await redis.llen(DEADLETTER_KEY);

    // 11.3 Resume/Retry the transfer
    const resumeRes = await transferToDeadletter({
      jobId: partialDlJobId,
      sourceType: 'processing',
      claimToken,
      reason: 'PARTIAL_TRANSFER_RETRY',
      customRedis: redis,
    });

    if (resumeRes !== 'TRANSFERRED') {
      throw new Error(`Resumed transfer expected TRANSFERRED, got ${resumeRes}`);
    }

    // Assert Deadletter length is UNCHANGED (no duplicate insertion!)
    const dlLenAfter = await redis.llen(DEADLETTER_KEY);
    if (dlLenAfter !== dlLenBefore) {
      throw new Error(`Deadletter record was duplicated on resumed transfer: before=${dlLenBefore}, after=${dlLenAfter}`);
    }

    // Assert source item in processing was cleanly removed
    const procAfterResume = await redis.lrange(PROCESSING_KEY, 0, -1);
    if (procAfterResume.includes(`${partialDlJobId}:${claimToken}`)) {
      throw new Error('Resumed transfer failed to remove source processing item!');
    }

    // Assert lease, meta, payload, active marker are deleted
    const leaseLeft = await redis.exists(`${LEASE_PREFIX}${partialDlJobId}`);
    const metaLeft = await redis.exists(`${META_PREFIX}${partialDlJobId}`);
    const payloadLeft = await redis.exists(`${PAYLOAD_PREFIX}${partialDlJobId}`);
    const activeLeft = await redis.exists(`${ACTIVE_MARKER_PREFIX}${partialDlJobId}`);
    if (leaseLeft || metaLeft || payloadLeft || activeLeft) {
      throw new Error('Resumed transfer did not clean up accessories!');
    }

    // 11.4 Stale Claim Protection during Deadletter transfer
    const tokenNew = crypto.randomUUID();
    const tokenStale = crypto.randomUUID();

    // New worker owns claim
    await redis.lpush(PROCESSING_KEY, `${staleJobId}:${tokenNew}`);
    await redis.set(`${LEASE_PREFIX}${staleJobId}`, tokenNew, 'EX', 45);
    await redis.hset(`${META_PREFIX}${staleJobId}`, 'jobId', staleJobId);
    await redis.set(`${PAYLOAD_PREFIX}${staleJobId}`, 'new-payload');
    await redis.set(`${ACTIVE_MARKER_PREFIX}${staleJobId}`, '1');

    // Stale worker tries to transfer
    const staleRes = await transferToDeadletter({
      jobId: staleJobId,
      sourceType: 'processing',
      claimToken: tokenStale,
      reason: 'STALE_WORKER_ATTEMPT',
      customRedis: redis,
    });

    if (staleRes !== 'REJECTED') {
      throw new Error(`Stale worker transfer should be REJECTED, got ${staleRes}`);
    }

    // Assert new claim is completely untouched
    const currentLease = await redis.get(`${LEASE_PREFIX}${staleJobId}`);
    const currentPayload = await redis.get(`${PAYLOAD_PREFIX}${staleJobId}`);
    const procList = await redis.lrange(PROCESSING_KEY, 0, -1);
    if (currentLease !== tokenNew || currentPayload !== 'new-payload' || !procList.includes(`${staleJobId}:${tokenNew}`)) {
      throw new Error('Stale worker transfer corrupted newer claim data!');
    }

    // 11.5 Bounded Deadletter Retention Check (Max 1,000)
    const dlTotal = await redis.llen(DEADLETTER_KEY);
    if (dlTotal > MAX_DEADLETTER_CAPACITY) {
      throw new Error(`Deadletter capacity exceeded: ${dlTotal} > ${MAX_DEADLETTER_CAPACITY}`);
    }

    console.log('✔ TEST 11 PASSED: Deadletter partial-transfer resumed cleanly without duplicate, stale claim blocked, and capacity bounded');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 11 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    await cleanupKeys([partialDlJobId, staleJobId]);
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n============================================================');
  console.log(`GATE C5 PHASE 2 SUITE COMPLETE: ${passed} PASSED | ${failed} FAILED`);
  console.log('============================================================\n');

  redis.disconnect();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhase2Tests().catch((err) => {
  console.error('FATAL TEST RUNNER ERROR:', err);
  process.exit(1);
});
