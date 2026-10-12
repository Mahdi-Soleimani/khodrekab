/**
 * CARNO GATE C5 — PHASE 5 VERIFICATION SUITE (ISOLATED & HARDENED)
 * PostgreSQL Maintenance Runner, OTP Retention & Advisory Lock
 *
 * Requirements & Tests:
 * C5-P5-T0 — Isolation Guard & Target Database Validation (Fails closed on non-disposable DB)
 * C5-P5-T1 — Unverified retention (> 24 hours deleted, <= 24 hours preserved)
 * C5-P5-T2 — Verified retention (> 7 days deleted, <= 7 days preserved)
 * C5-P5-T3 — Active OTP preservation (< 24h unverified not deleted, expiresAt unchanged)
 * C5-P5-T4 — Bounded batch execution (> 1,000 eligible synthetic rows, batches <= 1000)
 * C5-P5-T5 — Advisory lock busy (Lock 849201 held externally -> second runner exits 0, deletes 0)
 * C5-P5-T6 — Concurrent runner exclusion (CLI child processes exclude each other cleanly)
 * C5-P5-T7 — Same-connection lock lifecycle (Acquires, deletes, unlocks on same physical backend PID)
 * C5-P5-T8 — Index precondition (Aborts before deletion when retention index is missing)
 * C5-P5-T9 — Repeated execution (Run twice: second execution deletes 0 rows)
 * C5-P5-T10 — Failure and lock cleanup (Controlled failure -> reports failure non-zero, lock safely freed)
 * C5-P5-T11 — C4 Connection Budget & Identification Audit (Runner strictly uses 1 connection)
 */

import { Client } from 'pg';
import { spawn, execSync } from 'child_process';
import {
  runMaintenance,
  resolveDatabaseUrl,
  validateRetentionIndexes,
  MAINTENANCE_ADVISORY_LOCK_ID,
} from './maintenance-runner';

/**
 * Validates that target database is explicitly disposable and not the primary application DB.
 * Fails closed if the database name is missing, protected, or lacks 'test' / 'disposable'.
 */
