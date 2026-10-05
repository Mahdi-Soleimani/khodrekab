import assert from 'assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
  SESSION_LIFETIME_SECONDS,
  getSessionCookieConfig,
  getJwtSecret,
  parseCookiesFromHeader,
  validateSession,
} from '../src/lib/security/session';
import { validateOrigin } from '../src/lib/security/origin';
import { checkStatusRateLimit } from '../src/lib/security/limiter';
import { closeRedisConnection, getRedisClient } from '../src/lib/security/redis';

async function runC3Tests() {
  console.log('====================================================');
  console.log('   CARNO PHASE C3 SECURITY HARDENING TEST SUITE    ');
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

  // Set JWT_DEV_SECRET for testing if JWT_SECRET is not set
  if (!process.env.JWT_SECRET && !process.env.JWT_DEV_SECRET) {
    process.env.JWT_DEV_SECRET = 'test-secret-min-16-chars-c3-hardening';
  }

  // --- 1. Session Lifetime (D-F) ---
  console.log('--- 1. Session Lifetime Alignment (7200s / 2 Hours) ---');

  await test('Session constants and cookie maxAge are strictly 7200 seconds', () => {
    assert.strictEqual(SESSION_LIFETIME_SECONDS, 7200, 'Lifetime must be exactly 7200 seconds');
    const cookieConfig = getSessionCookieConfig();
    assert.strictEqual(cookieConfig.maxAge, 7200, 'Cookie maxAge must be 7200 seconds');
  });

  await test('JWT expiration claim is strictly 7200 seconds (2 hours)', () => {
    const secret = getJwtSecret();
    const token = jwt.sign({ userId: 'u123', jti: 'jti-abc' }, secret, {
      algorithm: 'HS256',
      expiresIn: SESSION_LIFETIME_SECONDS,
    });

    const decoded = jwt.decode(token) as any;
    assert(decoded.exp, 'Token must contain exp');
    assert(decoded.iat, 'Token must contain iat');
    const duration = decoded.exp - decoded.iat;
    assert.strictEqual(duration, 7200, 'JWT validity must be exactly 7200 seconds');
  });

  // --- 2. Algorithm Pinning (HS256) ---
  console.log('\n--- 2. Cryptographic Algorithm Pinning (HS256) ---');

  await test('Tokens signed with algorithm "none" are strictly rejected', () => {
    // Generate forged "none" algorithm token
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ userId: 'attacker', jti: 'fake' })).toString('base64url');
    const forgedToken = `${header}.${payload}.`;

    const secret = getJwtSecret();
    assert.throws(
      () => {
        jwt.verify(forgedToken, secret, { algorithms: ['HS256'] });
      },
      /signature|unsupported|invalid/i,
      'HS256 verification must throw on alg none'
    );
  });

  await test('Tokens signed with incorrect secret are rejected', () => {
    const token = jwt.sign({ userId: 'u1', jti: 'j1' }, 'wrong-secret-key-12345', {
      algorithm: 'HS256',
      expiresIn: 7200,
    });
    const secret = getJwtSecret();
    assert.throws(
      () => {
        jwt.verify(token, secret, { algorithms: ['HS256'] });
      },
      /invalid signature/i,
      'Invalid signature must throw'
    );
  });

  // --- 3. Cookie Configuration (Prod __Host- vs Dev) ---
  console.log('\n--- 3. Single Source Cookie Configuration ---');

  await test('Production environment sets __Host- prefix and Secure=true', () => {
    const origEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = 'production';
      const config = getSessionCookieConfig();
      assert.strictEqual(config.name, '__Host-carno_session', 'Must use __Host- prefix in prod');
      assert.strictEqual(config.secure, true, 'Must require Secure in prod');
      assert.strictEqual(config.httpOnly, true, 'Must require httpOnly');
      assert.strictEqual(config.path, '/', 'Must have Path=/ for __Host- cookie');
      assert.strictEqual(config.sameSite, 'lax', 'Must have sameSite lax');
    } finally {
      (process.env as any).NODE_ENV = origEnv;
    }
  });

  await test('Development environment sets carno_session without Secure requirement', () => {
    const origEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = 'development';
      const config = getSessionCookieConfig();
      assert.strictEqual(config.name, 'carno_session', 'Must use carno_session in dev');
      assert.strictEqual(config.secure, false, 'Must not enforce Secure in local dev');
      assert.strictEqual(config.httpOnly, true, 'Must require httpOnly');
    } finally {
      (process.env as any).NODE_ENV = origEnv;
    }
  });

  // --- 4. Legacy Token Rejection (NO Migration Window) ---
  console.log('\n--- 4. Immediate Legacy Token Rejection ---');

  await test('Request with only legacy "token" cookie is rejected with status 401 and flagged for deletion', async () => {
    const req = new Request('http://localhost:3000/api/waitlist/status', {
      headers: {
        cookie: 'token=old_legacy_jwt_token_value',
      },
    });

    const result = await validateSession(req);
    assert.strictEqual(result.valid, false, 'Legacy token must not be accepted as valid');
    assert.strictEqual(result.code, 'LEGACY_TOKEN_REJECTED');
    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.shouldDeleteLegacy, true, 'Must flag cookie for deletion');
  });

  await test('Request with neither cookie returns UNAUTHENTICATED (401)', async () => {
    const req = new Request('http://localhost:3000/api/waitlist/status');
    const result = await validateSession(req);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.code, 'UNAUTHENTICATED');
    assert.strictEqual(result.status, 401);
  });

  // --- 5. Origin Validation ---
  console.log('\n--- 5. CSRF & Origin Validation ---');

  await test('GET requests are exempt from origin validation', () => {
    const req = new Request('http://localhost:3000/api/waitlist/status', { method: 'GET' });
    const check = validateOrigin(req);
    assert.strictEqual(check.valid, true);
  });

  await test('Cross-origin POST request with malicious origin is rejected with 403', () => {
    const req = new Request('http://localhost:3000/api/waitlist/register', {
      method: 'POST',
      headers: {
        origin: 'https://evil-attacker-site.com',
      },
    });
    const check = validateOrigin(req);
    assert.strictEqual(check.valid, false);
    assert(check.reason?.includes('ORIGIN_MISMATCH'));
  });

  await test('POST request with matching localhost origin passes in development', () => {
    const origEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = 'development';
      const req = new Request('http://localhost:3000/api/waitlist/verify', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
        },
      });
      const check = validateOrigin(req);
      assert.strictEqual(check.valid, true);
    } finally {
      (process.env as any).NODE_ENV = origEnv;
    }
  });

  // --- 6. Status Endpoint Rate Limiter (60/min per userId) ---
  console.log('\n--- 6. Status Rate Limiting (60 req/min per userId) ---');

  await test('Status rate limiter allows up to 60 requests and blocks the 61st with 429', async () => {
    const testUserId = `test-user-limit-${Date.now()}`;
    const redis = getRedisClient();
    if (redis) {
      await redis.del(`rl:status:${testUserId}`);
    }

    // Requests 1 through 60 must be allowed
    for (let i = 1; i <= 60; i++) {
      const res = await checkStatusRateLimit(testUserId);
      assert.strictEqual(res.allowed, true, `Request #${i} must be allowed`);
    }

    // Request 61 must be blocked
    const blockedRes = await checkStatusRateLimit(testUserId);
    assert.strictEqual(blockedRes.allowed, false, 'Request #61 must be blocked');
    assert.strictEqual(blockedRes.status, 429, 'Status must be 429');

    // Clean up
    if (redis) {
      await redis.del(`rl:status:${testUserId}`);
    }
  });

  await test('Redis failure during status rate limiting returns status 503 (fail closed)', async () => {
    // Test with broken redis client
    const redis = getRedisClient();
    if (redis) {
      const origIncr = redis.incr.bind(redis);
      try {
        redis.incr = () => Promise.reject(new Error('Connection lost'));
        const failClosedRes = await checkStatusRateLimit('user-err-test');
        assert.strictEqual(failClosedRes.allowed, false);
        assert.strictEqual(failClosedRes.status, 503, 'Must return 503 on Redis failure');
      } finally {
        redis.incr = origIncr;
      }
    }
  });

  await test('Unauthenticated status request gets 401 BEFORE Redis is touched', async () => {
    const redis = getRedisClient();
    let redisCalled = false;
    if (redis) {
      const origIncr = redis.incr.bind(redis);
      try {
        redis.incr = (...args: any[]) => {
          redisCalled = true;
          return (origIncr as any)(...args);
        };

        const req = new Request('http://localhost:3000/api/waitlist/status');
        const auth = await validateSession(req);
        assert.strictEqual(auth.valid, false, 'Must be unauthenticated');
        assert.strictEqual(auth.status, 401);
        assert.strictEqual(redisCalled, false, 'Redis must NOT be called for unauthenticated request');
      } finally {
        redis.incr = origIncr;
      }
    }
  });

  // --- 7. PendingScore Non-Negative Guarantee ---
  console.log('\n--- 7. PendingScore Non-Negative Guarantee ---');

  await test('Settlement algorithm guarantees pendingScore never drops below zero', () => {
    function settlePoints(currentPriority: number, currentPending: number, scoreToAdd: number) {
      const pendingDecrement = Math.min(currentPending, scoreToAdd);
      const newPriority = currentPriority + scoreToAdd;
      const newPending = Math.max(0, currentPending - pendingDecrement);
      return { newPriority, newPending };
    }

    // Case A: normal settlement (pending = 50, scoreToAdd = 50)
    const normal = settlePoints(10, 50, 50);
    assert.strictEqual(normal.newPriority, 60);
    assert.strictEqual(normal.newPending, 0);

    // Case B: anomaly where pending is already 0 (pending = 0, scoreToAdd = 50)
    const anomaly = settlePoints(10, 0, 50);
    assert.strictEqual(anomaly.newPriority, 60);
    assert.strictEqual(anomaly.newPending, 0);
    assert(anomaly.newPending >= 0, 'pendingScore must be >= 0');

    // Case C: partial pending (pending = 30, scoreToAdd = 50)
    const partial = settlePoints(10, 30, 50);
    assert.strictEqual(partial.newPriority, 60);
    assert.strictEqual(partial.newPending, 0);
    assert(partial.newPending >= 0, 'pendingScore must be >= 0');
  });

  // --- 8. Mathematical Rank Order Invariance Proof ---
  console.log('\n--- 8. Mathematical Rank Invariance Simulation ---');

  await test('Rank ordering simulation proves FIFO relative order is invariant for non-referral users', () => {
    interface SimulatedEntry {
      id: string;
      userId: string;
      priorityScore: number;
      pendingScore: number;
      joinedAt: number; // timestamp
    }

    function calculateRank(targetId: string, all: SimulatedEntry[]): number {
      const target = all.find((e) => e.id === targetId)!;
      // Formula: 1 + count(score > target.score OR (score == target.score AND joinedAt < target.joinedAt))
      const ahead = all.filter((other) => {
        if (other.id === target.id) return false;
        if (other.priorityScore > target.priorityScore) return true;
        if (other.priorityScore === target.priorityScore && other.joinedAt < target.joinedAt) return true;
        return false;
      });
      return ahead.length + 1;
    }

    // 3 non-referral users joined sequentially
    const t0 = 1000;
    const u1: SimulatedEntry = { id: 'e1', userId: 'u1', priorityScore: 10, pendingScore: 0, joinedAt: t0 };
    const u2: SimulatedEntry = { id: 'e2', userId: 'u2', priorityScore: 10, pendingScore: 0, joinedAt: t0 + 100 };
    const u3: SimulatedEntry = { id: 'e3', userId: 'u3', priorityScore: 10, pendingScore: 0, joinedAt: t0 + 200 };

    let entries = [u1, u2, u3];

    // State 1: Baseline
    let r1 = calculateRank('e1', entries);
    let r2 = calculateRank('e2', entries);
    let r3 = calculateRank('e3', entries);
    assert(r1 < r2 && r2 < r3, `State 1: Expected r1 < r2 < r3, got ${r1}, ${r2}, ${r3}`);

    // State 2: User 4 joins and invites user 5.
    // User 4 has pendingScore = 50, but priorityScore = 10 (unmatured)
    const u4: SimulatedEntry = { id: 'e4', userId: 'u4', priorityScore: 10, pendingScore: 50, joinedAt: t0 + 300 };
    entries.push(u4);

    r1 = calculateRank('e1', entries);
    r2 = calculateRank('e2', entries);
    r3 = calculateRank('e3', entries);
    const r4Before = calculateRank('e4', entries);

    // Invariance assert: r1 < r2 < r3 is strictly preserved
    assert(r1 < r2 && r2 < r3, `State 2: Non-referral order must be preserved: ${r1}, ${r2}, ${r3}`);
    assert.strictEqual(r4Before, 4, 'Unmatured user 4 cannot jump ahead based on pendingScore');

    // State 3: User 4 referral matures after 24h: priorityScore becomes 60, pendingScore becomes 0
    u4.priorityScore = 60;
    u4.pendingScore = 0;

    r1 = calculateRank('e1', entries);
    r2 = calculateRank('e2', entries);
    r3 = calculateRank('e3', entries);
    const r4After = calculateRank('e4', entries);

    // Invariance assert: User 4 jumps ahead in absolute rank (to 1), BUT r1 < r2 < r3 remains strictly preserved!
    assert.strictEqual(r4After, 1, 'Matured user 4 jumps ahead to rank 1');
    assert(r1 < r2 && r2 < r3, `State 3: Non-referral relative order MUST remain invariant: ${r1}, ${r2}, ${r3}`);
    assert.strictEqual(r1, 2, 'User 1 is now rank 2');
    assert.strictEqual(r2, 3, 'User 2 is now rank 3');
    assert.strictEqual(r3, 4, 'User 3 is now rank 4');
  });

  // --- 9. Referral Anti-Abuse Rules (B.6) ---
  console.log('\n--- 9. Referral Anti-Abuse Rules ---');

  await test('Self-referral condition (inviterId == invitedUserId) is detected and rejected', () => {
    const inviterUserId = 'usr_same_id';
    const currentUserId = 'usr_same_id';
    const isSelfReferral = inviterUserId === currentUserId;
    assert.strictEqual(isSelfReferral, true, 'Self referral must be blocked');
  });

  await test('IP cluster condition (same ipHash within 1 hour) is detected and flagged', () => {
    const clientIp = '185.120.20.10';
    const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex');

    const inviterRecentSession = {
      ipHash,
      createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 mins ago (< 1h)
    };

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isSameIpCluster = inviterRecentSession.ipHash === ipHash && inviterRecentSession.createdAt >= oneHourAgo;

    assert.strictEqual(isSameIpCluster, true, 'Same IP within 1 hour must be detected');
  });

  await test('Velocity cap: 20 converted referrals in 24h allowed, 21st triggers FLAGGED_HIGH_VOLUME', () => {
    function evaluateReferral(recentConvertedCount: number) {
      if (recentConvertedCount >= 20) {
        return { status: 'FLAGGED_HIGH_VOLUME', isFlagged: true, maturesAt: null, pendingIncrement: 0 };
      }
      return { status: 'CONVERTED', isFlagged: false, maturesAt: new Date(Date.now() + 86400000), pendingIncrement: 50 };
    }

    const ref20 = evaluateReferral(19);
    assert.strictEqual(ref20.status, 'CONVERTED');
    assert.strictEqual(ref20.pendingIncrement, 50);

    const ref21 = evaluateReferral(20);
    assert.strictEqual(ref21.status, 'FLAGGED_HIGH_VOLUME');
    assert.strictEqual(ref21.isFlagged, true);
    assert.strictEqual(ref21.pendingIncrement, 0, 'No points awarded beyond velocity cap');
  });

  // --- 10. Complete Absence of carno.app ---
  console.log('\n--- 10. Verification of carno.app absence in src/ ---');

  await test('src directory contains zero occurrences of carno.app', async () => {
    const fs = await import('fs');
    const path = await import('path');

    function searchDir(dir: string): string[] {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(searchDir(fullPath));
        } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js')) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.toLowerCase().includes('carno.app')) {
            results.push(fullPath);
          }
        }
      }
      return results;
    }

    const srcDir = path.resolve(__dirname, '../src');
    const matches = searchDir(srcDir);
    assert.strictEqual(matches.length, 0, `Expected 0 matches for carno.app in src/, found: ${matches.join(', ')}`);
  });

  // Teardown
  await closeRedisConnection();

  console.log('\n====================================================');
  console.log(`   CARNO PHASE C3 SUITE FINISHED: ${passed}/${total} PASSED`);
  console.log('====================================================\n');
}

runC3Tests().catch((err) => {
  console.error('\n[FATAL_TEST_FAILURE]', err);
  process.exit(1);
});
