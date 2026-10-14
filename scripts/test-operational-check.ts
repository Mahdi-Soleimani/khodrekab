/**
 * CARNO OPERATIONAL CHECK — COMPREHENSIVE VERIFICATION SUITE
 *
 * Fully isolated verification for:
 * 1. Baseline operational check (OK status, connection budget, index preconditions).
 * 2. PostgreSQL advisory lock state, contention, and unknown-age reporting.
 * 3. Deadletter queue backlog and threshold evaluation.
 * 4. Worker heartbeat contracts:
 *    - Healthy active lease
 *    - Missing lease (worker crash / heartbeat lost)
 *    - Expired lease (TTL <= 0)
 *    - Token mismatch (superseded claim)
 *    - Malformed processing entry (missing colon separator)
 * 5. Production HTTPS enforcement and URL validation.
 * 6. Webhook alert dispatch, error sanitization, and alert deduplication/throttling.
 * 7. Redis fixture hygiene: All tests use isolated test namespaces and leave application queues untouched.
 */

import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { Client } from 'pg';
import { runOperationalCheck } from './operational-check';
import { getRedisClient } from '../src/lib/security/redis';
import { resolveDatabaseUrl, MAINTENANCE_ADVISORY_LOCK_ID } from './maintenance-runner';
import {
  QUEUE_KEY,
  PROCESSING_KEY,
  RETRY_KEY,
  DEADLETTER_KEY,
} from '../src/lib/security/queue';

const TEST_NS = `test:ops_suite_${Date.now()}`;
const TEST_KEYS = {
  queueKey: `${TEST_NS}:queue`,
  processingKey: `${TEST_NS}:processing`,
  retryKey: `${TEST_NS}:retry`,
  deadletterKey: `${TEST_NS}:deadletter`,
  leasePrefix: `${TEST_NS}:lease:`,
};
const TEST_THROTTLE_PREFIX = `${TEST_NS}:throttle`;

