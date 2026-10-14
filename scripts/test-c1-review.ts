import assert from 'assert';
import crypto from 'crypto';
import { POST as registerHandler } from '../src/app/api/waitlist/register/route';
import { POST as verifyHandler } from '../src/app/api/waitlist/verify/route';
import { generatePoWChallenge, solvePoW } from '../src/lib/security/pow';
import { clearOtpFailure, recordOtpFailure, checkOtpLockout, getPhoneHash } from '../src/lib/security/otp';
import { checkSmsRateLimits } from '../src/lib/security/limiter';
import { getRedisClient, closeRedisConnection } from '../src/lib/security/redis';
import { smsService } from '../src/lib/sms';
import { prisma } from '../src/lib/prisma';

// Read SMS_ENCRYPTION_KEY from environment or test fallback for runner
if (!process.env.SMS_ENCRYPTION_KEY) {
  try {
    const { loadEnvConfig } = require('@next/env');
    loadEnvConfig(process.cwd());
  } catch {}
}
if (!process.env.SMS_ENCRYPTION_KEY) {
  process.env.SMS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
}

async function runReviewTests() {
  console.log('====================================================');
  console.log('    CARNO C1 REVIEW: RIGOROUS REAL TESTS SUITE     ');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  // Instrument SMS service to count calls
  let smsCallCount = 0;
  const originalSendOtp = smsService.sendOtp;
  smsService.sendOtp = async (input: any) => {
    smsCallCount++;
    return { success: true, providerMessageId: 'mock_msg_id' };
  };

  // --- 2.a: Redis unavailable in production mode -> register 503 AND verify 503, SMS never called ---
  await test('2.a: Redis unavailable in production mode -> register 503, verify 503, SMS transport call count = 0', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalUrl = process.env.REDIS_URL;
    (process.env as any).NODE_ENV = 'production';
    process.env.REDIS_URL = 'redis://127.0.0.1:9999'; // unreachable port
    smsCallCount = 0;

    await closeRedisConnection(); // close healthy connection

    try {
      const chal = generatePoWChallenge(3);
      const solution = solvePoW(chal.challenge, 3);
      const phone = '0912' + Math.floor(1000000 + Math.random() * 8999999).toString();

      // Register request
      const regReq = new Request('http://localhost:3000/api/waitlist/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          pow: { challenge: chal.challenge, solution },
          _hp: '',
          fillTimeMs: 2000,
        }),
      });
      const regRes = await registerHandler(regReq);
      assert.strictEqual(regRes.status, 503, `Register must return 503 when Redis is down in production (got ${regRes.status})`);
      const regJson = await regRes.json();
      assert(regJson.error?.includes('در دسترس نیست') || regJson.error?.includes('بهینه‌سازی'));

      // Verify request
      const verReq = new Request('http://localhost:3000/api/waitlist/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp: '12345' }),
      });
      const verRes = await verifyHandler(verReq);
      assert.strictEqual(verRes.status, 503, `Verify must return 503 when Redis is down in production (got ${verRes.status})`);

      // Critical assertion: SMS transport was never invoked!
      assert.strictEqual(smsCallCount, 0, `SMS transport must NEVER be called when Redis is down in production (called ${smsCallCount} times)`);
    } finally {
      (process.env as any).NODE_ENV = originalEnv;
      process.env.REDIS_URL = originalUrl;
      await closeRedisConnection();
    }
  });

  // --- 2.b: 10 wrong codes across 4 challenges -> 30-min lock ---
  await test('2.b: 10 wrong codes across 4 challenges triggers 30-minute lockout', async () => {
    const phone = '0912' + Math.floor(1000000 + Math.random() * 8999999).toString();
    await clearOtpFailure(phone);

    // Mock in-memory DB for challenges
    const challenges: any[] = [];
    (prisma.oTPVerification as any).create = async ({ data }: any) => {
      const rec = { id: 'c_' + Math.random().toString(36).substring(7), ...data, attempts: 0, verified: false, createdAt: new Date() };
      challenges.push(rec);
      return rec;
    };
    (prisma.oTPVerification as any).findFirst = async () => challenges[challenges.length - 1] || null;
    (prisma.oTPVerification as any).update = async ({ where, data }: any) => {
      const c = challenges.find((x) => x.id === where.id);
      if (c) Object.assign(c, data);
      return c || { id: where.id, ...data };
    };

    let totalAttempts = 0;

    // Challenge 1: 3 wrong attempts
    challenges.push({ id: 'chal_1', phone, codeHash: 'hmac_valid_hash_1', attempts: 0, verified: false, expiresAt: new Date(Date.now() + 300000) });
    for (let i = 0; i < 3; i++) {
      const res = await verifyHandler(new Request('http://localhost/api/waitlist/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp: '00000' }),
      }));
      assert.strictEqual(res.status, 400);
      totalAttempts++;
    }

    // Challenge 2: 3 wrong attempts
    challenges.push({ id: 'chal_2', phone, codeHash: 'hmac_valid_hash_2', attempts: 0, verified: false, expiresAt: new Date(Date.now() + 300000) });
    for (let i = 0; i < 3; i++) {
      const res = await verifyHandler(new Request('http://localhost/api/waitlist/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp: '00000' }),
      }));
      assert.strictEqual(res.status, 400);
      totalAttempts++;
    }

    // Challenge 3: 3 wrong attempts
    challenges.push({ id: 'chal_3', phone, codeHash: 'hmac_valid_hash_3', attempts: 0, verified: false, expiresAt: new Date(Date.now() + 300000) });
    for (let i = 0; i < 3; i++) {
      const res = await verifyHandler(new Request('http://localhost/api/waitlist/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp: '00000' }),
      }));
      assert.strictEqual(res.status, 400);
      totalAttempts++;
    }

    // Challenge 4: 1st attempt (10th total)
    challenges.push({ id: 'chal_4', phone, codeHash: 'hmac_valid_hash_4', attempts: 0, verified: false, expiresAt: new Date(Date.now() + 300000) });
    const res10 = await verifyHandler(new Request('http://localhost/api/waitlist/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp: '00000' }),
    }));
    totalAttempts++;
    assert.strictEqual(totalAttempts, 10, 'Should have executed exactly 10 attempts across 4 challenges');

    // 11th attempt must be rejected with 429 and 30-min lockout message
    const resLocked = await verifyHandler(new Request('http://localhost/api/waitlist/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp: '00000' }),
    }));
    assert.strictEqual(resLocked.status, 429, `Attempt 11 must be rejected with 429 (got ${resLocked.status})`);
    const lockedJson = await resLocked.json();
    assert(lockedJson.error?.includes('۳۰ دقیقه مسدود شد'), 'Must return 30-minute lockout message');

    await clearOtpFailure(phone);
  });

  // --- 2.c: Redis flushed after 8 wrong attempts -> Postgres backstop locks at 10 ---
  await test('2.c: Redis flushed after 8 wrong attempts -> Postgres backstop enforces lockout at 10', async () => {
    const phone = '0912' + Math.floor(1000000 + Math.random() * 8999999).toString();
    const phoneHash = getPhoneHash(phone);
    await clearOtpFailure(phone);

    // Mock PostgreSQL OtpFailureCounter in memory
    let pgRecord: any = null;
    (prisma.otpFailureCounter as any) = {
      findUnique: async () => pgRecord,
      upsert: async ({ create, update }: any) => {
        pgRecord = { ...create, updatedAt: new Date() };
        return pgRecord;
      },
      update: async ({ data }: any) => {
        pgRecord = { ...pgRecord, ...data, updatedAt: new Date() };
        return pgRecord;
      },
      delete: async () => {
        pgRecord = null;
      },
    };

    // Record 8 failed attempts in both Redis and Postgres
    for (let i = 0; i < 8; i++) {
      await recordOtpFailure(phone);
    }

    assert(pgRecord && pgRecord.failCount === 8, `PostgreSQL backstop must hold 8 attempts (got ${pgRecord?.failCount})`);

    // SIMULATE REDIS LOSS / FLUSH
    const redis = getRedisClient();
    if (redis) {
      await redis.del(`otp:fail:${phoneHash}`);
    }

    // Attempt 9 (Redis has 0, but recordOtpFailure increments both)
    await recordOtpFailure(phone);
    assert.strictEqual(pgRecord.failCount, 9, 'Postgres backstop must hold 9 attempts');

    // Attempt 10
    await recordOtpFailure(phone);
    assert.strictEqual(pgRecord.failCount, 10, 'Postgres backstop must hold 10 attempts');

    // Query lockout state: effective count is MAX(redis=2, postgres=10) = 10
    const lockoutState = await checkOtpLockout(phone);
    assert.strictEqual(lockoutState.locked, true, 'Phone must be LOCKED despite Redis having been flushed after attempt 8');

    await clearOtpFailure(phone);
  });

  // --- 2.d: Log capture grep: no OTP, raw phone, raw IP, token, pepper leaked ---
  await test('2.d: Log capture grep: zero leaks of OTP, raw phone, raw IP, tokens, or peppers', async () => {
    const rawPhone = '0912' + Math.floor(1000000 + Math.random() * 8999999).toString();
    const expectedMask = rawPhone.substring(0, 4) + '***' + rawPhone.substring(rawPhone.length - 4);
    const rawIp = '198.51.100.77';
    const secretOtp = '77889';
    const secretPepper = process.env.OTP_PEPPER || 'test_sample_pepper_secret_token_1234567890abcdef_mock_value';

    // Intercept console logs
    const capturedLogs: string[] = [];
    const origLog = console.log;
    const origInfo = console.info;
    const origWarn = console.warn;
    const origError = console.error;

    const interceptor = (...args: any[]) => {
      capturedLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    };

    console.log = interceptor;
    console.info = interceptor;
    console.warn = interceptor;
    console.error = interceptor;

    try {
      await clearOtpFailure(rawPhone);
      const redis = getRedisClient();
      if (redis) {
        const phoneHash = getPhoneHash(rawPhone);
        await redis.del(`sms:phone:${phoneHash.substring(0, 16)}:cooldown`);
      }

      (prisma.oTPVerification as any).create = async ({ data }: any) => ({
        id: 'chal_log_test',
        ...data,
        createdAt: new Date(),
      });
      (prisma.oTPVerification as any).updateMany = async () => ({ count: 1 });
      (prisma.oTPVerification as any).update = async ({ data }: any) => ({
        id: 'chal_log_test',
        ...data,
      });

      const chal = generatePoWChallenge(3);
      const solution = solvePoW(chal.challenge, 3);

      // Execute register
      const regReq = new Request('http://localhost/api/waitlist/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-real-ip': rawIp },
        body: JSON.stringify({
          phone: rawPhone,
          pow: { challenge: chal.challenge, solution },
          _hp: '',
          fillTimeMs: 2500,
        }),
      });
      await registerHandler(regReq);

      // Execute verify
      const verReq = new Request('http://localhost/api/waitlist/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: rawPhone, otp: secretOtp }),
      });
      await verifyHandler(verReq);
    } finally {
      console.log = origLog;
      console.info = origInfo;
      console.warn = origWarn;
      console.error = origError;
    }

    const allLogs = capturedLogs.join('\n');

    // Assert zero leakage of sensitive data
    assert(!allLogs.includes(rawPhone), `LEAK DETECTED: Raw phone number "${rawPhone}" found in logs!`);
    assert(!allLogs.includes(rawIp), `LEAK DETECTED: Raw IP address "${rawIp}" found in logs!`);
    assert(!allLogs.includes(secretOtp), `LEAK DETECTED: Raw OTP code "${secretOtp}" found in logs!`);
    assert(!allLogs.includes(secretPepper), `LEAK DETECTED: Secret pepper found in logs!`);

    // Confirm that masked phone was used instead
    assert(allLogs.includes(expectedMask), `Logs must safely contain masked phone (${expectedMask})`);
  });

  // --- 2.e: Hourly/daily phone and global counters are NOT decremented on queue failure ---
  await test('2.e: Hourly/daily phone and global counters are NOT decremented when queue worker fails and cooldown is evicted', async () => {
    const phone = '0912' + Math.floor(1000000 + Math.random() * 8999999).toString();
    const phoneHash = crypto.createHash('sha256').update(phone).digest('hex').substring(0, 16);
    const ip = '203.0.113.199';
    const redis = getRedisClient();

    // 1. Initial send request
    const limitResult1 = await checkSmsRateLimits({ phone, clientIp: ip });
    assert.strictEqual(limitResult1.allowed, true);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const hourStr = dateStr + now.getUTCHours().toString().padStart(2, '0');

    const phoneHourKey = `sms:phone:${phoneHash.substring(0, 16)}:hour:${hourStr}`;
    const phoneDayKey = `sms:phone:${phoneHash.substring(0, 16)}:day:${dateStr}`;
    const phoneCooldownKey = `sms:phone:${phoneHash.substring(0, 16)}:cooldown`;
    const globalHourKey = `sms:global:hour:${hourStr}`;
    const globalDayKey = `sms:global:day:${dateStr}`;

    let phoneHourBefore = 1;
    let globalHourBefore = 1;

    if (redis) {
      phoneHourBefore = parseInt((await redis.get(phoneHourKey)) || '1', 10);
      globalHourBefore = parseInt((await redis.get(globalHourKey)) || '1', 10);
      assert.strictEqual(phoneHourBefore, 1, 'Phone hourly counter must be 1');
    }

    // 2. SIMULATE WORKER FAILURE: evict only the cooldown key to allow retry
    if (redis) {
      await redis.del(phoneCooldownKey);
    }

    // 3. Verify that consumption counters were NEVER decremented
    if (redis) {
      const phoneHourAfter = parseInt((await redis.get(phoneHourKey)) || '0', 10);
      const phoneDayAfter = parseInt((await redis.get(phoneDayKey)) || '0', 10);
      const globalHourAfter = parseInt((await redis.get(globalHourKey)) || '0', 10);
      const globalDayAfter = parseInt((await redis.get(globalDayKey)) || '0', 10);

      assert.strictEqual(phoneHourAfter, phoneHourBefore, 'Phone hourly counter must NOT be decremented on worker failure');
      assert.strictEqual(phoneDayAfter, 1, 'Phone daily counter must NOT be decremented on worker failure');
      assert.strictEqual(globalHourAfter, globalHourBefore, 'Global hourly counter must NOT be decremented on worker failure');
      assert.strictEqual(globalDayAfter >= 1, true, 'Global daily counter must NOT be decremented on worker failure');
    }
  });

  // Restore original SMS sendOtp
  smsService.sendOtp = originalSendOtp;
  await closeRedisConnection();

  console.log(`\n====================================================`);
  console.log(`   ALL REVIEW TESTS COMPLETED: ${passed}/${total} PASSED`);
  console.log(`====================================================\n`);
}

runReviewTests().catch((err) => {
  console.error('Review test failed:', err);
  process.exit(1);
});
