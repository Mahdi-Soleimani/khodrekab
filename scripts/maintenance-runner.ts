/**
 * CARNO GATE C5 — PHASE 5 POSTGRESQL MAINTENANCE RUNNER
 * OTP Retention Cleanup & Session-Level Advisory Lock
 *
 * Requirements:
 * 1. Single physical PostgreSQL connection via dedicated pg.Client.
 * 2. Session-level advisory lock (849201) via SELECT pg_try_advisory_lock(849201).
 * 3. Lock-busy exits cleanly with code 0 without modifying records.
 * 4. Index precondition validation for C1 partial retention indexes.
 * 5. Bounded batch deletion (max 1,000 per batch) with oldest-first CTE pattern.
 * 6. Unverified retention: verified = false AND createdAt < NOW() - INTERVAL '24 hours'.
 * 7. Verified retention: verified = true AND createdAt < NOW() - INTERVAL '7 days'.
 * 8. 50ms pause between non-empty batches.
 * 9. Safe lock release and connection termination in finally block.
 * 10. Zero sensitive data leakage (no OTPs, phones, hashes, or secrets logged).
 */

import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

export const MAINTENANCE_ADVISORY_LOCK_ID = 849201;
export const DEFAULT_BATCH_SIZE = 1000;
export const DEFAULT_PAUSE_MS = 50;

export interface MaintenanceOptions {
  databaseUrl?: string;
  client?: Client;
  batchSize?: number;
  pauseBetweenBatchesMs?: number;
  unverifiedRetentionHours?: number;
  verifiedRetentionDays?: number;
  customLockId?: number;
  quiet?: boolean;
}

export interface MaintenanceResult {
  status: 'SUCCESS' | 'LOCK_BUSY' | 'FAILED';
  deletedUnverified: number;
  deletedVerified: number;
  totalDeleted: number;
  unverifiedBatches: number;
  verifiedBatches: number;
  durationMs: number;
  error?: string;
}

/**
 * Resolve database connection string safely from environment or .env file
 */
export function resolveDatabaseUrl(explicitUrl?: string): string {
  if (explicitUrl) return explicitUrl;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('DATABASE_URL=')) {
          const raw = trimmed.slice('DATABASE_URL='.length).trim();
          return raw.replace(/^["']|["']$/g, '');
        }
      }
    }
  } catch {
    // Ignore read errors
  }

  throw new Error('DATABASE_URL environment variable is required for maintenance runner');
}

/**
 * Validate that C1 retention partial indexes exist on OTPVerification table
 */
