import assert from 'assert';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { POST as registerHandler } from '../src/app/api/waitlist/register/route';
import { POST as verifyHandler } from '../src/app/api/waitlist/verify/route';
import { computeOtpHash } from '../src/lib/security/otp';

async function runC2ConcurrencySuite() {
  console.log('====================================================');
  console.log('   CARNO GATE C2 CONCURRENCY & RACE TEST SUITE     ');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [FAIL] ${name}:`, msg);
      throw err;
    }
  }

  // Setup environment variables for test
  if (!process.env.JWT_SECRET && !process.env.JWT_DEV_SECRET) {
    process.env.JWT_DEV_SECRET = 'test-secret-min-16-chars-c2-hardening';
  }
  if (!process.env.SMS_ENCRYPTION_KEY) {
    process.env.SMS_ENCRYPTION_KEY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  }
  process.env.TRUSTED_IP_HEADER = 'x-forwarded-for';
  process.env.TRUSTED_PROXY_CIDRS = '127.0.0.1/32';

  // Helper to build a verify Request object
  function makeVerifyRequest(phone: string, otp: string, referredByCode?: string) {
    return new Request('http://localhost:3000/api/waitlist/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': 'localhost:3000',
        'Origin': 'http://localhost:3000',
        'x-forwarded-for': '127.0.0.1',
      },
      body: JSON.stringify({
        phone,
        otp,
        referredByCode,
        source: 'concurrency_test',
      }),
    });
  }

  // Helper to build a register Request object
  function makeRegisterRequest(phone: string, ip: string = '127.0.0.1') {
    return new Request('http://localhost:3000/api/waitlist/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': 'localhost:3000',
        'Origin': 'http://localhost:3000',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({
        phone,
        fillTimeMs: 2500, // bypass honeypot timing
      }),
    });
  }

  // Clean up helper
  async function cleanupPhone(phone: string) {
    const user = await prisma.user.findUnique({ where: { phone } });
    if (user) {
      await prisma.referral.deleteMany({
        where: { OR: [{ inviterId: user.id }, { invitedUserId: user.id }] },
      });
      await prisma.paymentLog.deleteMany({
        where: { payment: { userId: user.id } },
      });
      await prisma.paymentIntent.deleteMany({
        where: { userId: user.id },
      });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.waitlistEntry.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.oTPVerification.deleteMany({ where: { phone } });

    // Clean up Redis rate-limiting keys
    try {
      const { getRedisClient } = await import('../src/lib/security/redis');
      const cryptoMod = await import('crypto');
      const redis = getRedisClient();
      if (redis) {
        const phoneHash = cryptoMod.createHash('sha256').update(phone).digest('hex').substring(0, 16);
        const keys = await redis.keys(`*${phoneHash}*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }
    } catch {
      // ignore redis cleanup error
    }
  }

  function genTestPhone(): string {
    return '0901' + Math.floor(1000000 + Math.random() * 9000000).toString();
  }

  // ---------------------------------------------------------------------------
  // TEST 1: Concurrent OTP Replay Protection (Parallel Attack)
  // ---------------------------------------------------------------------------
  await test('1. Concurrent OTP Replay Attack: Exactly 1 of N parallel requests succeeds', async () => {
    const testPhone = genTestPhone();
    await cleanupPhone(testPhone);

    const otpCode = '54321';
    const challengeId = 'chal_replay_' + Date.now();
    const expiry = new Date(Date.now() + 5 * 60 * 1000);
    const codeHash = computeOtpHash(testPhone, challengeId, otpCode);

    await prisma.oTPVerification.create({
      data: {
        id: challengeId,
        phone: testPhone,
        codeHash,
        expiresAt: expiry,
        verified: false,
        attempts: 0,
        pepperVersion: 1,
      },
    });

    // Fire 10 parallel verify requests simultaneously
    const concurrencyLevel = 10;
    const promises = Array.from({ length: concurrencyLevel }, () =>
      verifyHandler(makeVerifyRequest(testPhone, otpCode))
    );

    const responses = await Promise.all(promises);
    const statuses = responses.map((r) => r.status);

    const successCount = statuses.filter((s) => s === 200).length;
    const replayBlockedCount = statuses.filter((s) => s === 409).length;
    const lateReadBlockedCount = statuses.filter((s) => s === 400).length;

    console.log(`    -> Status distribution: 200 OK: ${successCount}, 409 In-Flight Conflict: ${replayBlockedCount}, 400 Consumed/Expired: ${lateReadBlockedCount}`);

    assert.strictEqual(
      successCount,
      1,
      `Expected exactly 1 request to succeed with 200, got ${successCount}. Statuses: ${JSON.stringify(statuses)}`
    );
    assert.strictEqual(
      replayBlockedCount + lateReadBlockedCount,
      concurrencyLevel - 1,
      `Expected all ${concurrencyLevel - 1} other requests to be rejected (409 or 400), got ${replayBlockedCount + lateReadBlockedCount}`
    );

    // Verify DB state
    const record = await prisma.oTPVerification.findUnique({ where: { id: challengeId } });
    assert.ok(record, 'Challenge record must exist');
    assert.strictEqual(record.verified, true, 'Challenge must be marked verified');

    // 1b. Direct atomic updateMany race test (10 parallel workers racing on same challenge ID)
    const directChallengeId = 'chal_direct_race_' + Date.now();
    await prisma.oTPVerification.create({
      data: {
        id: directChallengeId,
        phone: testPhone,
        codeHash: 'hash_direct',
        expiresAt: expiry,
        verified: false,
        attempts: 0,
        pepperVersion: 1,
      },
    });

    const directRaceResults = await Promise.all(
      Array.from({ length: 10 }, () =>
        prisma.oTPVerification.updateMany({
          where: { id: directChallengeId, verified: false },
          data: { verified: true, attempts: { increment: 1 } },
        })
      )
    );

    const directWinners = directRaceResults.filter((r) => r.count === 1).length;
    const directLosers = directRaceResults.filter((r) => r.count === 0).length;

    console.log(`    -> Direct atomic updateMany race: count=1 winners: ${directWinners}, count=0 losers: ${directLosers}`);
    assert.strictEqual(directWinners, 1, `Expected exactly 1 updateMany winner, got ${directWinners}`);
    assert.strictEqual(directLosers, 9, `Expected exactly 9 updateMany losers (blocked), got ${directLosers}`);

    await cleanupPhone(testPhone);
  });

  // ---------------------------------------------------------------------------
  // TEST 2: Redis Enqueue Failure Handling During Registration
  // ---------------------------------------------------------------------------
  await test('2. Redis Enqueue Failure: Invalidate OTP with verified=false and return 503', async () => {
    const testPhone = genTestPhone();
    await cleanupPhone(testPhone);

    const { closeRedisConnection } = await import('../src/lib/security/redis');
    await closeRedisConnection();
    const originalRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://127.0.0.1:59999'; // unreachable port

    try {
      const res = await registerHandler(makeRegisterRequest(testPhone));
      assert.strictEqual(res.status, 503, `Expected 503 on Redis failure, got ${res.status}`);
      const body = await res.json();
      assert.ok(body.error, 'Must return error message in body');

      // Check DB challenge state
      const challenge = await prisma.oTPVerification.findFirst({
        where: { phone: testPhone },
        orderBy: { createdAt: 'desc' },
      });

      assert.ok(challenge, 'Challenge record should exist in DB');
      assert.strictEqual(challenge.verified, false, 'CRITICAL: verified must remain FALSE on queue failure');
      assert.ok(
        challenge.expiresAt <= new Date(),
        `CRITICAL: expiresAt must be expired immediately (<= now). expiresAt: ${challenge.expiresAt.toISOString()}`
      );

      // Verify that attempting to verify this challenge fails with 400
      const verifyRes = await verifyHandler(makeVerifyRequest(testPhone, '12345'));
      assert.strictEqual(verifyRes.status, 400, 'Expired challenge must not be verifiable');
    } finally {
      await closeRedisConnection();
      process.env.REDIS_URL = originalRedisUrl || 'redis://localhost:6380';
      const { getRedisClient, isRedisAvailable } = await import('../src/lib/security/redis');
      getRedisClient();
      await isRedisAvailable();
      await cleanupPhone(testPhone);
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 3: Invalidation of Prior Unverified Challenges Without Marking Verified
  // ---------------------------------------------------------------------------
  await test('3. Prior Challenges Invalidation: Previous challenges expired without setting verified=true', async () => {
    const testPhone = genTestPhone();
    await cleanupPhone(testPhone);

    // Create prior challenge manually
    const priorId = 'prior_chal_' + Date.now();
    await prisma.oTPVerification.create({
      data: {
        id: priorId,
        phone: testPhone,
        codeHash: 'hash_prior',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        verified: false,
        attempts: 0,
      },
    });

    // Fire new register request with dedicated client IP
    const res = await registerHandler(makeRegisterRequest(testPhone, '127.0.0.103'));
    assert.strictEqual(res.status, 200, `Register should succeed, got ${res.status}`);

    // Verify prior challenge in DB
    const priorRecord = await prisma.oTPVerification.findUnique({ where: { id: priorId } });
    assert.ok(priorRecord, 'Prior record must exist');
    assert.strictEqual(priorRecord.verified, false, 'Prior challenge verified must remain FALSE');
    assert.ok(
      priorRecord.expiresAt <= new Date(),
      'Prior challenge expiresAt must be in the past'
    );

    await cleanupPhone(testPhone);
  });

  // ---------------------------------------------------------------------------
  // TEST 4: Concurrent User Creation (P2002 Race Condition Handling)
  // ---------------------------------------------------------------------------
  await test('4. Concurrent User Creation: Parallel creations resolve cleanly without P2002 failure', async () => {
    const testPhone = genTestPhone();
    await cleanupPhone(testPhone);

    // Directly test concurrent user creation handling logic
    const results = await Promise.all([
      (async () => {
        let u = await prisma.user.findUnique({ where: { phone: testPhone } });
        if (!u) {
          try {
            u = await prisma.user.create({ data: { phone: testPhone, phoneVerified: true } });
          } catch (e: unknown) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
              u = await prisma.user.findUniqueOrThrow({ where: { phone: testPhone } });
            } else {
              throw e;
            }
          }
        }
        return u;
      })(),
      (async () => {
        let u = await prisma.user.findUnique({ where: { phone: testPhone } });
        if (!u) {
          try {
            u = await prisma.user.create({ data: { phone: testPhone, phoneVerified: true } });
          } catch (e: unknown) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
              u = await prisma.user.findUniqueOrThrow({ where: { phone: testPhone } });
            } else {
              throw e;
            }
          }
        }
        return u;
      })(),
    ]);

    assert.ok(results[0].id, 'User 1 must have valid ID');
    assert.ok(results[1].id, 'User 2 must have valid ID');
    assert.strictEqual(results[0].id, results[1].id, 'Both workers must resolve to the EXACT SAME User ID');

    // Verify DB count
    const count = await prisma.user.count({ where: { phone: testPhone } });
    assert.strictEqual(count, 1, 'Exactly one User record must exist in DB');

    await cleanupPhone(testPhone);
  });

  // ---------------------------------------------------------------------------
  // TEST 5: Concurrent Referral Award & Zero Double-Crediting
  // ---------------------------------------------------------------------------
  await test('5. Concurrent Referral Award: Atomic transaction prevents double crediting on P2002 race', async () => {
    const inviterPhone = genTestPhone();
    const invitedPhone = genTestPhone();
    await cleanupPhone(inviterPhone);
    await cleanupPhone(invitedPhone);

    // 1. Create inviter user and waitlist entry
    const inviterUser = await prisma.user.create({
      data: { phone: inviterPhone, phoneVerified: true },
    });
    const inviterWaitlist = await prisma.waitlistEntry.create({
      data: {
        userId: inviterUser.id,
        referralCode: 'REFCONCURR',
        priorityScore: 10,
        pendingScore: 0,
      },
    });

    // 2. Create invited user
    const invitedUser = await prisma.user.create({
      data: { phone: invitedPhone, phoneVerified: true },
    });

    // 3. Simultaneously fire 5 concurrent referral attempts for the same invited user
    const concurrency = 5;
    const referralAttempts = Array.from({ length: concurrency }, async (_, idx) => {
      try {
        await prisma.$transaction(async (tx) => {
          const existingRef = await tx.referral.findUnique({
            where: { invitedUserId: invitedUser.id },
          });
          if (existingRef) {
            return;
          }

          // Simulate slight interleaving delay
          await new Promise((r) => setTimeout(r, Math.random() * 10));

          await tx.waitlistEntry.update({
            where: { id: inviterWaitlist.id },
            data: { pendingScore: { increment: 50 } },
          });

          await tx.referral.create({
            data: {
              inviterId: inviterUser.id,
              invitedUserId: invitedUser.id,
              status: 'CONVERTED',
              isFlagged: false,
              isMatured: false,
              maturesAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
        });
        return { success: true, idx };
      } catch (err: unknown) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return { success: false, duplicate: true, idx };
        }
        throw err;
      }
    });

    await Promise.all(referralAttempts);

    // 4. Assert DB state
    const createdReferrals = await prisma.referral.findMany({
      where: { invitedUserId: invitedUser.id },
    });
    assert.strictEqual(
      createdReferrals.length,
      1,
      `Expected exactly 1 Referral record, got ${createdReferrals.length}`
    );

    const updatedInviter = await prisma.waitlistEntry.findUniqueOrThrow({
      where: { id: inviterWaitlist.id },
    });
    assert.strictEqual(
      updatedInviter.pendingScore,
      50,
      `CRITICAL: pendingScore must be exactly 50 (1 credit), got ${updatedInviter.pendingScore} (double-credit prevented!)`
    );

    await cleanupPhone(inviterPhone);
    await cleanupPhone(invitedPhone);
  });

  console.log('\n====================================================');
  console.log(`   ALL ${passed}/${total} TARGETED C2 CONCURRENCY TESTS PASSED!`);
  console.log('====================================================\n');
}

runC2ConcurrencySuite()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error('Test suite failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
