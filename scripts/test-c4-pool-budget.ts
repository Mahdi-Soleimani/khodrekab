import assert from 'node:assert';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { prisma as appPrisma } from '../src/lib/prisma';

// Ensure .env is loaded in process
try {
  process.loadEnvFile('.env');
} catch {
  // If already loaded or environment injected, proceed
}

const execAsync = promisify(exec);

// -------------------------------------------------------------
// WORKER MODE (Spawned as an independent Node.js process)
// -------------------------------------------------------------
if (process.argv.includes('--worker')) {
  const workerTag = process.argv[process.argv.indexOf('--worker') + 1] || 'default';
  const workerClient = new PrismaClient();

  (async () => {
    // Launch exactly 15 concurrent queries that hold connections for 8 seconds
    const queries = Array.from({ length: 15 }, async (_, i) => {
      return await workerClient.$queryRaw`SELECT ${workerTag} as tag, ${i} as qid, (pg_sleep(8) IS NULL) as slept;`;
    });

    console.log(`WORKER_${workerTag}_ACTIVE`);
    await Promise.all(queries);
    console.log(`WORKER_${workerTag}_DONE`);
    await workerClient.$disconnect();
    process.exit(0);
  })().catch((err) => {
    console.error(`WORKER_${workerTag}_ERROR:`, err);
    process.exit(1);
  });
} else {
  // -------------------------------------------------------------
  // MAIN C4 TEST RUNNER
  // -------------------------------------------------------------

  interface PgStatSnapshot {
    total: number;
    carno_app_total: number;
    carno_app_active: number;
    carno_app_idle: number;
    carno_migrator_count: number;
    postgres_count: number;
    idle_in_tx: number;
  }

  // Direct PostgreSQL query via psql to bypass Prisma client connection pool
  async function queryPostgresStats(): Promise<PgStatSnapshot> {
    const psqlCommand = `docker exec divarlanding-db-1 psql -U postgres -d carlanding -t -A -c "
      SELECT json_build_object(
        'total', count(*),
        'carno_app_total', count(*) FILTER (WHERE usename = 'carno_app'),
        'carno_app_active', count(*) FILTER (WHERE usename = 'carno_app' AND state = 'active'),
        'carno_app_idle', count(*) FILTER (WHERE usename = 'carno_app' AND state = 'idle'),
        'carno_migrator_count', count(*) FILTER (WHERE usename = 'carno_migrator'),
        'postgres_count', count(*) FILTER (WHERE usename = 'postgres'),
        'idle_in_tx', count(*) FILTER (WHERE state = 'idle in transaction')
      )
      FROM pg_stat_activity
      WHERE datname = 'carlanding';
    "`;

    const { stdout } = await execAsync(psqlCommand);
    const parsed = JSON.parse(stdout.trim()) as PgStatSnapshot;
    return parsed;
  }

  async function runC4PoolBudgetSuite() {
    console.log('====================================================');
    console.log('   CARNO GATE C4 CONNECTION POOL & BUDGET SUITE    ');
    console.log('====================================================\n');

    // Baseline inspection
    const baseline = await queryPostgresStats();
    console.log('[BASELINE] Initial pg_stat_activity on carlanding:');
    console.log(`  - Total: ${baseline.total}, carno_app_total: ${baseline.carno_app_total}, carno_app_active: ${baseline.carno_app_active}, idle_in_tx: ${baseline.idle_in_tx}\n`);

    // ---------------------------------------------------------
    // TEST 1: Runtime Role Verification
    // ---------------------------------------------------------
    console.log('--- 1. Runtime Application Role Verification ---');
    const roleCheck = await appPrisma.$queryRaw<{ username: string; session_user: string }[]>`
      SELECT current_user AS username, session_user AS session_user;
    `;
    console.log(`  [INFO] App current_user: ${roleCheck[0].username}, session_user: ${roleCheck[0].session_user}`);
    assert.strictEqual(
      roleCheck[0].username,
      'carno_app',
      'CRITICAL: App runtime MUST connect as carno_app, never postgres'
    );
    assert.strictEqual(
      roleCheck[0].session_user,
      'carno_app',
      'CRITICAL: App session_user MUST be carno_app'
    );
    console.log('  [PASS] App runtime strictly connects as carno_app (not superuser)');

    // ---------------------------------------------------------
    // TEST 2: Role Hard Limits in PostgreSQL
    // ---------------------------------------------------------
    console.log('\n--- 2. Database Role Hard Connection Limits ---');
    const roleLimits = await appPrisma.$queryRaw<{ rolname: string; rolconnlimit: number }[]>`
      SELECT rolname, rolconnlimit
      FROM pg_roles
      WHERE rolname IN ('carno_app', 'carno_migrator', 'postgres')
      ORDER BY rolname;
    `;
    const limitsMap = Object.fromEntries(roleLimits.map((r) => [r.rolname, r.rolconnlimit]));
    console.log('  [INFO] pg_roles limits:', limitsMap);

    assert.strictEqual(limitsMap['carno_app'], 40, 'carno_app rolconnlimit must be strictly 40');
    assert.strictEqual(limitsMap['carno_migrator'], 5, 'carno_migrator rolconnlimit must be strictly 5');
    assert.strictEqual(limitsMap['postgres'], -1, 'postgres rolconnlimit must remain -1 (superuser)');
    console.log('  [PASS] Hard database limits enforced: carno_app=40, carno_migrator=5, postgres=-1');

    // ---------------------------------------------------------
    // TEST 3: DATABASE_URL Explicit Pool Parameters
    // ---------------------------------------------------------
    console.log('\n--- 3. DATABASE_URL Explicit Pool Parameter Audit ---');
    const dbUrl = process.env.DATABASE_URL || '';
    const parsedUrl = new URL(dbUrl);
    const connLimit = parsedUrl.searchParams.get('connection_limit');
    const poolTimeout = parsedUrl.searchParams.get('pool_timeout');
    const connectTimeout = parsedUrl.searchParams.get('connect_timeout');
    const schema = parsedUrl.searchParams.get('schema');

    console.log(`  [INFO] Parsed DATABASE_URL parameters:`);
    console.log(`    - connection_limit: ${connLimit}`);
    console.log(`    - pool_timeout:     ${poolTimeout}`);
    console.log(`    - connect_timeout:  ${connectTimeout}`);
    console.log(`    - schema:           ${schema}`);

    assert.strictEqual(connLimit, '15', 'connection_limit must be explicitly 15 in DATABASE_URL');
    assert.strictEqual(poolTimeout, '10', 'pool_timeout must be explicitly 10 in DATABASE_URL');
    assert.strictEqual(connectTimeout, '5', 'connect_timeout must be explicitly 5 in DATABASE_URL');
    assert.strictEqual(schema, 'public', 'schema must be public');
    console.log('  [PASS] connection_limit=15, pool_timeout=10, connect_timeout=5 validated');

    // Disconnect appPrisma so test pool starts from a clean 0 carno_app baseline
    await appPrisma.$disconnect();

    // ---------------------------------------------------------
    // TEST 4: Single-Instance Pool Saturation & Overflow Boundedness
    // ---------------------------------------------------------
    console.log('\n--- 4. Real Single-Process Pool Saturation & Overflow Boundedness ---');
    const dedicatedSingleClient = new PrismaClient();

    try {
      console.log('  [EXECUTION] Launching 15 concurrent sleep queries (pg_sleep 10s) to saturate connection_limit=15...');
      const p15 = Array.from({ length: 15 }, async (_, i) => {
        return await dedicatedSingleClient.$queryRaw`SELECT ${i} as id, (pg_sleep(10) IS NULL) as slept;`;
      });

      // Wait and poll until all 15 connections are established and active in Postgres (up to 4s)
      let mid15Stats = await queryPostgresStats();
      const waitConnStart = Date.now();
      while (mid15Stats.carno_app_active < 15 && Date.now() - waitConnStart < 4000) {
        await new Promise((r) => setTimeout(r, 150));
        mid15Stats = await queryPostgresStats();
      }
      console.log(`  [MID-FLIGHT 15 ACTIVE] Postgres carno_app: active=${mid15Stats.carno_app_active}, total=${mid15Stats.carno_app_total}`);

      assert.strictEqual(
        mid15Stats.carno_app_active,
        15,
        `Expected exactly 15 active carno_app connections in Postgres, got ${mid15Stats.carno_app_active}`
      );
      assert.strictEqual(
        mid15Stats.carno_app_total,
        15,
        `Expected exactly 15 total carno_app connections in Postgres, got ${mid15Stats.carno_app_total}`
      );

      console.log('  [EXECUTION] Dispatching 5 extra queued queries (queries 16..20)...');
      const pExtra = Array.from({ length: 5 }, async (_, i) => {
        return await dedicatedSingleClient.$queryRaw`SELECT ${15 + i} as id, (pg_sleep(0.5) IS NULL) as slept;`;
      });

      // Mid-flight check while 5 extra queries are queued in Prisma pool
      await new Promise((r) => setTimeout(r, 300));
      const midQueuedStats = await queryPostgresStats();
      console.log(`  [MID-FLIGHT QUEUED] Postgres carno_app: active=${midQueuedStats.carno_app_active}, total=${midQueuedStats.carno_app_total}`);

      assert.strictEqual(
        midQueuedStats.carno_app_active,
        15,
        `Postgres active connections must remain bounded at 15 (got ${midQueuedStats.carno_app_active})`
      );
      assert.strictEqual(
        midQueuedStats.carno_app_total,
        15,
        `Postgres connections must NEVER exceed pool limit of 15 during queueing (got ${midQueuedStats.carno_app_total})`
      );

      await Promise.all([...p15, ...pExtra]);
      console.log('  [COMPLETED] All 20 queries (15 active + 5 queued) completed successfully.');

      // Pool timeout test (P2024 verification)
      console.log('  [TEST] Testing bounded pool timeout (P2024) under saturation...');
      const timeoutUrl = new URL(dbUrl);
      timeoutUrl.searchParams.set('connection_limit', '15');
      timeoutUrl.searchParams.set('pool_timeout', '2'); // 2-second timeout

      const timeoutClient = new PrismaClient({ datasources: { db: { url: timeoutUrl.toString() } } });
      try {
        const timeoutQueries = Array.from({ length: 15 }, async (_, i) => {
          return await timeoutClient.$queryRaw`SELECT ${i} as id, (pg_sleep(4) IS NULL) as slept;`;
        });

        await new Promise((r) => setTimeout(r, 1000));

        let p2024Caught = false;
        try {
          await timeoutClient.$queryRaw`SELECT 999 as id;`;
        } catch (err: unknown) {
          const e = err as { code?: string; message?: string };
          if (e?.code === 'P2024' || (e?.message && e.message.includes('Timed out fetching a new connection'))) {
            p2024Caught = true;
          }
        }

        assert.strictEqual(p2024Caught, true, 'Pool timeout must deterministically produce P2024 when pool is exhausted');
        console.log('  [PASS] P2024 verified: excess query properly timed out from pool without expanding Postgres connections');

        await Promise.all(timeoutQueries);
      } finally {
        await timeoutClient.$disconnect();
      }
    } finally {
      await dedicatedSingleClient.$disconnect();
    }
    console.log('  [PASS] Single-process pool saturation strictly bounded at 15 connections');

    // ---------------------------------------------------------
    // TEST 5: Real Two-Process Validation (2 independent Node processes)
    // ---------------------------------------------------------
    console.log('\n--- 5. Real Two-Process Validation (2 x 15 = 30 <= 40) ---');
    console.log('  [SIMULATION] Spawning two independent Node.js processes (Process A and Process B)...');

    const procA = spawn('npx', ['tsx', 'scripts/test-c4-pool-budget.ts', '--worker', 'A'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const procB = spawn('npx', ['tsx', 'scripts/test-c4-pool-budget.ts', '--worker', 'B'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let aActive = false;
    let bActive = false;

    procA.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes('WORKER_A_ACTIVE')) aActive = true;
    });
    procB.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes('WORKER_B_ACTIVE')) bActive = true;
    });

    // Wait until both processes report WORKER_ACTIVE
    const waitStart = Date.now();
    while ((!aActive || !bActive) && Date.now() - waitStart < 20000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(aActive && bActive, 'Both Process A and Process B must report WORKER_ACTIVE');

    // Wait 1.5 seconds for queries to be active in Postgres
    await new Promise((r) => setTimeout(r, 1500));
    const twoProcStats = await queryPostgresStats();
    console.log(`  [TWO-PROCESS MID-FLIGHT] Postgres carno_app: active=${twoProcStats.carno_app_active}, total=${twoProcStats.carno_app_total}`);

    // Theoretical peak: 2 instances x 15 = 30 connections
    assert.ok(
      twoProcStats.carno_app_active >= 28 && twoProcStats.carno_app_active <= 30,
      `Two processes must achieve ~30 active connections (got ${twoProcStats.carno_app_active})`
    );
    assert.ok(
      twoProcStats.carno_app_total <= 30,
      `Two processes combined connections (${twoProcStats.carno_app_total}) must not exceed 30`
    );
    assert.ok(
      twoProcStats.carno_app_total <= 40,
      `Two processes combined connections must strictly respect application ceiling of 40`
    );
    console.log(`  [PASS] Real two-process maximum validated: ${twoProcStats.carno_app_active} active, ${twoProcStats.carno_app_total} total <= 30 (ceiling <= 40)`);

    // Await both processes to terminate cleanly
    await Promise.all([
      new Promise((res) => procA.on('close', res)),
      new Promise((res) => procB.on('close', res)),
    ]);
    console.log('  [CLEANUP] Both Process A and Process B disconnected and exited cleanly.');

    // ---------------------------------------------------------
    // TEST 6: Connection Release & Cooldown Test
    // ---------------------------------------------------------
    console.log('\n--- 6. Connection Release & Cooldown Audit ---');
    const afterWorkload = await queryPostgresStats();
    console.log(`  [AFTER WORKLOAD] carno_app_total: ${afterWorkload.carno_app_total}, active: ${afterWorkload.carno_app_active}, idle: ${afterWorkload.carno_app_idle}`);

    console.log('  [COOLDOWN] Waiting 6 seconds cooldown for TCP socket cleanup...');
    await new Promise((r) => setTimeout(r, 6000));

    const postCooldown = await queryPostgresStats();
    console.log(`  [POST-COOLDOWN] carno_app_total: ${postCooldown.carno_app_total}, active: ${postCooldown.carno_app_active}, idle_in_tx: ${postCooldown.idle_in_tx}`);

    assert.strictEqual(postCooldown.idle_in_tx, 0, 'No connections may remain idle in transaction');
    assert.ok(
      postCooldown.carno_app_total <= baseline.carno_app_total + 1,
      `Post-cooldown carno_app connections (${postCooldown.carno_app_total}) must return to baseline (${baseline.carno_app_total})`
    );
    console.log('  [PASS] Connection release verified: all worker connections cleanly released back to baseline');

    // ---------------------------------------------------------
    // TEST 7: Correct Headroom Accounting
    // ---------------------------------------------------------
    console.log('\n--- 7. Database Capacity & Headroom Accounting ---');
    const { stdout: maxConnOut } = await execAsync(`docker exec divarlanding-db-1 psql -U postgres -d carlanding -t -A -c "SELECT setting FROM pg_settings WHERE name = 'max_connections';"`);
    const { stdout: superReserveOut } = await execAsync(`docker exec divarlanding-db-1 psql -U postgres -d carlanding -t -A -c "SELECT setting FROM pg_settings WHERE name = 'superuser_reserved_connections';"`);

    const maxConn = parseInt(maxConnOut.trim(), 10);
    const superReserve = parseInt(superReserveOut.trim(), 10);

    const appCeiling = 40;
    const migratorCeiling = 5;
    const allocatedCeiling = appCeiling + migratorCeiling;
    const remainingTotal = maxConn - allocatedCeiling;
    const ordinaryHeadroom = remainingTotal - superReserve;

    console.log(`  [ACCOUNTING]`);
    console.log(`    max_connections:                             ${maxConn}`);
    console.log(`    application ceiling (carno_app):             ${appCeiling}`);
    console.log(`    migrator ceiling (carno_migrator):           ${migratorCeiling}`);
    console.log(`    remaining total:                             ${remainingTotal}`);
    console.log(`    superuser_reserved:                          ${superReserve}`);
    console.log(`    ordinary/unallocated non-superuser capacity: ${ordinaryHeadroom}`);

    assert.strictEqual(maxConn, 100, 'max_connections must be 100');
    assert.strictEqual(appCeiling, 40, 'application ceiling must be 40');
    assert.strictEqual(migratorCeiling, 5, 'migrator ceiling must be 5');
    assert.strictEqual(remainingTotal, 55, 'remaining total must be 55');
    assert.strictEqual(superReserve, 3, 'superuser_reserved must be 3');
    assert.strictEqual(ordinaryHeadroom, 52, 'ordinary/unallocated non-superuser capacity must be 52');
    console.log('  [PASS] Capacity accounting strictly verified (52 unallocated non-superuser capacity)');

    // ---------------------------------------------------------
    // TEST 8: Role Isolation & Least Privilege
    // ---------------------------------------------------------
    console.log('\n--- 8. Role Isolation & Least Privilege ---');
    const verifyClient = new PrismaClient();

    try {
      // carno_app should NOT be able to create tables
      let ddlBlocked = false;
      try {
        await verifyClient.$executeRawUnsafe('CREATE TABLE unauthorized_test_table (id int);');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('permission denied') || msg.includes('must be owner')) {
          ddlBlocked = true;
        }
      }
      assert.strictEqual(ddlBlocked, true, 'carno_app MUST NOT be permitted to execute DDL (CREATE TABLE)');
      console.log('  [PASS] DDL blocked: carno_app cannot CREATE tables');

      // carno_app should NOT be able to access _prisma_migrations
      let migrationTableBlocked = false;
      try {
        await verifyClient.$queryRawUnsafe('SELECT * FROM "_prisma_migrations" LIMIT 1;');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('permission denied')) {
          migrationTableBlocked = true;
        }
      }
      assert.strictEqual(migrationTableBlocked, true, 'carno_app MUST NOT be permitted to access _prisma_migrations');
      console.log('  [PASS] Migration table protected: carno_app cannot read _prisma_migrations');

      // carno_app CAN perform DML
      const dmlCheck = await verifyClient.user.findFirst({ select: { id: true } });
      assert.ok(dmlCheck !== undefined, 'carno_app should successfully read from User table');
      console.log('  [PASS] DML authorized: carno_app can query application tables');
    } finally {
      await verifyClient.$disconnect();
    }

    console.log('\n====================================================');
    console.log('   ALL C4 POOL BUDGET & ROLE TESTS PASSED (8/8)     ');
    console.log('====================================================\n');
  }

  runC4PoolBudgetSuite()
    .then(() => {
      console.log('C4 suite exited cleanly with code: 0');
      process.exit(0);
    })
    .catch((err) => {
      console.error('C4 suite failed with error:', err);
      process.exit(1);
    });
}