export async function validateRetentionIndexes(client: Client): Promise<{ valid: boolean; missing: string[]; details: string[] }> {
  const query = `
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'OTPVerification'
      AND schemaname = 'public';
  `;

  const res = await client.query(query);
  const rows: { indexname: string; indexdef: string }[] = res.rows;

  const unverifiedIdx = rows.find((r) => r.indexname === 'OTPVerification_retention_unverified_idx');
  const verifiedIdx = rows.find((r) => r.indexname === 'OTPVerification_retention_verified_idx');

  const missing: string[] = [];
  const details: string[] = [];

  if (!unverifiedIdx) {
    missing.push('OTPVerification_retention_unverified_idx');
  } else {
    const def = unverifiedIdx.indexdef.toLowerCase();
    const hasCreatedAt = def.includes('createdat');
    const hasPredicate = def.includes('verified = false') || def.includes('not verified');
    if (!hasCreatedAt || !hasPredicate) {
      missing.push('OTPVerification_retention_unverified_idx (incompatible definition)');
    } else {
      details.push(unverifiedIdx.indexname);
    }
  }

  if (!verifiedIdx) {
    missing.push('OTPVerification_retention_verified_idx');
  } else {
    const def = verifiedIdx.indexdef.toLowerCase();
    const hasCreatedAt = def.includes('createdat');
    const hasPredicate = def.includes('verified = true') || def.includes('(verified)');
    if (!hasCreatedAt || !hasPredicate) {
      missing.push('OTPVerification_retention_verified_idx (incompatible definition)');
    } else {
      details.push(verifiedIdx.indexname);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    details,
  };
}

/**
 * Execute OTP retention maintenance using a single physical connection and advisory lock
 */
export async function runMaintenance(options: MaintenanceOptions = {}): Promise<MaintenanceResult> {
  const startTime = Date.now();
  const lockId = options.customLockId ?? MAINTENANCE_ADVISORY_LOCK_ID;
  const batchSize = Math.max(
    1,
    Math.min(
      options.batchSize ??
        (process.env.MAINTENANCE_BATCH_SIZE ? parseInt(process.env.MAINTENANCE_BATCH_SIZE, 10) : DEFAULT_BATCH_SIZE),
      1000
    )
  );
  const pauseMs =
    options.pauseBetweenBatchesMs ??
    (process.env.MAINTENANCE_PAUSE_MS ? parseInt(process.env.MAINTENANCE_PAUSE_MS, 10) : DEFAULT_PAUSE_MS);
  const unverifiedHours = options.unverifiedRetentionHours ?? 24;
  const verifiedDays = options.verifiedRetentionDays ?? 7;
  const quiet = options.quiet ?? false;

  let client: Client;
  let ownsClient = false;
  let hasLock = false;

  const log = (event: string, meta: Record<string, unknown> = {}) => {
    if (!quiet) {
      console.log(`[${event}] ${JSON.stringify({ timestamp: new Date().toISOString(), ...meta })}`);
    }
  };

  const logError = (event: string, meta: Record<string, unknown> = {}) => {
    console.error(`[${event}] ${JSON.stringify({ timestamp: new Date().toISOString(), ...meta })}`);
  };

  log('MAINTENANCE_START', { lockId, batchSize, unverifiedHours, verifiedDays });

  if (options.client) {
    client = options.client;
  } else {
    const dbUrl = resolveDatabaseUrl(options.databaseUrl);
    client = new Client({ connectionString: dbUrl, application_name: 'carno_maintenance_runner' });
    await client.connect();
    ownsClient = true;
  }

  let deletedUnverified = 0;
  let deletedVerified = 0;
  let unverifiedBatches = 0;
  let verifiedBatches = 0;

  try {
    // 1. Acquire Session-Level Advisory Lock
    const lockRes = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) as locked;',
      [lockId]
    );

    const acquired = Boolean(lockRes.rows[0]?.locked);
    if (!acquired) {
      log('MAINTENANCE_LOCK_BUSY', {
        lockId,
        message: `Advisory lock ${lockId} is held by another session. Exiting cleanly with code 0.`,
      });
      return {
        status: 'LOCK_BUSY',
        deletedUnverified: 0,
        deletedVerified: 0,
        totalDeleted: 0,
        unverifiedBatches: 0,
        verifiedBatches: 0,
        durationMs: Date.now() - startTime,
      };
    }

    hasLock = true;
    log('MAINTENANCE_LOCK_ACQUIRED', { lockId });

    // 2. Validate C1 Partial Retention Indexes
    const indexCheck = await validateRetentionIndexes(client);
    if (!indexCheck.valid) {
      logError('MAINTENANCE_INDEX_VALIDATION_FAILED', {
        missing: indexCheck.missing,
        message: 'Required C1 retention partial indexes missing or incompatible. Aborting without deleting rows.',
      });
      throw new Error(`Retention index validation failed: ${indexCheck.missing.join(', ')}`);
    }

    log('MAINTENANCE_INDEX_VALIDATION_PASSED', { verifiedIndexes: indexCheck.details });

    // 3. Stream 1: Bounded Cleanup of Unverified OTPs (> 24 hours old)
    const unverifiedInterval = `${unverifiedHours} hours`;
    while (true) {
      unverifiedBatches++;
      const batchStartTime = Date.now();

      const deleteQuery = `
        WITH doomed AS (
            SELECT id
            FROM "OTPVerification"
            WHERE "verified" = false
              AND "createdAt" < NOW() - INTERVAL '${unverifiedInterval}'
            ORDER BY "createdAt" ASC
            LIMIT $1
        )
        DELETE FROM "OTPVerification" AS otp
        USING doomed
        WHERE otp.id = doomed.id
        RETURNING otp.id;
      `;

      const delRes = await client.query(deleteQuery, [batchSize]);
      const batchDeleted = delRes.rowCount ?? 0;
      deletedUnverified += batchDeleted;

      if (batchDeleted > 0) {
        log('MAINTENANCE_BATCH_COMPLETE', {
          stream: 'UNVERIFIED',
          batch: unverifiedBatches,
          deleted: batchDeleted,
          totalStreamDeleted: deletedUnverified,
          batchDurationMs: Date.now() - batchStartTime,
        });
      }

      if (batchDeleted < batchSize) {
        // Less than full batch deleted means queue of doomed records is drained
        break;
      }

      if (pauseMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
      }
    }

    log('MAINTENANCE_STREAM_COMPLETE', {
      stream: 'UNVERIFIED',
      totalDeleted: deletedUnverified,
      totalBatches: unverifiedBatches,
    });

    // 4. Stream 2: Bounded Cleanup of Verified OTPs (> 7 days old)
    const verifiedInterval = `${verifiedDays} days`;
    while (true) {
      verifiedBatches++;
      const batchStartTime = Date.now();

      const deleteQuery = `
        WITH doomed AS (
            SELECT id
            FROM "OTPVerification"
            WHERE "verified" = true
              AND "createdAt" < NOW() - INTERVAL '${verifiedInterval}'
            ORDER BY "createdAt" ASC
            LIMIT $1
        )
        DELETE FROM "OTPVerification" AS otp
        USING doomed
        WHERE otp.id = doomed.id
        RETURNING otp.id;
      `;

      const delRes = await client.query(deleteQuery, [batchSize]);
      const batchDeleted = delRes.rowCount ?? 0;
      deletedVerified += batchDeleted;

      if (batchDeleted > 0) {
        log('MAINTENANCE_BATCH_COMPLETE', {
          stream: 'VERIFIED',
          batch: verifiedBatches,
          deleted: batchDeleted,
          totalStreamDeleted: deletedVerified,
          batchDurationMs: Date.now() - batchStartTime,
        });
      }

      if (batchDeleted < batchSize) {
        break;
      }

      if (pauseMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
      }
    }

    log('MAINTENANCE_STREAM_COMPLETE', {
      stream: 'VERIFIED',
      totalDeleted: deletedVerified,
      totalBatches: verifiedBatches,
    });

    const durationMs = Date.now() - startTime;
    const totalDeleted = deletedUnverified + deletedVerified;

    log('MAINTENANCE_COMPLETE', {
      deletedUnverified,
      deletedVerified,
      totalDeleted,
      unverifiedBatches,
      verifiedBatches,
      durationMs,
    });

    return {
      status: 'SUCCESS',
      deletedUnverified,
      deletedVerified,
      totalDeleted,
      unverifiedBatches,
      verifiedBatches,
      durationMs,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError('MAINTENANCE_FAILED', {
      error: errorMsg,
      deletedUnverified,
      deletedVerified,
      durationMs: Date.now() - startTime,
    });
    return {
      status: 'FAILED',
      deletedUnverified,
      deletedVerified,
      totalDeleted: deletedUnverified + deletedVerified,
      unverifiedBatches,
      verifiedBatches,
      durationMs: Date.now() - startTime,
      error: errorMsg,
    };
  } finally {
    // 5. Release Advisory Lock & Close Connection
    if (hasLock) {
      try {
        await client.query('SELECT pg_advisory_unlock($1);', [lockId]);
        log('MAINTENANCE_LOCK_RELEASED', { lockId });
      } catch (unlockErr: unknown) {
        logError('MAINTENANCE_UNLOCK_ERROR', {
          lockId,
          error: unlockErr instanceof Error ? unlockErr.message : String(unlockErr),
        });
      }
    }

    if (ownsClient) {
      try {
        await client.end();
        log('MAINTENANCE_CONNECTION_CLOSED', {});
      } catch {
        // Socket already closed
      }
    }
  }
}

// CLI Execution Entrypoint
if (require.main === module || (process.argv[1] && process.argv[1].endsWith('maintenance-runner.ts'))) {
  runMaintenance()
    .then((result) => {
      if (result.status === 'FAILED') {
        process.exitCode = 1;
      } else {
        // Both SUCCESS and LOCK_BUSY exit cleanly with status code 0
        process.exitCode = 0;
      }
    })
    .catch((fatalErr) => {
      console.error('[MAINTENANCE_FATAL]', fatalErr instanceof Error ? fatalErr.message : String(fatalErr));
      process.exitCode = 1;
    });
}
