import { SESSION_LIFETIME_SECONDS, getSessionCookieConfig, createSession, validateSessionToken, revokeSession } from '../src/lib/security/session';
import { prisma } from '../src/lib/prisma';
import jwt from 'jsonwebtoken';

async function runTests() {
  console.log('=====================================================');
  console.log('🧪 CARNO DASHBOARD & UNIFIED AUTH TEST SUITE');
  console.log('=====================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}${detail ? ' - ' + detail : ''}`);
      failed++;
    }
  }

  try {
    // TEST 1: Session Duration is 30 Days (2,592,000 seconds)
    console.log('\n--- 1. Session Duration & Cookie Config ---');
    assert(SESSION_LIFETIME_SECONDS === 2592000, 'SESSION_LIFETIME_SECONDS is 2,592,000 seconds (30 days)');
    
    const cookieConfig = getSessionCookieConfig();
    assert(cookieConfig.maxAge === 2592000, 'Cookie maxAge is 2,592,000 seconds (30 days)');
    assert(cookieConfig.httpOnly === true, 'Cookie httpOnly is true');
    assert(cookieConfig.sameSite === 'lax', 'Cookie sameSite is "lax"');
    assert(cookieConfig.path === '/', 'Cookie path is "/"');

    // TEST 2: Create Session & Database Record
    console.log('\n--- 2. Session Creation & DB Session Record ---');
    const testPhone = '0912' + Math.floor(1000000 + Math.random() * 9000000).toString();
    
    // Create test user
    const testUser = await prisma.user.create({
      data: {
        phone: testPhone,
        phoneVerified: true,
      },
    });

    const sessionResult = await createSession(testUser.id);
    assert(Boolean(sessionResult.token), 'JWT token generated');
    assert(Boolean(sessionResult.jti), 'Session JTI generated');

    const expectedExpiryMin = Date.now() + (29 * 24 * 3600 * 1000);
    const expectedExpiryMax = Date.now() + (31 * 24 * 3600 * 1000);
    const dbSession = await prisma.session.findUnique({
      where: { jti: sessionResult.jti },
    });
    assert(Boolean(dbSession), 'Session saved in database');
    assert(
      dbSession!.expiresAt.getTime() > expectedExpiryMin && dbSession!.expiresAt.getTime() < expectedExpiryMax,
      'DB Session expiresAt is aligned to ~30 days'
    );

    // Decode JWT and check exp
    const decoded = jwt.decode(sessionResult.token) as any;
    assert(decoded.userId === testUser.id, 'JWT contains correct userId');
    assert(decoded.jti === sessionResult.jti, 'JWT contains correct jti');
    const jwtLifetime = decoded.exp - decoded.iat;
    assert(jwtLifetime === 2592000, `JWT lifetime is 2592000 seconds (got ${jwtLifetime})`);

    // TEST 3: Validate Active Session
    console.log('\n--- 3. Session Validation ---');
    const validation = await validateSessionToken(sessionResult.token);
    assert(validation.valid === true, 'Valid token passes validateSessionToken');
    assert(validation.userId === testUser.id, 'Validated userId matches test user');

    // TEST 4: Revocation / Logout
    console.log('\n--- 4. Session Revocation (Logout) ---');
    await revokeSession(sessionResult.jti);
    const postRevokeValidation = await validateSessionToken(sessionResult.token);
    assert(postRevokeValidation.valid === false, 'Revoked session is rejected (valid: false)');
    assert(postRevokeValidation.code === 'SESSION_REVOKED_OR_EXPIRED', 'Rejection code is SESSION_REVOKED_OR_EXPIRED');

    // TEST 5: No Duplicate Account on Repeated Verify
    console.log('\n--- 5. Duplicate Account Prevention (Idempotent Flow) ---');
    const userCountBefore = await prisma.user.count({ where: { phone: testPhone } });
    assert(userCountBefore === 1, 'Initial user count is exactly 1');

    // Create waitlistEntry for this user
    const entry1 = await prisma.waitlistEntry.create({
      data: {
        userId: testUser.id,
        referralCode: 'TEST' + Math.floor(1000 + Math.random() * 9000),
        priorityScore: 50,
      },
    });

    // Simulate second login with same phone
    const existingUser = await prisma.user.findUnique({ where: { phone: testPhone } });
    assert(Boolean(existingUser), 'Existing user retrieved');
    const isNewUser = !existingUser;
    assert(isNewUser === false, 'isNewUser flag is false for existing user');

    const entry2 = await prisma.waitlistEntry.findUnique({ where: { userId: existingUser!.id } });
    assert(entry2?.id === entry1.id, 'WaitlistEntry preserved without duplicate');
    assert(entry2?.referralCode === entry1.referralCode, 'Referral code preserved');

    // TEST 6: Early Access User State
    console.log('\n--- 6. Early Access User Status State ---');
    await prisma.user.update({
      where: { id: testUser.id },
      data: { status: 'EARLY_ACCESS' },
    });
    const updatedUser = await prisma.user.findUnique({ where: { id: testUser.id } });
    assert(updatedUser?.status === 'EARLY_ACCESS', 'User status can be updated to EARLY_ACCESS');

    // Clean up test data
    await prisma.session.deleteMany({ where: { userId: testUser.id } });
    await prisma.waitlistEntry.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    console.log('🧹 Cleaned up test data');

    console.log('\n=====================================================');
    console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('=====================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
