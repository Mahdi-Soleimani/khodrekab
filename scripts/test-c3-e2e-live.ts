import assert from 'assert';
import crypto from 'crypto';
import { prisma } from '../src/lib/prisma';
import { POST as registerHandler } from '../src/app/api/waitlist/register/route';
import { POST as verifyHandler } from '../src/app/api/waitlist/verify/route';
import { GET as statusHandler } from '../src/app/api/waitlist/status/route';
import { POST as logoutHandler } from '../src/app/api/auth/logout/route';
import { generatePoWChallenge, solvePoW } from '../src/lib/security/pow';
import { closeRedisConnection } from '../src/lib/security/redis';
import { getSessionCookieConfig } from '../src/lib/security/session';

async function runC3E2ELive() {
  console.log('====================================================');
  console.log('   CARNO PHASE C3 REAL DATABASE E2E TEST SUITE     ');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
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

  // Ensure dev secret is set for test runner
  if (!process.env.JWT_SECRET && !process.env.JWT_DEV_SECRET) {
    process.env.JWT_DEV_SECRET = 'test-secret-min-16-chars-c3-hardening';
  }
  if (!process.env.SMS_ENCRYPTION_KEY) {
    process.env.SMS_ENCRYPTION_KEY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  }
  process.env.TRUSTED_IP_HEADER = 'x-forwarded-for';
  process.env.TRUSTED_PROXY_CIDRS = '127.0.0.1/32';

  // Helper to extract a cookie from Response headers
  function extractCookie(res: Response, cookieName: string): string | null {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return null;
    const match = setCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  // Clean up any old fabricated test users (09000003xxx)
  const testPhones = [
    '09000003001',
    '09000003002',
    '09000003003',
    '09000003004',
  ];
  for (const p of testPhones) {
    const existing = await prisma.user.findUnique({ where: { phone: p } });
    if (existing) {
      await prisma.referral.deleteMany({ where: { OR: [{ inviterId: existing.id }, { invitedUserId: existing.id }] } });
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      await prisma.waitlistEntry.deleteMany({ where: { userId: existing.id } });
      await prisma.oTPVerification.deleteMany({ where: { phone: p } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
  }

  const randomSuffix = Math.floor(1000000 + Math.random() * 9000000).toString();
  const phoneA = `0900${randomSuffix}`;
  const phoneB = `0900${(parseInt(randomSuffix, 10) + 1).toString().padStart(7, '0')}`;
  const ipA = '198.51.100.12';
  const ipB = '198.51.100.13';

  let sessionCookieA: string = '';
  let refCodeA: string = '';
  let userAId: string = '';
  let jtiA: string = '';

  // --- Step 1: User A Registration & Real DB Verification ---
  await test('User A registers and receives OTP in DB', async () => {
    const chal = generatePoWChallenge(1);
    const solution = solvePoW(chal.challenge, 1);

    const regReq = new Request('http://localhost:3000/api/waitlist/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost:3000',
        'x-forwarded-for': ipA,
      },
      body: JSON.stringify({
        phone: phoneA,
        pow: { challenge: chal.challenge, solution },
        _hp: '',
        fillTimeMs: 2500,
      }),
    });

    const regRes = await registerHandler(regReq);
    assert.strictEqual(regRes.status, 200, `Registration must succeed, got ${regRes.status}`);

    const otpRecord = await prisma.oTPVerification.findFirst({
      where: { phone: phoneA, verified: false },
      orderBy: { createdAt: 'desc' },
    });
    assert(otpRecord, 'OTP record must exist in DB');
  });

  await test('User A verifies OTP: creates Session in DB with 2h expiry and carno_session cookie', async () => {
    const otpRecord = await prisma.oTPVerification.findFirst({
      where: { phone: phoneA, verified: false },
      orderBy: { createdAt: 'desc' },
    });
    assert(otpRecord);

    // Set known OTP hash for verification
    const { computeOtpHash } = await import('../src/lib/security/otp');
    const knownOtp = '12345';
    const knownHmac = computeOtpHash(phoneA, otpRecord.id, knownOtp);
    await prisma.oTPVerification.update({
      where: { id: otpRecord.id },
      data: { codeHash: knownHmac },
    });

    const verReq = new Request('http://localhost:3000/api/waitlist/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost:3000',
        'x-forwarded-for': ipA,
      },
      body: JSON.stringify({
        phone: phoneA,
        otp: knownOtp,
      }),
    });

    const verRes = await verifyHandler(verReq);
    assert.strictEqual(verRes.status, 200, `Verify must succeed, got ${verRes.status}`);

    const cookieConfig = getSessionCookieConfig();
    const cookieVal = extractCookie(verRes, cookieConfig.name);
    assert(cookieVal, `Cookie ${cookieConfig.name} must be set in response headers`);
    sessionCookieA = `${cookieConfig.name}=${cookieVal}`;

    // Verify DB Session record
    const userA = await prisma.user.findUnique({ where: { phone: phoneA } });
    assert(userA, 'User A must exist in DB');
    userAId = userA.id;

    const dbSession = await prisma.session.findFirst({
      where: { userId: userA.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    assert(dbSession, 'Session record must exist in DB');
    jtiA = dbSession.jti;
    assert.strictEqual(dbSession.revokedAt, null, 'Session must not be revoked');
    const remainingSecs = Math.round((dbSession.expiresAt.getTime() - dbSession.createdAt.getTime()) / 1000);
    assert(Math.abs(remainingSecs - 7200) < 5, `Session lifetime must be ~7200s (got ${remainingSecs})`);

    // Verify WaitlistEntry priorityScore=10, pendingScore=0
    const entryA = await prisma.waitlistEntry.findUnique({ where: { userId: userA.id } });
    assert(entryA, 'Waitlist entry must exist');
    assert.strictEqual(entryA.priorityScore, 10, 'Initial priorityScore must be 10');
    assert.strictEqual(entryA.pendingScore, 0, 'Initial pendingScore must be 0');
    refCodeA = entryA.referralCode;
    assert(refCodeA && refCodeA.length > 0, 'Referral code must be generated');
  });

  // --- Step 2: Real Status Endpoint Query ---
  await test('User A queries /api/waitlist/status with real session -> returns 200, rank, scores', async () => {
    const statusReq = new Request('http://localhost:3000/api/waitlist/status', {
      headers: {
        cookie: sessionCookieA,
      },
    });

    const statusRes = await statusHandler(statusReq);
    assert.strictEqual(statusRes.status, 200);
    const json = await statusRes.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.refCode, refCodeA);
    assert.strictEqual(json.data.priorityScore, 10);
    assert.strictEqual(json.data.pendingScore, 0);
    assert(typeof json.data.rank === 'number' && json.data.rank >= 1, 'Rank must be a positive number');
  });

  // --- Step 3: Real Referral Flow (User B uses User A refCode) ---
  await test('User B registers with User A refCode: points go to pendingScore, maturesAt = 24h', async () => {
    const chal = generatePoWChallenge(1);
    const solution = solvePoW(chal.challenge, 1);

    const regReq = new Request('http://localhost:3000/api/waitlist/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        phone: phoneB,
        pow: { challenge: chal.challenge, solution },
        _hp: '',
        fillTimeMs: 2500,
      }),
    });
    await registerHandler(regReq);

    const otpRecordB = await prisma.oTPVerification.findFirst({
      where: { phone: phoneB, verified: false },
      orderBy: { createdAt: 'desc' },
    });
    assert(otpRecordB, 'User B OTP must exist');

    const { computeOtpHash } = await import('../src/lib/security/otp');
    const knownOtp = '12345';
    const knownHmac = computeOtpHash(phoneB, otpRecordB.id, knownOtp);
    await prisma.oTPVerification.update({
      where: { id: otpRecordB.id },
      data: { codeHash: knownHmac },
    });

    // Verify User B with referredByCode = refCodeA
    const verReq = new Request('http://localhost:3000/api/waitlist/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost:3000',
        'x-forwarded-for': ipB, // Different IP from User A
      },
      body: JSON.stringify({
        phone: phoneB,
        otp: knownOtp,
        referredByCode: refCodeA,
      }),
    });

    const verRes = await verifyHandler(verReq);
    assert.strictEqual(verRes.status, 200);

    const userB = await prisma.user.findUnique({ where: { phone: phoneB } });
    assert(userB, 'User B must exist');

    // Query DB Referral record
    const referral = await prisma.referral.findFirst({
      where: { inviterId: userAId, invitedUserId: userB.id },
    });
    assert(referral, 'Referral record must exist in DB');
    assert.strictEqual(referral.status, 'CONVERTED');
    assert.strictEqual(referral.isMatured, false, 'Referral must NOT be matured initially');
    assert.strictEqual(referral.isFlagged, false, 'Legitimate referral must not be flagged');
    assert(referral.maturesAt, 'maturesAt timestamp must be set');
    const hoursUntilMaturity = (referral.maturesAt.getTime() - Date.now()) / (1000 * 60 * 60);
    assert(hoursUntilMaturity > 23 && hoursUntilMaturity <= 24.1, `maturesAt must be ~24h ahead (got ${hoursUntilMaturity.toFixed(2)}h)`);

    // CRITICAL: User A priorityScore must still be 10, pendingScore must be 50!
    const entryAAfter = await prisma.waitlistEntry.findUnique({ where: { userId: userAId } });
    assert.strictEqual(entryAAfter?.priorityScore, 10, 'priorityScore must NOT increase before 24h maturity');
    assert.strictEqual(entryAAfter?.pendingScore, 50, 'pendingScore must be incremented by 50');
  });

  // --- Step 4: Lazy-on-Read Maturity Settlement on Live DB ---
  await test('When 24h passes, /api/waitlist/status settles pendingScore to priorityScore atomically', async () => {
    // Fast-forward maturity timestamp into the past (maturesAt = now - 1 hour)
    await prisma.referral.updateMany({
      where: { inviterId: userAId, isMatured: false },
      data: { maturesAt: new Date(Date.now() - 3600 * 1000) },
    });

    // User A queries status
    const statusReq = new Request('http://localhost:3000/api/waitlist/status', {
      headers: { cookie: sessionCookieA },
    });
    const statusRes = await statusHandler(statusReq);
    assert.strictEqual(statusRes.status, 200);
    const json = await statusRes.json();

    // Check response
    assert.strictEqual(json.data.priorityScore, 60, 'priorityScore must now be 60 (10 base + 50 matured)');
    assert.strictEqual(json.data.pendingScore, 0, 'pendingScore must now be 0');

    // Check DB directly
    const entryADirect = await prisma.waitlistEntry.findUnique({ where: { userId: userAId } });
    assert.strictEqual(entryADirect?.priorityScore, 60);
    assert.strictEqual(entryADirect?.pendingScore, 0);
    assert(entryADirect?.pendingScore >= 0, 'pendingScore must never be negative');

    const dbRef = await prisma.referral.findFirst({ where: { inviterId: userAId } });
    assert.strictEqual(dbRef?.isMatured, true, 'Referral in DB must now be marked isMatured=true');
  });

  // --- Step 5: Real Logout & Revocation on Live DB ---
  await test('User A calls /api/auth/logout: marks Session revoked in DB and clears cookie', async () => {
    const logoutReq = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        cookie: sessionCookieA,
        origin: 'http://localhost:3000',
      },
    });

    const logoutRes = await logoutHandler(logoutReq);
    assert.strictEqual(logoutRes.status, 200);

    // Verify DB Session record is revoked
    const dbSession = await prisma.session.findUnique({ where: { jti: jtiA } });
    assert(dbSession, 'Session must exist');
    assert(dbSession.revokedAt !== null, 'revokedAt must be set in DB');

    // Verify cookie cleared in response
    const cookieConfig = getSessionCookieConfig();
    const setCookie = logoutRes.headers.get('set-cookie');
    assert(setCookie?.includes(`${cookieConfig.name}=;`) || setCookie?.includes('Max-Age=0'), 'Cookie must be cleared');
  });

  await test('Subsequent status request with revoked session is rejected with 401', async () => {
    const statusReq = new Request('http://localhost:3000/api/waitlist/status', {
      headers: { cookie: sessionCookieA },
    });

    const statusRes = await statusHandler(statusReq);
    assert.strictEqual(statusRes.status, 401, 'Revoked session must be rejected with 401');
    const json = await statusRes.json();
    assert(json.error?.includes('منقضی'), 'Persian error message expected');
  });

  // --- Step 6: Real Self-Referral Blocking ---
  await test('Self-referral on live DB: User B cannot use User B refCode', async () => {
    const entryB = await prisma.waitlistEntry.findUnique({ where: { userId: (await prisma.user.findUnique({ where: { phone: phoneB } }))!.id } });
    assert(entryB);

    // Attempt verify with own ref code
    const selfVerReq = new Request('http://localhost:3000/api/waitlist/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        phone: phoneB,
        otp: '12345',
        referredByCode: entryB.referralCode,
      }),
    });

    await verifyHandler(selfVerReq);
    const selfRef = await prisma.referral.findFirst({
      where: { inviterId: entryB.userId, invitedUserId: entryB.userId },
    });
    assert.strictEqual(selfRef, null, 'Self referral record must NOT be created');
  });

  // --- Step 7: IP Clustering Anti-Abuse on Live DB ---
  await test('IP Cluster Anti-Abuse: User C from same IP as User A within 1h is flagged, points held', async () => {
    const phoneC = `0900${(parseInt(randomSuffix, 10) + 2).toString().padStart(7, '0')}`;
    testPhones.push(phoneC);

    // Register User C
    const chal = generatePoWChallenge(1);
    const solution = solvePoW(chal.challenge, 1);
    const regReq = new Request('http://localhost:3000/api/waitlist/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost:3000',
        'x-forwarded-for': ipA, // Same IP as User A!
      },
      body: JSON.stringify({
        phone: phoneC,
        pow: { challenge: chal.challenge, solution },
        _hp: '',
        fillTimeMs: 2500,
      }),
    });
    await registerHandler(regReq);

    const otpRecordC = await prisma.oTPVerification.findFirst({
      where: { phone: phoneC, verified: false },
      orderBy: { createdAt: 'desc' },
    });
    assert(otpRecordC);
    const { computeOtpHash } = await import('../src/lib/security/otp');
    const knownOtp = '12345';
    const knownHmac = computeOtpHash(phoneC, otpRecordC.id, knownOtp);
    await prisma.oTPVerification.update({
      where: { id: otpRecordC.id },
      data: { codeHash: knownHmac },
    });

    const userABefore = await prisma.waitlistEntry.findUnique({ where: { userId: userAId } });
    const pendingBefore = userABefore?.pendingScore || 0;

    // Verify User C with User A's ref code from ipA
    const verReq = new Request('http://localhost:3000/api/waitlist/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost:3000',
        'x-forwarded-for': ipA, // Same IP as User A!
      },
      body: JSON.stringify({
        phone: phoneC,
        otp: knownOtp,
        referredByCode: refCodeA,
      }),
    });
    const verRes = await verifyHandler(verReq);
    assert.strictEqual(verRes.status, 200);

    const userC = await prisma.user.findUnique({ where: { phone: phoneC } });
    assert(userC);

    const referralC = await prisma.referral.findFirst({
      where: { inviterId: userAId, invitedUserId: userC.id },
    });
    assert(referralC, 'Referral record must exist');
    assert.strictEqual(referralC.isFlagged, true, 'Referral from same IP cluster must be flagged');
    assert.strictEqual(referralC.maturesAt, null, 'Flagged referral must NOT have maturesAt');

    // User A pendingScore must NOT increase
    const userAAfter = await prisma.waitlistEntry.findUnique({ where: { userId: userAId } });
    assert.strictEqual(userAAfter?.pendingScore, pendingBefore, 'pendingScore must NOT increase for flagged referral');
  });

  // --- Step 8: Velocity Cap (20/day) on Live DB ---
  await test('Velocity Cap (20/day): 21st referral gets FLAGGED_HIGH_VOLUME, points held', async () => {
    const phoneD = `0900${(parseInt(randomSuffix, 10) + 3).toString().padStart(7, '0')}`;
    testPhones.push(phoneD);

    // Populate 19 dummy converted referrals for User A (total with User B = 20)
    for (let i = 1; i <= 19; i++) {
      await prisma.referral.create({
        data: {
          inviterId: userAId,
          status: 'CONVERTED',
          isFlagged: false,
          isMatured: false,
          maturesAt: new Date(Date.now() + 24 * 3600 * 1000),
          createdAt: new Date(),
        },
      });
    }

    // Now User A has 20 CONVERTED referrals in the last 24h.
    // Register User D from a new clean IP
    const ipD = '198.51.100.99';
    const chal = generatePoWChallenge(1);
    const solution = solvePoW(chal.challenge, 1);
    const regReq = new Request('http://localhost:3000/api/waitlist/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost:3000',
        'x-forwarded-for': ipD,
      },
      body: JSON.stringify({
        phone: phoneD,
        pow: { challenge: chal.challenge, solution },
        _hp: '',
        fillTimeMs: 2500,
      }),
    });
    await registerHandler(regReq);

    const otpRecordD = await prisma.oTPVerification.findFirst({
      where: { phone: phoneD, verified: false },
      orderBy: { createdAt: 'desc' },
    });
    assert(otpRecordD);
    const { computeOtpHash } = await import('../src/lib/security/otp');
    const knownOtp = '12345';
    const knownHmac = computeOtpHash(phoneD, otpRecordD.id, knownOtp);
    await prisma.oTPVerification.update({
      where: { id: otpRecordD.id },
      data: { codeHash: knownHmac },
    });

    const userABefore = await prisma.waitlistEntry.findUnique({ where: { userId: userAId } });
    const pendingBefore = userABefore?.pendingScore || 0;

    // Verify User D with User A's ref code -> 21st referral!
    const verReq = new Request('http://localhost:3000/api/waitlist/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost:3000',
        'x-forwarded-for': ipD,
      },
      body: JSON.stringify({
        phone: phoneD,
        otp: knownOtp,
        referredByCode: refCodeA,
      }),
    });
    const verRes = await verifyHandler(verReq);
    assert.strictEqual(verRes.status, 200);

    const userD = await prisma.user.findUnique({ where: { phone: phoneD } });
    assert(userD);

    const referralD = await prisma.referral.findFirst({
      where: { inviterId: userAId, invitedUserId: userD.id },
    });
    assert(referralD);
    assert.strictEqual(referralD.status, 'FLAGGED_HIGH_VOLUME', '21st referral must be FLAGGED_HIGH_VOLUME');
    assert.strictEqual(referralD.isFlagged, true, '21st referral must be isFlagged=true');
    assert.strictEqual(referralD.maturesAt, null, 'High volume referral must NOT have maturesAt');

    const userAAfter = await prisma.waitlistEntry.findUnique({ where: { userId: userAId } });
    assert.strictEqual(userAAfter?.pendingScore, pendingBefore, 'pendingScore must NOT increase beyond velocity cap');
  });

  // Cleanup test users
  for (const p of testPhones) {
    const existing = await prisma.user.findUnique({ where: { phone: p } });
    if (existing) {
      await prisma.referral.deleteMany({ where: { OR: [{ inviterId: existing.id }, { invitedUserId: existing.id }] } });
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      await prisma.waitlistEntry.deleteMany({ where: { userId: existing.id } });
      await prisma.oTPVerification.deleteMany({ where: { phone: p } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
  }

  await closeRedisConnection();

  console.log('\n====================================================');
  console.log(`   CARNO REAL DATABASE E2E SUITE: ${passed}/${total} PASSED`);
  console.log('====================================================\n');
}

runC3E2ELive().catch((err) => {
  console.error('\n[FATAL_E2E_FAILURE]', err);
  process.exit(1);
});