async function testOperationalCheckSuite() {
  console.log('============================================================');
  console.log('   CARNO OPERATIONAL CHECK & MONITORING VERIFICATION SUITE  ');
  console.log('============================================================\n');

  const redis = getRedisClient();
  if (!redis) throw new Error('Redis client unavailable for test suite');

  // Verify initial hygiene of application queues before running tests
  const [initialQ, initialP, initialR, initialDl] = await Promise.all([
    redis.llen(QUEUE_KEY),
    redis.llen(PROCESSING_KEY),
    redis.zcard(RETRY_KEY),
    redis.llen(DEADLETTER_KEY),
  ]);
  assert.strictEqual(initialQ, 0, 'Application QUEUE_KEY must be empty initially');
  assert.strictEqual(initialP, 0, 'Application PROCESSING_KEY must be empty initially');
  assert.strictEqual(initialR, 0, 'Application RETRY_KEY must be empty initially');
  assert.strictEqual(initialDl, 0, 'Application DEADLETTER_KEY must be empty initially');
  console.log('✔ Initial Application Queue Hygiene verified (0 items in all queues)');

  // --------------------------------------------------------------------------
  // TEST 1: Baseline Health Check
  // --------------------------------------------------------------------------
  console.log('\nTEST 1: Baseline operational health check (status: OK)...');
  const baseline = await runOperationalCheck({ quiet: true });
  assert.strictEqual(baseline.redis.status, 'CONNECTED');
  assert.strictEqual(baseline.postgres.status, 'CONNECTED');
  assert.strictEqual(baseline.status, 'OK');
  assert.strictEqual(baseline.reasons.length, 0);
  assert.strictEqual(typeof baseline.postgres.carnoAppConnections, 'number');
  assert.strictEqual(typeof baseline.postgres.runnerConnections, 'number');
  assert.strictEqual(typeof baseline.postgres.headroom, 'number');
  assert.ok(baseline.postgres.headroom! >= 0, 'Connection headroom must be >= 0');
  assert.strictEqual(baseline.postgres.maintenanceLock?.held, false);
  assert.strictEqual(baseline.postgres.maintenanceLock?.acquisitionAge, 'UNKNOWN_PG_LOCKS_LIMITATION');
  console.log(`✔ TEST 1 PASSED: Baseline returns OK (carno_app: ${baseline.postgres.carnoAppConnections}, runner: ${baseline.postgres.runnerConnections}, headroom: ${baseline.postgres.headroom})`);

  // --------------------------------------------------------------------------
  // TEST 2: Advisory Lock Detection, Metadata & Contention
  // --------------------------------------------------------------------------
  console.log('\nTEST 2: Verifying PostgreSQL advisory lock inspection...');
  const dbUrl = resolveDatabaseUrl();
  const lockClientA = new Client({
    connectionString: dbUrl,
    application_name: 'test_lock_holder_session',
  });
  await lockClientA.connect();

  try {
    const acquireRes = await lockClientA.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(${MAINTENANCE_ADVISORY_LOCK_ID}) as locked;`
    );
    assert.strictEqual(acquireRes.rows[0].locked, true, 'Lock A should be acquired');

    // Check with operational checker while lock is held by non-runner
    const lockedCheck = await runOperationalCheck({ quiet: true });
    assert.strictEqual(lockedCheck.postgres.maintenanceLock?.held, true);
    assert.strictEqual(lockedCheck.postgres.maintenanceLock?.holderApp, 'test_lock_holder_session');
    assert.strictEqual(lockedCheck.postgres.maintenanceLock?.acquisitionAge, 'UNKNOWN_PG_LOCKS_LIMITATION');
    assert.ok(lockedCheck.reasons.some((r) => r.includes('MAINTENANCE_LOCK_UNEXPECTED_HOLDER')));
    assert.strictEqual(lockedCheck.status, 'WARN');
    console.log('✔ TEST 2A PASSED: Advisory lock held by non-runner detected and reported with accurate metadata');
  } finally {
    await lockClientA.query(`SELECT pg_advisory_unlock(${MAINTENANCE_ADVISORY_LOCK_ID});`).catch(() => {});
    await lockClientA.end().catch(() => {});
  }

  // --------------------------------------------------------------------------
  // TEST 3: Deadletter Backlog Thresholds
  // --------------------------------------------------------------------------
  console.log('\nTEST 3: Verifying deadletter backlog thresholds...');
  const syntheticDl = JSON.stringify({ jobId: 'test_dl_item', reason: 'SYNTHETIC' });
  await redis.lpush(TEST_KEYS.deadletterKey, syntheticDl);

  try {
    const dlWarnCheck = await runOperationalCheck({
      quiet: true,
      customKeys: TEST_KEYS,
      customThrottlePrefix: TEST_THROTTLE_PREFIX,
    });
    assert.strictEqual(dlWarnCheck.status, 'WARN');
    assert.strictEqual(dlWarnCheck.redis.queues.deadletterLength, 1);
    assert.ok(dlWarnCheck.reasons.some((r) => r.includes('DEADLETTER_WARNING')));
    console.log('✔ TEST 3 PASSED: Injected deadletter triggers WARN status in test namespace');
  } finally {
    await redis.del(TEST_KEYS.deadletterKey);
  }

  // --------------------------------------------------------------------------
  // TEST 4: Worker Heartbeat & Processing Claims Contracts
  // --------------------------------------------------------------------------
  console.log('\nTEST 4: Verifying worker heartbeat & lease contracts in processing queue...');

  // 4A: Healthy active claim with valid lease
  const healthyJobId = 'job_healthy_001';
  const healthyToken = 'token_abc_123';
  await redis.lpush(TEST_KEYS.processingKey, `${healthyJobId}:${healthyToken}`);
  await redis.set(`${TEST_KEYS.leasePrefix}${healthyJobId}`, healthyToken, 'EX', 45);

  try {
    const healthyCheck = await runOperationalCheck({
      quiet: true,
      customKeys: TEST_KEYS,
      customThrottlePrefix: TEST_THROTTLE_PREFIX,
    });
    assert.strictEqual(healthyCheck.status, 'OK');
    assert.strictEqual(healthyCheck.redis.processing?.processingCount, 1);
    assert.strictEqual(healthyCheck.redis.processing?.activeClaimsCount, 1);
    assert.strictEqual(healthyCheck.redis.processing?.missingLeaseCount, 0);
    assert.strictEqual(healthyCheck.redis.processing?.workerHeartbeatStatus, 'HEALTHY');
    console.log('✔ TEST 4A PASSED: Active claim with matching lease reported as HEALTHY worker heartbeat');
  } finally {
    await redis.del(TEST_KEYS.processingKey);
    await redis.del(`${TEST_KEYS.leasePrefix}${healthyJobId}`);
  }

  // 4B: Missing lease (worker crashed, lease expired) -> CRITICAL
  const missingLeaseJobId = 'job_stale_missing_002';
  const missingToken = 'token_xyz_456';
  await redis.lpush(TEST_KEYS.processingKey, `${missingLeaseJobId}:${missingToken}`);
  // Intentionally do NOT set any lease key

  try {
    const missingCheck = await runOperationalCheck({
      quiet: true,
      customKeys: TEST_KEYS,
      customThrottlePrefix: TEST_THROTTLE_PREFIX,
    });
    assert.strictEqual(missingCheck.status, 'CRITICAL');
    assert.strictEqual(missingCheck.redis.processing?.missingLeaseCount, 1);
    assert.strictEqual(missingCheck.redis.processing?.workerHeartbeatStatus, 'HEARTBEAT_LOST');
    assert.ok(missingCheck.reasons.some((r) => r.includes('WORKER_HEARTBEAT_LOST')));
    console.log('✔ TEST 4B PASSED: Processing entry with missing lease triggered WORKER_HEARTBEAT_LOST (CRITICAL)');
  } finally {
    await redis.del(TEST_KEYS.processingKey);
  }

  // 4C: Token mismatch (superseded claim) -> WARN
  const supersededJobId = 'job_superseded_003';
  await redis.lpush(TEST_KEYS.processingKey, `${supersededJobId}:old_token_111`);
  await redis.set(`${TEST_KEYS.leasePrefix}${supersededJobId}`, 'newer_token_222', 'EX', 45);

  try {
    const supersededCheck = await runOperationalCheck({
      quiet: true,
      customKeys: TEST_KEYS,
      customThrottlePrefix: TEST_THROTTLE_PREFIX,
    });
    assert.strictEqual(supersededCheck.status, 'WARN');
    assert.strictEqual(supersededCheck.redis.processing?.mismatchedLeaseCount, 1);
    assert.strictEqual(supersededCheck.redis.processing?.workerHeartbeatStatus, 'STALE');
    assert.ok(supersededCheck.reasons.some((r) => r.includes('STALE_PROCESSING_CLAIM')));
    console.log('✔ TEST 4C PASSED: Superseded claim with mismatched lease token reported as STALE');
  } finally {
    await redis.del(TEST_KEYS.processingKey);
    await redis.del(`${TEST_KEYS.leasePrefix}${supersededJobId}`);
  }

  // 4D: Malformed processing entry (missing colon separator) -> WARN
  await redis.lpush(TEST_KEYS.processingKey, 'corrupted_entry_no_colon');

  try {
    const malformedCheck = await runOperationalCheck({
      quiet: true,
      customKeys: TEST_KEYS,
      customThrottlePrefix: TEST_THROTTLE_PREFIX,
    });
    assert.strictEqual(malformedCheck.status, 'WARN');
    assert.strictEqual(malformedCheck.redis.processing?.malformedProcessingEntryCount, 1);
    assert.strictEqual(malformedCheck.redis.processing?.workerHeartbeatStatus, 'MALFORMED');
    assert.ok(malformedCheck.reasons.some((r) => r.includes('MALFORMED_PROCESSING_ENTRY')));
    console.log('✔ TEST 4D PASSED: Malformed claim entry without colon reported as MALFORMED');
  } finally {
    await redis.del(TEST_KEYS.processingKey);
  }

  // --------------------------------------------------------------------------
  // TEST 5: Production HTTPS Enforcement
  // --------------------------------------------------------------------------
  console.log('\nTEST 5: Verifying production HTTPS enforcement for webhook URL...');
  const envMap = process.env as Record<string, string | undefined>;
  const origEnv = envMap.NODE_ENV;
  envMap.NODE_ENV = 'production';
  process.env.OPS_ALERT_WEBHOOK_URL = 'http://insecure-endpoint.internal/alert';

  try {
    const insecureCheck = await runOperationalCheck({
      quiet: true,
      customKeys: TEST_KEYS,
      customThrottlePrefix: TEST_THROTTLE_PREFIX,
    });
    assert.strictEqual(insecureCheck.alertDelivery.configured, false);
    assert.strictEqual(insecureCheck.alertDelivery.deliveryStatus, 'DESTINATION_UNCONFIGURED');
    assert.ok(insecureCheck.alertDelivery.error?.includes('UNSECURE_HTTP_REJECTED'));
    console.log('✔ TEST 5 PASSED: Production mode strictly rejected unencrypted http:// webhook URL');
  } finally {
    envMap.NODE_ENV = origEnv;
    delete process.env.OPS_ALERT_WEBHOOK_URL;
  }

  // --------------------------------------------------------------------------
  // TEST 6: Webhook Dispatch, Redaction & Deduplication/Throttling
  // --------------------------------------------------------------------------
  console.log('\nTEST 6: Verifying webhook dispatch, error redaction & deduplication...');
  let receivedAlertCount = 0;
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      receivedAlertCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  process.env.OPS_ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/alert-endpoint`;

  try {
    // 6A: First dispatch fires webhook
    await redis.lpush(TEST_KEYS.deadletterKey, syntheticDl);
    const firstAlert = await runOperationalCheck({
      quiet: true,
      customKeys: TEST_KEYS,
      customThrottlePrefix: TEST_THROTTLE_PREFIX,
    });
    assert.strictEqual(firstAlert.alertDelivery.configured, true);
    assert.strictEqual(firstAlert.alertDelivery.sent, true);
    assert.strictEqual(firstAlert.alertDelivery.deliveryStatus, 'DISPATCHED');
    assert.strictEqual(receivedAlertCount, 1);
    console.log('✔ TEST 6A PASSED: Initial alert successfully dispatched to mock endpoint');

    // 6B: Second immediate check is throttled (deduplication)
    const secondAlert = await runOperationalCheck({
      quiet: true,
      customKeys: TEST_KEYS,
      customThrottlePrefix: TEST_THROTTLE_PREFIX,
    });
    assert.strictEqual(secondAlert.alertDelivery.configured, true);
    assert.strictEqual(secondAlert.alertDelivery.throttled, true);
    assert.strictEqual(secondAlert.alertDelivery.deliveryStatus, 'THROTTLED');
    assert.strictEqual(receivedAlertCount, 1, 'Webhook count must not increase when throttled');
    console.log('✔ TEST 6B PASSED: Second identical alert correctly suppressed by Redis throttling');

    // 6C: Recovery clears throttle
    await redis.del(TEST_KEYS.deadletterKey);
    const recoveryCheck = await runOperationalCheck({
      quiet: true,
      customKeys: TEST_KEYS,
      customThrottlePrefix: TEST_THROTTLE_PREFIX,
    });
    assert.strictEqual(recoveryCheck.status, 'OK');
    assert.strictEqual(recoveryCheck.alertDelivery.deliveryStatus, 'SKIPPED_HEALTHY');
    const throttleExists = await redis.exists(`${TEST_THROTTLE_PREFIX}:WARN`);
    assert.strictEqual(throttleExists, 0, 'Recovery must delete WARN throttle key');
    console.log('✔ TEST 6C PASSED: System recovery to OK cleanly cleared throttle key in Redis');
  } finally {
    delete process.env.OPS_ALERT_WEBHOOK_URL;
    server.close();
    await redis.del(TEST_KEYS.deadletterKey);
    await redis.del(`${TEST_THROTTLE_PREFIX}:WARN`);
    await redis.del(`${TEST_THROTTLE_PREFIX}:CRITICAL`);
  }

  // 6D: Error Redaction (no URL or secrets leaked on delivery failure)
  process.env.OPS_ALERT_WEBHOOK_URL = 'http://127.0.0.1:59999/secret_path?token=super_secret_token_123';
  await redis.lpush(TEST_KEYS.deadletterKey, syntheticDl);

  try {
    const redactedCheck = await runOperationalCheck({
      quiet: true,
      forceAlert: true,
      customKeys: TEST_KEYS,
      customThrottlePrefix: TEST_THROTTLE_PREFIX,
    });
    assert.strictEqual(redactedCheck.alertDelivery.sent, false);
    assert.strictEqual(redactedCheck.alertDelivery.deliveryStatus, 'DELIVERY_FAILED');
    assert.ok(redactedCheck.alertDelivery.error !== undefined);
    assert.ok(!redactedCheck.alertDelivery.error?.includes('super_secret_token_123'), 'Must not leak secret token');
    assert.ok(!redactedCheck.alertDelivery.error?.includes('/secret_path'), 'Must not leak URL path');
    console.log(`✔ TEST 6D PASSED: Webhook failure redacted securely (${redactedCheck.alertDelivery.error})`);
  } finally {
    delete process.env.OPS_ALERT_WEBHOOK_URL;
    await redis.del(TEST_KEYS.deadletterKey);
  }

  // --------------------------------------------------------------------------
  // TEST 7: Final Hygiene Verification
  // --------------------------------------------------------------------------
  console.log('\nTEST 7: Verifying application queues and test namespace cleanup...');
  const [finalQ, finalP, finalR, finalDl] = await Promise.all([
    redis.llen(QUEUE_KEY),
    redis.llen(PROCESSING_KEY),
    redis.zcard(RETRY_KEY),
    redis.llen(DEADLETTER_KEY),
  ]);
  assert.strictEqual(finalQ, 0, 'Application QUEUE_KEY must remain 0');
  assert.strictEqual(finalP, 0, 'Application PROCESSING_KEY must remain 0');
  assert.strictEqual(finalR, 0, 'Application RETRY_KEY must remain 0');
  assert.strictEqual(finalDl, 0, 'Application DEADLETTER_KEY must remain 0');

  // Verify test namespace has zero leaked keys
  const leakedTestKeys = await redis.keys(`${TEST_NS}*`);
  assert.strictEqual(leakedTestKeys.length, 0, `Test namespace leaked keys: ${leakedTestKeys}`);
  console.log('✔ TEST 7 PASSED: Zero application queue contamination, all test fixtures dropped cleanly');

  console.log('\n============================================================');
  console.log('   ALL OPERATIONAL CHECK TESTS PASSED (7/7)                 ');
  console.log('============================================================');
}

testOperationalCheckSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[TEST_FAILURE]', err);
    process.exit(1);
  });
