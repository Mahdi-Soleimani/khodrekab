import assert from 'assert';
import { prisma } from '../src/lib/prisma';
import { POST as registerHandler } from '../src/app/api/waitlist/register/route';
import { getRedisClient } from '../src/lib/security/redis';
import crypto from 'crypto';

async function runConcurrentRegisterTest() {
  console.log('====================================================');
  console.log('   C2 CONCURRENT REGISTRATION TEST (10 PARALLEL)    ');
  console.log('====================================================\n');

  // Generate unique test phone
  const testPhone = '0901' + Math.floor(1000000 + Math.random() * 9000000).toString();
  console.log(`[TEST_TARGET] Using phone: ${testPhone}`);

  // Helper to clean up
  async function cleanup() {
    await prisma.oTPVerification.deleteMany({ where: { phone: testPhone } });
    try {
      const redis = getRedisClient();
      if (redis) {
        const phoneHash = crypto.createHash('sha256').update(testPhone).digest('hex').substring(0, 16);
        const keys = await redis.keys(`*${phoneHash}*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }
    } catch {
      // ignore
    }
  }

  await cleanup();

  function makeRegisterReq(ip: string) {
    return new Request('http://localhost:3000/api/waitlist/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': 'localhost:3000',
        'Origin': 'http://localhost:3000',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({
        phone: testPhone,
        fillTimeMs: 2500, // bypass honeypot
      }),
    });
  }

  // Fire 10 parallel register requests for the exact same phone with different client IPs
  // to isolate phone-level concurrency from IP-level throttling
  const concurrency = 10;
  console.log(`[EXECUTION] Firing ${concurrency} simultaneous POST /api/waitlist/register requests...`);

  const promises = Array.from({ length: concurrency }, (_, idx) =>
    registerHandler(makeRegisterReq(`127.0.0.${10 + idx}`))
  );

  const responses = await Promise.all(promises);
  const statuses = responses.map((r) => r.status);

  const status200 = statuses.filter((s) => s === 200).length;
  const status429 = statuses.filter((s) => s === 429).length;
  const otherStatuses = statuses.filter((s) => s !== 200 && s !== 429).length;

  console.log(`[HTTP_RESPONSES] 200 OK: ${status200}, 429 Cooldown/Rate-Limited: ${status429}, Other: ${otherStatuses}`);

  // Inspect database records for this phone
  const allRecords = await prisma.oTPVerification.findMany({
    where: { phone: testPhone },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`[DB_INSPECTION] Total OTP records created: ${allRecords.length}`);
  for (const r of allRecords) {
    console.log(`  - Record ${r.id}: verified=${r.verified}, expiresAt=${r.expiresAt.toISOString()}, isExpired=${r.expiresAt <= new Date()}`);
  }

  const activeRecords = allRecords.filter(
    (r) => r.verified === false && r.expiresAt > new Date()
  );
  console.log(`[DB_INSPECTION] Active (unverified & unexpired) OTP records: ${activeRecords.length}`);

  // Assertions:
  // 1. Phone rate limiting / cooldown guarantees at most 1 request can succeed in parallel burst
  assert.strictEqual(status200, 1, `Expected exactly 1 request to succeed with 200, got ${status200}`);
  assert.strictEqual(status429, concurrency - 1, `Expected all other ${concurrency - 1} requests to receive 429 cooldown, got ${status429}`);

  // 2. Exactly 1 active challenge exists in DB
  assert.strictEqual(activeRecords.length, 1, `Expected exactly 1 active challenge in DB, got ${activeRecords.length}`);

  // 3. verified status is strictly false
  assert.strictEqual(activeRecords[0].verified, false, 'Active challenge MUST have verified = false');

  // 4. Expiration is 5 minutes in future
  assert.ok(activeRecords[0].expiresAt > new Date(), 'Active challenge must have valid future expiration');

  // 5. Total records in DB equals exactly 1 (no dangling unexpired or orphaned challenges)
  assert.strictEqual(allRecords.length, 1, `Expected exactly 1 record in DB, got ${allRecords.length}`);

  // 6. Cleanup synthetic data
  await cleanup();
  console.log('[CLEANUP] Synthetic test data cleaned up successfully.');
  console.log('\n====================================================');
  console.log('   CONCURRENT REGISTRATION TEST PASSED (0 INCONSISTENCIES)');
  console.log('====================================================\n');
}

runConcurrentRegisterTest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Concurrent register test failed:', e);
    process.exit(1);
  });
