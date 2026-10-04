/**
 * LOCAL-ONLY E2E INTEGRATION TEST (C1 DOCKER VERIFICATION)
 * Tests Redis UP (Test A) and Redis DOWN (Test B) fail-closed behavior.
 * STRICTLY FORBIDDEN to run against a production environment.
 */

import crypto from 'crypto';

if (process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: Never run this test script against production');
}

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
if (!BASE_URL.startsWith('http://localhost') && !BASE_URL.startsWith('http://127.0.0.1')) {
  throw new Error('FATAL: Target URL must be a local development host');
}

const OTP_PEPPER = process.env.OTP_PEPPER || '';
if (!OTP_PEPPER) {
  throw new Error('OTP_PEPPER env var required for this test (e.g. set -a; source .env; set +a)');
}

const TEST_PHONE = '0912' + Math.floor(1000000 + Math.random() * 9000000).toString();

async function solvePoW(challenge: string, difficulty: number): Promise<string> {
  const prefix = '0'.repeat(difficulty);
  let nonce = 0;
  while (true) {
    const hash = crypto
      .createHash('sha256')
      .update(`${challenge}:${nonce}`)
      .digest('hex');
    if (hash.startsWith(prefix)) {
      return nonce.toString();
    }
    nonce++;
  }
}

async function findOtpFromDb(challengeId: string, phone: string, targetHash: string): Promise<string> {
  for (let i = 10000; i < 100000; i++) {
    const code = i.toString();
    const hash = crypto
      .createHmac('sha256', OTP_PEPPER)
      .update(`${phone}:${challengeId}:${code}`)
      .digest('hex');
    if (hash === targetHash) {
      return code;
    }
  }
  throw new Error('OTP not found in range 10000..99999');
}

async function runTestA() {
  console.log('\n--- [TEST الف] Redis UP ---');
  
  // 1. Get PoW challenge
  console.log('1. Requesting PoW challenge...');
  const chalRes = await fetch(`${BASE_URL}/api/waitlist/challenge`);
  if (!chalRes.ok) throw new Error(`Challenge failed with status ${chalRes.status}`);
  const { challenge, difficulty } = await chalRes.json();
  console.log('   Challenge received, solving difficulty', difficulty, '...');
  const solution = await solvePoW(challenge, difficulty);
  console.log('   Solution found:', solution);

  // 2. Submit Phone to register
  console.log(`2. Submitting phone ${TEST_PHONE} to /api/waitlist/register...`);
  const regRes = await fetch(`${BASE_URL}/api/waitlist/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: TEST_PHONE,
      pow: { challenge, solution },
      fillTimeMs: 4500,
    }),
  });

  const regStatus = regRes.status;
  const regJson = await regRes.json();
  console.log(`   Response status: ${regStatus}`);
  console.log(`   Response body:`, regJson);

  if (regStatus !== 200) {
    throw new Error(`Expected 200 from register, got ${regStatus}: ${JSON.stringify(regJson)}`);
  }
  if (regJson.message !== 'اگر شماره درست باشد، کد ارسال می‌شود.') {
    throw new Error(`Unexpected message: ${regJson.message}`);
  }
  console.log('   ✓ Neutral message verified: «اگر شماره درست باشد، کد ارسال می‌شود.»');

  // 3. Find OTP challenge from DB
  console.log('3. Fetching challenge from database via docker exec psql...');
  const { execSync } = await import('child_process');
  const psqlOut = execSync(
    `docker exec divarlanding-db-1 psql -U postgres -d carlanding -t -A -c "SELECT id, \\"codeHash\\" FROM \\"OTPVerification\\" WHERE phone = '${TEST_PHONE}' AND verified = false ORDER BY \\"createdAt\\" DESC LIMIT 1;"`
  ).toString().trim();

  const [challengeId, codeHash] = psqlOut.split('|');
  console.log(`   Found challenge in DB: ID=${challengeId}`);
  const otpCode = await findOtpFromDb(challengeId, TEST_PHONE, codeHash);
  console.log(`   Recovered OTP: ${otpCode}`);

  // 4. Verify OTP
  console.log(`4. Submitting OTP ${otpCode} to /api/waitlist/verify...`);
  const verifyRes = await fetch(`${BASE_URL}/api/waitlist/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: TEST_PHONE,
      otp: otpCode,
    }),
  });

  const verifyStatus = verifyRes.status;
  const verifyJson = await verifyRes.json();
  console.log(`   Response status: ${verifyStatus}`);
  console.log(`   Response body:`, verifyJson);

  if (verifyStatus !== 200 || !verifyJson.success) {
    throw new Error(`Expected 200 success from verify, got ${verifyStatus}: ${JSON.stringify(verifyJson)}`);
  }
  console.log('   ✓ OTP verification successful!');

  // Extract session cookie if any
  const cookie = verifyRes.headers.get('set-cookie') || '';
  
  // 5. Fetch Status & Rank
  console.log('5. Fetching rank from /api/waitlist/status...');
  const statusRes = await fetch(`${BASE_URL}/api/waitlist/status`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const statusJson = await statusRes.json();
  console.log('   Status response:', statusJson);
  console.log(`   ✓ Rank received: #${statusJson.data?.rank || 'N/A'}`);
}

async function runTestB() {
  console.log('\n--- [TEST ب] Redis DOWN ---');
  const { execSync } = await import('child_process');

  console.log('1. Stopping divarlanding-redis-1 container...');
  execSync('docker stop divarlanding-redis-1');
  console.log('   divarlanding-redis-1 stopped.');

  try {
    // Attempt registration while Redis is down
    console.log('2. Attempting registration while Redis is DOWN...');
    const chalRes = await fetch(`${BASE_URL}/api/waitlist/challenge`);
    let powPayload = undefined;
    if (chalRes.ok) {
      const { challenge, difficulty } = await chalRes.json();
      const solution = await solvePoW(challenge, difficulty);
      powPayload = { challenge, solution };
    }

    const regRes = await fetch(`${BASE_URL}/api/waitlist/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '09121110099',
        pow: powPayload,
        fillTimeMs: 5000,
      }),
    });

    const regStatus = regRes.status;
    const regJson = await regRes.json();
    console.log(`   Response status: ${regStatus}`);
    console.log(`   Response body:`, regJson);

    if (regStatus !== 503) {
      throw new Error(`Expected 503 Service Unavailable, got ${regStatus}`);
    }
    console.log('   ✓ Verified 503 Fail-Closed response when Redis is DOWN!');
    console.log('   Message:', regJson.error);
  } finally {
    console.log('3. Restarting divarlanding-redis-1...');
    execSync('docker start divarlanding-redis-1');
    console.log('   divarlanding-redis-1 restarted.');
    // Give redis a second to re-establish
    await new Promise(r => setTimeout(r, 2000));
  }

  // 4. Verify recovery
  console.log('4. Verifying service recovered after Redis restart...');
  const chalRes = await fetch(`${BASE_URL}/api/waitlist/challenge`);
  console.log('   Challenge endpoint after restart:', chalRes.status);
  if (chalRes.status === 200) {
    console.log('   ✓ Service fully recovered!');
  }
}

async function main() {
  try {
    await runTestA();
    await runTestB();
    console.log('\n====================================');
    console.log('ALL MANUAL INTEGRATION TESTS PASSED!');
    console.log('====================================\n');
  } catch (err) {
    console.error('\nTEST FAILED:', err);
    process.exit(1);
  }
}

main();