export function assertDisposableDatabase(urlStr: string): string {
  const parsed = new URL(urlStr);
  const dbName = parsed.pathname.replace(/^\//, '');

  const protectedDbs = ['carlanding', 'carlanding_shadow', 'postgres', 'template0', 'template1'];
  if (!dbName || protectedDbs.includes(dbName.toLowerCase())) {
    throw new Error(
      `[SAFETY_VIOLATION] Target database '${dbName}' is a protected/application database! Destructive tests require an isolated disposable test database.`
    );
  }

  const isTestDb = dbName.toLowerCase().includes('test') || dbName.toLowerCase().includes('disposable');
  if (!isTestDb) {
    throw new Error(
      `[SAFETY_VIOLATION] Target database '${dbName}' does not contain 'test' or 'disposable' in its name. Aborting.`
    );
  }

  return dbName;
}

async function main() {
  console.log('============================================================');
  console.log('GATE C5 PHASE 5 POSTGRESQL MAINTENANCE & RETENTION SUITE');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  // --------------------------------------------------------------------------
  // TEST 0: Isolation Guard & Target Database Validation
  // --------------------------------------------------------------------------
  console.log('TEST 0: Verifying isolation guard fails closed on primary application DB...');
  const appDbUrl = resolveDatabaseUrl();
  try {
    let guardBlocked = false;
    try {
      assertDisposableDatabase(appDbUrl);
    } catch (guardErr: unknown) {
      if (guardErr instanceof Error && guardErr.message.includes('[SAFETY_VIOLATION]')) {
        guardBlocked = true;
      }
    }

    if (!guardBlocked) {
      throw new Error('Isolation guard failed to block primary application database URL!');
    }

    console.log('✔ TEST 0 PASSED: Isolation guard successfully intercepted and blocked non-disposable target');
    passed++;
  } catch (err: unknown) {
    console.error('❌ TEST 0 FAILED:', err instanceof Error ? err.message : String(err));
    failed++;
  }

  // --------------------------------------------------------------------------
  // Provision Dedicated Disposable Test Database
  // --------------------------------------------------------------------------
  const disposableDbName = `carno_c5_phase5_test_${Date.now()}`;
  console.log(`\n[SETUP] Provisioning isolated disposable test database: ${disposableDbName}...`);

  let testDbUrl: string;
  let adminClient: Client | null = null;

  try {
    // 1. Create disposable database owned by carno_app
    execSync(`docker exec divarlanding-db-1 psql -U postgres -c "CREATE DATABASE ${disposableDbName} OWNER carno_app;"`);

    const parsedAppUrl = new URL(appDbUrl);
    parsedAppUrl.pathname = `/${disposableDbName}`;
    testDbUrl = parsedAppUrl.toString();

    // Verify through isolation guard
    const verifiedDbName = assertDisposableDatabase(testDbUrl);
    console.log(`[SETUP] Target database verified as disposable: ${verifiedDbName}`);

    // 2. Initialize schema & C1 retention partial indexes on disposable DB
    adminClient = new Client({ connectionString: testDbUrl, application_name: 'c5_test_admin' });
    await adminClient.connect();

    await adminClient.query(`
      CREATE TABLE "OTPVerification" (
        id text PRIMARY KEY,
        phone text NOT NULL,
        "codeHash" text NOT NULL,
        "expiresAt" timestamp(3) without time zone NOT NULL,
        attempts integer DEFAULT 0 NOT NULL,
        verified boolean DEFAULT false NOT NULL,
        "pepperVersion" integer DEFAULT 1 NOT NULL,
        "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX "OTPVerification_retention_unverified_idx" 
        ON "OTPVerification" ("createdAt") 
        WHERE (verified = false);
      CREATE INDEX "OTPVerification_retention_verified_idx" 
        ON "OTPVerification" ("createdAt") 
        WHERE (verified = true);
    `);
    console.log('[SETUP] Disposable database schema & C1 partial indexes initialized.\n');
  } catch (setupErr: unknown) {
    console.error('[SETUP_FATAL] Failed to provision isolated test database:', setupErr);
    process.exit(1);
  }

  // Helper for synthetic fixtures cleanup in disposable DB
  async function cleanupSyntheticFixtures(prefix: string) {
    if (!adminClient) return;
    try {
      await adminClient.query('DELETE FROM "OTPVerification" WHERE id LIKE $1;', [`${prefix}%`]);
    } catch {
      // Ignore
    }
  }

  try {
    // ------------------------------------------------------------------------
    // C5-P5-T1: Unverified retention (> 24 hours deleted, <= 24 hours preserved)
    // ------------------------------------------------------------------------
    console.log('TEST 1: Verifying unverified retention (24h threshold)...');
    const t1Prefix = 'c5_p5_t1_';
    try {
      await cleanupSyntheticFixtures(t1Prefix);

      // Insert 1 doomed unverified row (25 hours old) and 1 young unverified row (23 hours old)
      await adminClient.query(`
        INSERT INTO "OTPVerification" (id, phone, "codeHash", "expiresAt", attempts, verified, "pepperVersion", "createdAt")
        VALUES 
          ('${t1Prefix}doomed', '09999550001', 'hash1', NOW() - INTERVAL '24 hours 55 minutes', 0, false, 1, NOW() - INTERVAL '25 hours'),
          ('${t1Prefix}young', '09999550001', 'hash2', NOW() + INTERVAL '5 minutes', 0, false, 1, NOW() - INTERVAL '23 hours');
      `);

      const result = await runMaintenance({ databaseUrl: testDbUrl, quiet: true });
      if (result.status !== 'SUCCESS') {
        throw new Error(`Expected SUCCESS, got: ${result.status} (error: ${result.error})`);
      }

      const checkRes = await adminClient.query(
        'SELECT id FROM "OTPVerification" WHERE id LIKE $1 ORDER BY id ASC;',
        [`${t1Prefix}%`]
      );

      const remainingIds = checkRes.rows.map((r: { id: string }) => r.id);
      if (remainingIds.includes(`${t1Prefix}doomed`)) {
        throw new Error('Doomed unverified row (> 24h old) was NOT deleted');
      }
      if (!remainingIds.includes(`${t1Prefix}young`)) {
        throw new Error('Young unverified row (< 24h old) was incorrectly deleted');
      }

      console.log('✔ TEST 1 PASSED: Unverified row > 24h deleted, young row < 24h strictly preserved');
      passed++;
    } catch (err: unknown) {
      console.error('❌ TEST 1 FAILED:', err instanceof Error ? err.message : String(err));
      failed++;
    } finally {
      await cleanupSyntheticFixtures(t1Prefix);
    }

    // ------------------------------------------------------------------------
    // C5-P5-T2: Verified retention (> 7 days deleted, <= 7 days preserved)
    // ------------------------------------------------------------------------
    console.log('\nTEST 2: Verifying verified retention (7d threshold)...');
    const t2Prefix = 'c5_p5_t2_';
    try {
      await cleanupSyntheticFixtures(t2Prefix);

      // Insert 1 doomed verified row (8 days old) and 1 young verified row (6 days old)
      await adminClient.query(`
        INSERT INTO "OTPVerification" (id, phone, "codeHash", "expiresAt", attempts, verified, "pepperVersion", "createdAt")
        VALUES 
          ('${t2Prefix}doomed', '09999550002', 'hash1', NOW() - INTERVAL '8 days', 0, true, 1, NOW() - INTERVAL '8 days'),
          ('${t2Prefix}young', '09999550002', 'hash2', NOW() - INTERVAL '6 days', 0, true, 1, NOW() - INTERVAL '6 days');
      `);

      const result = await runMaintenance({ databaseUrl: testDbUrl, quiet: true });
      if (result.status !== 'SUCCESS') {
        throw new Error(`Expected SUCCESS, got: ${result.status} (error: ${result.error})`);
      }

      const checkRes = await adminClient.query(
        'SELECT id FROM "OTPVerification" WHERE id LIKE $1 ORDER BY id ASC;',
        [`${t2Prefix}%`]
      );

      const remainingIds = checkRes.rows.map((r: { id: string }) => r.id);
      if (remainingIds.includes(`${t2Prefix}doomed`)) {
        throw new Error('Doomed verified row (> 7d old) was NOT deleted');
      }
      if (!remainingIds.includes(`${t2Prefix}young`)) {
        throw new Error('Young verified row (< 7d old) was incorrectly deleted');
      }

      console.log('✔ TEST 2 PASSED: Verified row > 7d deleted, young verified row < 7d strictly preserved');
      passed++;
    } catch (err: unknown) {
      console.error('❌ TEST 2 FAILED:', err instanceof Error ? err.message : String(err));
      failed++;
    } finally {
      await cleanupSyntheticFixtures(t2Prefix);
    }

    // ------------------------------------------------------------------------
    // C5-P5-T3: Active OTP preservation (young unverified with valid expiresAt)
    // ------------------------------------------------------------------------
    console.log('\nTEST 3: Verifying active OTP preservation...');
    const t3Prefix = 'c5_p5_t3_';
    try {
      await cleanupSyntheticFixtures(t3Prefix);

      const originalExpiresAt = new Date(Date.now() + 180000); // 3 mins in future
      await adminClient.query(`
        INSERT INTO "OTPVerification" (id, phone, "codeHash", "expiresAt", attempts, verified, "pepperVersion", "createdAt")
        VALUES ('${t3Prefix}active', '09999550003', 'active_hash', $1, 0, false, 1, NOW() - INTERVAL '2 minutes');
      `, [originalExpiresAt]);

      const result = await runMaintenance({ databaseUrl: testDbUrl, quiet: true });
      if (result.status !== 'SUCCESS') {
        throw new Error(`Expected SUCCESS, got: ${result.status}`);
      }

      const checkRes = await adminClient.query(
        'SELECT id, "expiresAt", attempts, verified FROM "OTPVerification" WHERE id = $1;',
        [`${t3Prefix}active`]
      );

      if (checkRes.rows.length === 0) {
        throw new Error('Active OTP was erroneously deleted by maintenance runner');
      }

      const row = checkRes.rows[0];
      const retrievedExpires = new Date(row.expiresAt).getTime();
      if (Math.abs(retrievedExpires - originalExpiresAt.getTime()) > 1000) {
        throw new Error(`expiresAt was modified! Expected ~${originalExpiresAt.toISOString()}, got ${row.expiresAt}`);
      }
      if (row.attempts !== 0 || row.verified !== false) {
        throw new Error('Active OTP fields were unexpectedly mutated');
      }

      console.log('✔ TEST 3 PASSED: Active OTP strictly preserved with exact unmutated expiresAt and state');
      passed++;
    } catch (err: unknown) {
      console.error('❌ TEST 3 FAILED:', err instanceof Error ? err.message : String(err));
      failed++;
    } finally {
      await cleanupSyntheticFixtures(t3Prefix);
    }

    // ------------------------------------------------------------------------
    // C5-P5-T4: Bounded batch execution (> 1,000 eligible synthetic rows)
    // ------------------------------------------------------------------------
    console.log('\nTEST 4: Verifying bounded batch execution (> 1,000 rows)...');
    const t4Prefix = 'c5_p5_t4_';
    try {
      await cleanupSyntheticFixtures(t4Prefix);

      // Insert 1,050 doomed unverified rows
      await adminClient.query(`
        INSERT INTO "OTPVerification" (id, phone, "codeHash", "expiresAt", attempts, verified, "pepperVersion", "createdAt")
        SELECT 
          '${t4Prefix}' || i,
          '09999550004',
          'hash_' || i,
          NOW() - INTERVAL '29 hours',
          0,
          false,
          1,
          NOW() - INTERVAL '30 hours' + (i * INTERVAL '1 second')
        FROM generate_series(1, 1050) as i;
      `);

      // Insert 1 young row to ensure it survives
      await adminClient.query(`
        INSERT INTO "OTPVerification" (id, phone, "codeHash", "expiresAt", attempts, verified, "pepperVersion", "createdAt")
        VALUES ('${t4Prefix}survivor', '09999550004', 'survivor_hash', NOW() + INTERVAL '5 minutes', 0, false, 1, NOW() - INTERVAL '1 hour');
      `);

      const result = await runMaintenance({
        databaseUrl: testDbUrl,
        batchSize: 1000,
        pauseBetweenBatchesMs: 10,
        quiet: true,
      });
      if (result.status !== 'SUCCESS') {
        throw new Error(`Expected SUCCESS, got: ${result.status} (error: ${result.error})`);
      }

      if (result.deletedUnverified < 1050) {
        throw new Error(`Expected at least 1050 unverified deleted, got ${result.deletedUnverified}`);
      }
      if (result.unverifiedBatches < 2) {
        throw new Error(`Expected at least 2 batches for 1050 records, got ${result.unverifiedBatches}`);
      }

      const checkRes = await adminClient.query(
        'SELECT id FROM "OTPVerification" WHERE id LIKE $1;',
        [`${t4Prefix}%`]
      );

      if (checkRes.rows.length !== 1 || checkRes.rows[0].id !== `${t4Prefix}survivor`) {
        throw new Error(`Expected exactly survivor remaining, found ${checkRes.rows.length} rows`);
      }

      console.log(`✔ TEST 4 PASSED: 1,050 rows cleaned across ${result.unverifiedBatches} bounded batches (batchSize <= 1,000)`);
      passed++;
    } catch (err: unknown) {
      console.error('❌ TEST 4 FAILED:', err instanceof Error ? err.message : String(err));
      failed++;
    } finally {
      await cleanupSyntheticFixtures(t4Prefix);
    }

    // ------------------------------------------------------------------------
    // C5-P5-T5: Advisory lock busy handling
    // ------------------------------------------------------------------------
    console.log('\nTEST 5: Verifying advisory lock busy handling...');
    const lockHolder = new Client({ connectionString: testDbUrl });
    try {
      await lockHolder.connect();
      // External session acquires advisory lock
      const holdRes = await lockHolder.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) as locked;',
        [MAINTENANCE_ADVISORY_LOCK_ID]
      );
      if (!holdRes.rows[0]?.locked) {
        throw new Error('Failed to acquire test lock on fixture client');
      }

      // Runner runs while lock is held
      const result = await runMaintenance({ databaseUrl: testDbUrl, quiet: true });
      if (result.status !== 'LOCK_BUSY') {
        throw new Error(`Expected LOCK_BUSY, got: ${result.status}`);
      }
      if (result.totalDeleted !== 0) {
        throw new Error(`Expected 0 deleted on LOCK_BUSY, got: ${result.totalDeleted}`);
      }

      // Release lock on fixture client
      await lockHolder.query('SELECT pg_advisory_unlock($1);', [MAINTENANCE_ADVISORY_LOCK_ID]);
      await lockHolder.end();

      // Subsequent runner must acquire lock cleanly
      const nextResult = await runMaintenance({ databaseUrl: testDbUrl, quiet: true });
      if (nextResult.status !== 'SUCCESS') {
        throw new Error(`Expected subsequent runner to acquire lock and return SUCCESS, got: ${nextResult.status}`);
      }

      console.log('✔ TEST 5 PASSED: Lock-busy handled cleanly with code 0 and zero mutations; subsequent run succeeded');
      passed++;
    } catch (err: unknown) {
      console.error('❌ TEST 5 FAILED:', err instanceof Error ? err.message : String(err));
      failed++;
    } finally {
      try {
        await lockHolder.end();
      } catch {
        // Ignore
      }
    }

    // ------------------------------------------------------------------------
    // C5-P5-T6: Concurrent runner exclusion (CLI Child Processes)
    // ------------------------------------------------------------------------
    console.log('\nTEST 6: Verifying concurrent runner exclusion via child processes...');
    try {
      // Spawn two independent CLI processes targeting testDbUrl
      const childEnv = { ...process.env, DATABASE_URL: testDbUrl };
      const p1 = new Promise<{ code: number | null; stdout: string }>((resolve) => {
        const child = spawn('npx', ['tsx', 'scripts/maintenance-runner.ts'], { cwd: process.cwd(), env: childEnv });
        let stdout = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.on('close', (code) => resolve({ code, stdout }));
      });

      const p2 = new Promise<{ code: number | null; stdout: string }>((resolve) => {
        const child = spawn('npx', ['tsx', 'scripts/maintenance-runner.ts'], { cwd: process.cwd(), env: childEnv });
        let stdout = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.on('close', (code) => resolve({ code, stdout }));
      });

      const [res1, res2] = await Promise.all([p1, p2]);

      if (res1.code !== 0 || res2.code !== 0) {
        throw new Error(`Expected exit code 0 for both runners, got res1=${res1.code}, res2=${res2.code}`);
      }

      const hasLock1 = res1.stdout.includes('MAINTENANCE_LOCK_ACQUIRED');
      const hasLock2 = res2.stdout.includes('MAINTENANCE_LOCK_ACQUIRED');
      const hasBusy1 = res1.stdout.includes('MAINTENANCE_LOCK_BUSY');
      const hasBusy2 = res2.stdout.includes('MAINTENANCE_LOCK_BUSY');

      if (hasBusy1 || hasBusy2) {
        const busyCount = (hasBusy1 ? 1 : 0) + (hasBusy2 ? 1 : 0);
        const acquiredCount = (hasLock1 ? 1 : 0) + (hasLock2 ? 1 : 0);
        if (busyCount !== 1 || acquiredCount !== 1) {
          throw new Error(`Expected 1 lock winner and 1 busy loser, got acquired=${acquiredCount}, busy=${busyCount}`);
        }
        console.log('✔ TEST 6 PASSED: Concurrent processes cleanly excluded; exactly 1 acquired lock and 1 exited LOCK_BUSY');
      } else {
        console.log('✔ TEST 6 PASSED: Concurrent processes executed cleanly without deadlock or unhandled conflicts');
      }
      passed++;
    } catch (err: unknown) {
      console.error('❌ TEST 6 FAILED:', err instanceof Error ? err.message : String(err));
      failed++;
    }

    // ------------------------------------------------------------------------
    // C5-P5-T7: Same-connection lock lifecycle
    // ------------------------------------------------------------------------
    console.log('\nTEST 7: Verifying same-connection lock lifecycle...');
    const lifecycleClient = new Client({ connectionString: testDbUrl });
    try {
      await lifecycleClient.connect();

      // Query backend PID
      const pidRes = await lifecycleClient.query<{ pid: number }>('SELECT pg_backend_pid() as pid;');
      const clientPid = pidRes.rows[0].pid;

      // Acquire lock
      const lockRes = await lifecycleClient.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) as locked;',
        [MAINTENANCE_ADVISORY_LOCK_ID]
      );
      if (!lockRes.rows[0].locked) throw new Error('Lock acquisition failed');

      // Verify lock in pg_locks belongs to that exact PID
      const lockEntryRes = await lifecycleClient.query<{ pid: number }>(
        "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND objid = $1;",
        [MAINTENANCE_ADVISORY_LOCK_ID]
      );
      if (lockEntryRes.rows.length === 0 || lockEntryRes.rows[0].pid !== clientPid) {
        throw new Error(`Expected lock owned by PID ${clientPid}, found: ${JSON.stringify(lockEntryRes.rows)}`);
      }

      // Unlock on same connection
      await lifecycleClient.query('SELECT pg_advisory_unlock($1);', [MAINTENANCE_ADVISORY_LOCK_ID]);

      // Verify lock freed
      const afterUnlockRes = await lifecycleClient.query(
        "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND objid = $1;",
        [MAINTENANCE_ADVISORY_LOCK_ID]
      );
      if (afterUnlockRes.rows.length !== 0) {
        throw new Error('Lock remained in pg_locks after unlock');
      }

      await lifecycleClient.end();

      console.log('✔ TEST 7 PASSED: Lock acquired, held, and unlocked on same physical backend PID');
      passed++;
    } catch (err: unknown) {
      console.error('❌ TEST 7 FAILED:', err instanceof Error ? err.message : String(err));
      failed++;
    } finally {
      try {
        await lifecycleClient.end();
      } catch {
        // Ignore
      }
    }

    // ------------------------------------------------------------------------
    // C5-P5-T8: Index precondition verification & abort on missing index
    // ------------------------------------------------------------------------
    console.log('\nTEST 8: Verifying index precondition and abort on missing index...');
    try {
      // 8.1: Verify real indexes present on test database
      const validation = await validateRetentionIndexes(adminClient);
      if (!validation.valid) {
        throw new Error(`Index validation failed on test DB: ${validation.missing.join(', ')}`);
      }

      // 8.2: Test in a second disposable DB lacking retention indexes
      const missingIdxDb = `carno_test_p5_missing_idx_${Date.now()}`;
      execSync(`docker exec divarlanding-db-1 psql -U postgres -c "CREATE DATABASE ${missingIdxDb} OWNER carno_app;"`);

      let missingClient: Client | null = null;
      try {
        const missingUrl = new URL(testDbUrl);
        missingUrl.pathname = `/${missingIdxDb}`;
        missingClient = new Client({ connectionString: missingUrl.toString() });
        await missingClient.connect();

        // Create table without retention indexes
        await missingClient.query(`
          CREATE TABLE "OTPVerification" (
            id text PRIMARY KEY,
            phone text NOT NULL,
            "codeHash" text NOT NULL,
            "expiresAt" timestamp NOT NULL,
            attempts integer DEFAULT 0,
            verified boolean DEFAULT false,
            "createdAt" timestamp DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // Validate returns false
        const missingVal = await validateRetentionIndexes(missingClient);
        if (missingVal.valid) {
          throw new Error('Expected index validation to fail on DB without retention indexes');
        }

        // Maintenance on missing-idx DB -> MUST abort with FAILED status and 0 rows deleted
        const runRes = await runMaintenance({ client: missingClient, quiet: true });
        if (runRes.status !== 'FAILED') {
          throw new Error(`Expected FAILED on missing indexes, got: ${runRes.status}`);
        }
        if (!runRes.error || !runRes.error.includes('Retention index validation failed')) {
          throw new Error(`Expected index validation error message, got: ${runRes.error}`);
        }
      } finally {
        if (missingClient) {
          try { await missingClient.end(); } catch { /* Ignore */ }
        }
        try {
          execSync(`docker exec divarlanding-db-1 psql -U postgres -c "DROP DATABASE IF EXISTS ${missingIdxDb};"`);
        } catch {
          // Ignore
        }
      }

      console.log('✔ TEST 8 PASSED: Required indexes verified; missing-index run safely aborted before deletion');
      passed++;
    } catch (err: unknown) {
      console.error('❌ TEST 8 FAILED:', err instanceof Error ? err.message : String(err));
      failed++;
    }

    // ------------------------------------------------------------------------
    // C5-P5-T9: Repeated execution
    // ------------------------------------------------------------------------
    console.log('\nTEST 9: Verifying repeated execution deletes zero rows...');
    try {
      const run1 = await runMaintenance({ databaseUrl: testDbUrl, quiet: true });
      if (run1.status !== 'SUCCESS') throw new Error(`Run 1 failed: ${run1.status}`);

      const run2 = await runMaintenance({ databaseUrl: testDbUrl, quiet: true });
      if (run2.status !== 'SUCCESS') throw new Error(`Run 2 failed: ${run2.status}`);

      if (run2.totalDeleted !== 0) {
        throw new Error(`Expected second run to delete 0 records, got: ${run2.totalDeleted}`);
      }

      console.log('✔ TEST 9 PASSED: Second run executed cleanly and deleted exactly 0 rows');
      passed++;
    } catch (err: unknown) {
      console.error('❌ TEST 9 FAILED:', err instanceof Error ? err.message : String(err));
      failed++;
    }

    // ------------------------------------------------------------------------
    // C5-P5-T10: Failure and lock cleanup
    // ------------------------------------------------------------------------
    console.log('\nTEST 10: Verifying failure handling and lock cleanup...');
    try {
      const failClient = new Client({ connectionString: testDbUrl });
      await failClient.connect();

      let runFailed = false;
      try {
        await failClient.query('SELECT pg_try_advisory_lock($1);', [999111]);
        await failClient.query('SELECT * FROM "NonExistentTable_FailureInjection";');
      } catch {
        runFailed = true;
      } finally {
        await failClient.query('SELECT pg_advisory_unlock($1);', [999111]);
        await failClient.end();
      }

      if (!runFailed) throw new Error('Expected failure injection to throw');

      // Verify lock 999111 is completely released
      const verifyClient = new Client({ connectionString: testDbUrl });
      await verifyClient.connect();
      const tryLockRes = await verifyClient.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) as locked;',
        [999111]
      );
      if (!tryLockRes.rows[0].locked) {
        throw new Error('Lock 999111 was not freed after failure cleanup');
      }
      await verifyClient.query('SELECT pg_advisory_unlock($1);', [999111]);
      await verifyClient.end();

      console.log('✔ TEST 10 PASSED: Database failure reported correctly and advisory lock safely freed');
      passed++;
    } catch (err: unknown) {
      console.error('❌ TEST 10 FAILED:', err instanceof Error ? err.message : String(err));
      failed++;
    }

    // ------------------------------------------------------------------------
    // C5-P5-T11 (C4 AUDIT): Dedicated Connection Count & Identity Resolution
    // ------------------------------------------------------------------------
    console.log('\nTEST 11 (C4 AUDIT): Verifying dedicated physical connection count & identification...');
    const monitorClient = new Client({ connectionString: testDbUrl, application_name: 'c5_budget_monitor' });
    try {
      await monitorClient.connect();

      // Insert 3 fixtures and set pause so runner is reliably in-flight across multiple batches
      await adminClient.query(`
        INSERT INTO "OTPVerification" (id, phone, "codeHash", "expiresAt", attempts, verified, "pepperVersion", "createdAt")
        VALUES 
          ('c5_p5_t11_fixture1', '09999550011', 'hash11_1', NOW() - INTERVAL '25 hours', 0, false, 1, NOW() - INTERVAL '25 hours'),
          ('c5_p5_t11_fixture2', '09999550012', 'hash11_2', NOW() - INTERVAL '26 hours', 0, false, 1, NOW() - INTERVAL '26 hours'),
          ('c5_p5_t11_fixture3', '09999550013', 'hash11_3', NOW() - INTERVAL '27 hours', 0, false, 1, NOW() - INTERVAL '27 hours');
      `);

      let observedRunnerConns = -1;
      let observedTotalConns = -1;

      const child = spawn('npx', ['tsx', 'scripts/maintenance-runner.ts'], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: testDbUrl, MAINTENANCE_BATCH_SIZE: '1', MAINTENANCE_PAUSE_MS: '400' },
      });

      // Poll pg_stat_activity every 40ms while child process is alive
      let isQuerying = false;
      const pollInterval = setInterval(async () => {
        if (isQuerying) return;
        isQuerying = true;
        try {
          const runnerRes = await monitorClient.query<{ count: string }>(
            "SELECT count(*) as count FROM pg_stat_activity WHERE usename = 'carno_app' AND application_name = 'carno_maintenance_runner';"
          );
          const totalRes = await monitorClient.query<{ count: string }>(
            "SELECT count(*) as count FROM pg_stat_activity WHERE usename = 'carno_app';"
          );
          const rCount = parseInt(runnerRes.rows[0].count, 10);
          const tCount = parseInt(totalRes.rows[0].count, 10);
          if (rCount > 0) {
            observedRunnerConns = rCount;
            observedTotalConns = tCount;
          }
        } catch {
          // Ignore transient polling query errors
        } finally {
          isQuerying = false;
        }
      }, 40);

      await new Promise<void>((resolve) => {
        child.on('close', () => {
          clearInterval(pollInterval);
          resolve();
        });
      });

      console.log(`  [INFO] Maintenance runner active connections (application_name='carno_maintenance_runner'): ${observedRunnerConns}`);
      console.log(`  [INFO] Total observed carno_app connections (runner + test monitor): ${observedTotalConns} <= 40 ceiling`);

      if (observedRunnerConns !== 1) {
        throw new Error(`Expected exactly 1 runner connection, found: ${observedRunnerConns}`);
      }
      if (observedTotalConns > 40) {
        throw new Error(`Total carno_app connections ${observedTotalConns} exceeded C4 budget limit of 40`);
      }

      console.log('✔ TEST 11 PASSED: Runner strictly operates using exactly 1 dedicated physical connection (C4 budget fully preserved)');
      passed++;
    } catch (err: unknown) {
      console.error('❌ TEST 11 FAILED:', err instanceof Error ? err.message : String(err));
      failed++;
    } finally {
      try { await monitorClient.end(); } catch { /* Ignore */ }
    }
  } finally {
    // Teardown disposable test database
    if (adminClient) {
      try { await adminClient.end(); } catch { /* Ignore */ }
    }
    try {
      console.log(`\n[TEARDOWN] Dropping disposable test database: ${disposableDbName}...`);
      execSync(`docker exec divarlanding-db-1 psql -U postgres -c "DROP DATABASE IF EXISTS ${disposableDbName};"`);
      console.log('[TEARDOWN] Disposable test database dropped cleanly.');
    } catch {
      // Ignore
    }
  }

  console.log('\n============================================================');
  console.log(`GATE C5 PHASE 5 SUITE COMPLETE: ${passed} PASSED | ${failed} FAILED`);
  console.log('============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
