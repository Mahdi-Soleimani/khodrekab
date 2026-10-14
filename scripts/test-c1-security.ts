import assert from 'assert';
import { generatePoWChallenge, verifyPoWSolution, validateHoneypotAndTiming, solvePoW } from '../src/lib/security/pow';
import { resolveClientIp, isPeerTrusted } from '../src/lib/security/ip';
import { checkSmsRateLimits } from '../src/lib/security/limiter';
import { computeOtpHash, verifyOtpTimingSafe, checkOtpLockout, recordOtpFailure, clearOtpFailure } from '../src/lib/security/otp';
import { closeRedisConnection } from '../src/lib/security/redis';

async function runC1Tests() {
  console.log('====================================================');
  console.log('   CARNO PHASE C1 SECURITY HARDENING TEST SUITE    ');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    total++;
    return (async () => {
      try {
        await fn();
        console.log(`  [PASS] ${name}`);
        passed++;
      } catch (err: any) {
        console.error(`  [FAIL] ${name}:`, err.message);
        throw err;
      }
    })();
  }

  // --- 1. In-House Proof-of-Work & Bot Guard ---
  console.log('--- 1. In-House Proof-of-Work & Bot Protection ---');

  await test('PoW Challenge Generation and Valid Solution', () => {
    const chal = generatePoWChallenge(3); // 3 leading zeros
    assert(chal.challenge.length > 20, 'Challenge should be non-empty base64 string');
    assert.strictEqual(chal.difficulty, 3);

    const solution = solvePoW(chal.challenge, 3);
    const result = verifyPoWSolution({ challenge: chal.challenge, solution });
    assert.strictEqual(result.valid, true, 'Valid solution must be accepted');
  });

  await test('PoW Invalid Solution Rejected', () => {
    const chal = generatePoWChallenge(3);
    const result = verifyPoWSolution({ challenge: chal.challenge, solution: 'invalid_candidate_999999' });
    assert.strictEqual(result.valid, false, 'Invalid solution must be rejected');
  });

  await test('Honeypot & Fill-Time Validation', () => {
    // Non-empty honeypot -> reject
    const botCheck = validateHoneypotAndTiming({ _hp: 'spam_value', fillTimeMs: 3000 });
    assert.strictEqual(botCheck.valid, false, 'Non-empty honeypot must be rejected');

    // Fill time < 1500ms -> reject
    const fastCheck = validateHoneypotAndTiming({ _hp: '', fillTimeMs: 800 });
    assert.strictEqual(fastCheck.valid, false, 'Instant submission (<1.5s) must be rejected');

    // Human fill time >= 1500ms and empty honeypot -> accept
    const humanCheck = validateHoneypotAndTiming({ _hp: '', fillTimeMs: 2500 });
    assert.strictEqual(humanCheck.valid, true, 'Human submission must be accepted');
  });

  // --- 2. Trusted Client-IP Resolution (Amendment A3) ---
  console.log('\n--- 2. Trusted Client-IP Resolution (Amendment A3) ---');

  await test('Peer in trusted CIDR honored, untrusted peer ignored', () => {
    process.env.TRUSTED_IP_HEADER = 'x-forwarded-for';
    process.env.TRUSTED_PROXY_CIDRS = '10.0.0.0/8,185.143.0.0/16';

    // Request from untrusted peer (e.g. 203.0.113.50) spoofing header
    const untrustedReq = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '1.1.1.1' },
    });
    const ipUntrusted = resolveClientIp(untrustedReq, '203.0.113.50');
    assert.strictEqual(ipUntrusted, '203.0.113.50', 'Untrusted peer header must be ignored');

    // Request from trusted edge proxy (185.143.5.10) with XFF
    const trustedReq = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '5.200.10.20, 185.143.5.10' },
    });
    const ipTrusted = resolveClientIp(trustedReq, '185.143.5.10');
    assert.strictEqual(ipTrusted, '5.200.10.20', 'Client IP from trusted edge must be resolved right-to-left');
  });

  await test('Missing TRUSTED_PROXY_CIDRS in production ignores header', () => {
    const oldEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'production';
    process.env.TRUSTED_IP_HEADER = 'arvan-client-ip';
    process.env.TRUSTED_PROXY_CIDRS = '';

    const req = new Request('http://localhost', {
      headers: { 'arvan-client-ip': '1.2.3.4' },
    });
    const resolved = resolveClientIp(req, '192.168.1.5');
    assert.strictEqual(resolved, '192.168.1.5', 'Header must be ignored when CIDRs is empty in production');

    (process.env as any).NODE_ENV = oldEnv;
  });

  // --- 3. Rate Limiting & Cooldown Ladder (B.1) ---
  console.log('\n--- 3. Rate Limiting & Progressive Cooldown ---');

  await test('Kill Switch Fail-Closed', async () => {
    process.env.SMS_KILL_SWITCH = 'true';
    const res = await checkSmsRateLimits({ phone: '09121111111', clientIp: '192.168.1.1' });
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.statusCode, 503);
    assert(res.userMessage?.includes('جهت بهینه‌سازی'), 'Must return respectful Persian kill switch message');
    process.env.SMS_KILL_SWITCH = 'false';
  });

  await test('Progressive Cooldown Ladder Progression', async () => {
    const phone = '0912' + Math.floor(1000000 + Math.random() * 8999999).toString();
    const ip = '10.20.30.40';

    // 1st request -> allowed, sets 60s cooldown
    const r1 = await checkSmsRateLimits({ phone, clientIp: ip });
    assert.strictEqual(r1.allowed, true);
    assert.strictEqual(r1.cooldownSeconds, 60);

    // Immediate second request -> rejected by cooldown ladder
    const r2 = await checkSmsRateLimits({ phone, clientIp: ip });
    assert.strictEqual(r2.allowed, false);
    assert.strictEqual(r2.statusCode, 429);
    assert(r2.userMessage?.includes('ثانیه دیگر دوباره امتحان کنید'), 'Must return Persian cooldown message');
  });

  // --- 4. HMAC-SHA256 OTP Storage & Timing-Safe Equality (B.2, D5) ---
  console.log('\n--- 4. HMAC-SHA256 Storage & Timing Safety (D5) ---');

  await test('HMAC OTP Digest & Timing-Safe Comparison', () => {
    const phone = '09123456789';
    const challengeId = 'cuid_test_12345';
    const correctCode = '54321';
    const wrongCode = '54320';

    const hashCorrect = computeOtpHash(phone, challengeId, correctCode);
    const hashWrong = computeOtpHash(phone, challengeId, wrongCode);

    assert.strictEqual(verifyOtpTimingSafe(hashCorrect, hashCorrect), true, 'Correct hash must verify');
    assert.strictEqual(verifyOtpTimingSafe(hashWrong, hashCorrect), false, 'Wrong hash must fail');
  });

  // --- 5. Cross-Challenge Lockout & Fail-Closed Counter (A1 b, c) ---
  console.log('\n--- 5. Cross-Challenge Lockout & Fail-Closed Counter (A1 b, c) ---');

  await test('Lockout after 10 failed attempts across challenges', async () => {
    const testPhone = '09128887766';
    await clearOtpFailure(testPhone);

    // Record 9 failures
    for (let i = 0; i < 9; i++) {
      await recordOtpFailure(testPhone);
    }
    const stateBefore = await checkOtpLockout(testPhone);
    assert.strictEqual(stateBefore.locked, false, '9 failed attempts should not trigger lockout');

    // 10th failure -> lockout triggers
    await recordOtpFailure(testPhone);
    const stateAfter = await checkOtpLockout(testPhone);
    assert.strictEqual(stateAfter.locked, true, '10th failed attempt must trigger 30-minute lockout');
    assert(stateAfter.remainingSeconds! > 0, 'Remaining lockout seconds must be positive');

    // Cleanup
    await clearOtpFailure(testPhone);
    const stateClean = await checkOtpLockout(testPhone);
    assert.strictEqual(stateClean.locked, false, 'Cleared counter must allow verify');
  });

  // Teardown
  await closeRedisConnection();

  console.log(`\n====================================================`);
  console.log(`   TEST RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log(`====================================================\n`);
}

runC1Tests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
