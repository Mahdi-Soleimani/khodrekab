/**
 * CARNO PRODUCTION OPERATIONAL HEALTH CHECK & QUEUE MONITOR
 *
 * Reads queue lengths, Redis memory, and PostgreSQL connection saturation.
 * Evaluates operational thresholds and outputs structured telemetry.
 *
 * Exit codes:
 *   0: OK (All metrics within safe thresholds)
 *   1: CRITICAL or Connection Failure
 *   2: WARNING (Elevated queues or resource pressure)
 */

import path from 'path';
import { Client } from 'pg';
import { getRedisClient } from '../src/lib/security/redis';
import {
  QUEUE_KEY,
  PROCESSING_KEY,
  RETRY_KEY,
  DEADLETTER_KEY,
  LEASE_PREFIX,
  MAX_QUEUE_CAPACITY,
  MAX_RETRY_CAPACITY,
  MAX_DEADLETTER_CAPACITY,
} from '../src/lib/security/queue';
import { resolveDatabaseUrl, MAINTENANCE_ADVISORY_LOCK_ID } from './maintenance-runner';

export interface OpsMetrics {
  timestamp: string;
  status: 'OK' | 'WARN' | 'CRITICAL';
  reasons: string[];
  redis: {
    status: 'CONNECTED' | 'ERROR';
    latencyMs?: number;
    usedMemoryBytes?: number;
    maxMemoryBytes?: number;
    memoryUtilization?: number;
    queues: {
      queueLength: number;
      processingLength: number;
      retryCount: number;
      deadletterLength: number;
    };
    processing?: {
      processingCount: number;
      activeClaimsCount: number;
      missingLeaseCount: number;
      expiredLeaseCount: number;
      mismatchedLeaseCount: number;
      malformedProcessingEntryCount: number;
      workerHeartbeatStatus: 'HEALTHY' | 'STALE' | 'HEARTBEAT_LOST' | 'MALFORMED' | 'IDLE';
    };
  };
  postgres: {
    status: 'CONNECTED' | 'ERROR';
    carnoAppConnections?: number;
    runnerConnections?: number;
    totalConnections?: number;
    maxConnections?: number;
    carnoAppLimit: number;
    headroom?: number;
    maintenanceLock?: {
      held: boolean;
      holderPid?: number;
      holderApp?: string;
      holderUser?: string;
      holderState?: string;
      contention: boolean;
      acquisitionAge: string;
      connectionAgeSec?: number;
    };
  };
  alertDelivery: {
    configured: boolean;
    sent?: boolean;
    throttled?: boolean;
    error?: string;
    deliveryStatus: 'DESTINATION_UNCONFIGURED' | 'DISPATCHED' | 'THROTTLED' | 'DELIVERY_FAILED' | 'SKIPPED_HEALTHY';
  };
}

export interface OpsCheckOptions {
  quiet?: boolean;
  forceAlert?: boolean;
  customKeys?: {
    queueKey?: string;
    processingKey?: string;
    retryKey?: string;
    deadletterKey?: string;
    leasePrefix?: string;
  };
  customThrottlePrefix?: string;
}

function sanitizeAlertError(err: unknown): string {
  if (!err) return 'UNKNOWN_ALERT_ERROR';
  let msg = '';
  if (err instanceof Error) {
    msg = err.message;
    if ('cause' in err && err.cause) {
      msg += ` (cause: ${err.cause instanceof Error ? err.cause.message : String(err.cause)})`;
    }
  } else {
    msg = String(err);
  }
  return msg
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
    .replace(/(?:token|key|secret|password|auth|sig|signature)=[^\s&"']+/gi, '$1=[REDACTED]');
}

export async function runOperationalCheck(options: OpsCheckOptions = {}): Promise<OpsMetrics> {
  const now = new Date().toISOString();
  const reasons: string[] = [];
  let worstStatus: 'OK' | 'WARN' | 'CRITICAL' = 'OK';

  const setStatus = (newStatus: 'WARN' | 'CRITICAL', reason: string) => {
    reasons.push(reason);
    if (newStatus === 'CRITICAL') {
      worstStatus = 'CRITICAL';
    } else if (newStatus === 'WARN' && worstStatus !== 'CRITICAL') {
      worstStatus = 'WARN';
    }
  };

  const queueKey = options.customKeys?.queueKey ?? QUEUE_KEY;
  const processingKey = options.customKeys?.processingKey ?? PROCESSING_KEY;
  const retryKey = options.customKeys?.retryKey ?? RETRY_KEY;
  const deadletterKey = options.customKeys?.deadletterKey ?? DEADLETTER_KEY;
  const leasePrefix = options.customKeys?.leasePrefix ?? LEASE_PREFIX;
  const throttlePrefix = options.customThrottlePrefix ?? 'ops:alert:throttle';

  // --------------------------------------------------------------------------
  // 1. Redis Queue, Worker Heartbeat & Memory Telemetry
  // --------------------------------------------------------------------------
  const redisMetrics: OpsMetrics['redis'] = {
    status: 'ERROR',
    queues: {
      queueLength: 0,
      processingLength: 0,
      retryCount: 0,
      deadletterLength: 0,
    },
  };

  const redis = getRedisClient();
  if (!redis) {
    setStatus('CRITICAL', 'REDIS_CLIENT_UNAVAILABLE: Could not initialize authenticated Redis client');
  } else {
    try {
      const pingStart = Date.now();
      const pingRes = await redis.ping();
      redisMetrics.latencyMs = Date.now() - pingStart;

      if (pingRes !== 'PONG') {
        setStatus('CRITICAL', `REDIS_UNRESPONSIVE: Ping returned unexpected response: ${pingRes}`);
      } else {
        redisMetrics.status = 'CONNECTED';

        // Query read-only counts
        const [qLen, pLen, rLen, dlLen] = await Promise.all([
          redis.llen(queueKey),
          redis.llen(processingKey),
          redis.zcard(retryKey),
          redis.llen(deadletterKey),
        ]);

        redisMetrics.queues = {
          queueLength: qLen,
          processingLength: pLen,
          retryCount: rLen,
          deadletterLength: dlLen,
        };

        // Query memory stats
        const infoMem = await redis.info('memory');
        const usedMemMatch = infoMem.match(/used_memory:(\d+)/);
        const maxMemMatch = infoMem.match(/maxmemory:(\d+)/);

        if (usedMemMatch && maxMemMatch) {
          const usedBytes = parseInt(usedMemMatch[1], 10);
          const maxBytes = parseInt(maxMemMatch[1], 10);
          redisMetrics.usedMemoryBytes = usedBytes;
          redisMetrics.maxMemoryBytes = maxBytes;

          if (maxBytes > 0) {
            const ratio = usedBytes / maxBytes;
            redisMetrics.memoryUtilization = Math.round(ratio * 1000) / 1000;

            if (ratio >= 0.95) {
              setStatus('CRITICAL', `REDIS_MEMORY_CRITICAL: Memory utilization at ${Math.round(ratio * 100)}% of 256MB`);
            } else if (ratio >= 0.80) {
              setStatus('WARN', `REDIS_MEMORY_HIGH: Memory utilization at ${Math.round(ratio * 100)}% of 256MB`);
            }
          }
        }

        // Evaluate Queue Thresholds
        if (dlLen > 50) {
          setStatus('CRITICAL', `DEADLETTER_CRITICAL: ${dlLen} entries in ${deadletterKey} (cap: ${MAX_DEADLETTER_CAPACITY})`);
        } else if (dlLen > 0) {
          setStatus('WARN', `DEADLETTER_WARNING: ${dlLen} failed jobs in ${deadletterKey}`);
        }

        if (qLen > 5000) {
          setStatus('CRITICAL', `QUEUE_BACKLOG_CRITICAL: ${qLen} pending jobs in ${queueKey} (cap: ${MAX_QUEUE_CAPACITY})`);
        } else if (qLen > 100) {
          setStatus('WARN', `QUEUE_BACKLOG_HIGH: ${qLen} pending jobs in ${queueKey}`);
        }

        if (rLen > 3500) {
          setStatus('CRITICAL', `RETRY_BACKLOG_CRITICAL: ${rLen} retry jobs in ${retryKey} (cap: ${MAX_RETRY_CAPACITY})`);
        } else if (rLen > 500) {
          setStatus('WARN', `RETRY_BACKLOG_ELEVATED: ${rLen} retry jobs in ${retryKey}`);
        }

        // Processing queue & worker heartbeat inspection
        const procTelemetry = {
          processingCount: pLen,
          activeClaimsCount: 0,
          missingLeaseCount: 0,
          expiredLeaseCount: 0,
          mismatchedLeaseCount: 0,
          malformedProcessingEntryCount: 0,
          workerHeartbeatStatus: (pLen === 0 ? 'IDLE' : 'HEALTHY') as 'HEALTHY' | 'STALE' | 'HEARTBEAT_LOST' | 'MALFORMED' | 'IDLE',
        };

        if (pLen > 10) {
          setStatus('CRITICAL', `PROCESSING_CAPACITY_EXCEEDED: ${pLen} jobs in ${processingKey}`);
        } else if (pLen > 1) {
          setStatus('WARN', `CONCURRENT_PROCESSING_ANOMALY: ${pLen} jobs in ${processingKey} (singleton worker expected)`);
        }

        if (pLen > 0) {
          // Bounded inspection of up to 10 entries without dumping payloads
          const procItems = await redis.lrange(processingKey, 0, 9);
          for (const item of procItems) {
            const colonIdx = item.indexOf(':');
            if (colonIdx === -1 || colonIdx === 0 || colonIdx === item.length - 1) {
              procTelemetry.malformedProcessingEntryCount++;
              continue;
            }

            const jobId = item.substring(0, colonIdx);
            const claimToken = item.substring(colonIdx + 1);

            const leaseKey = `${leasePrefix}${jobId}`;
            const [currentLease, ttl] = await Promise.all([
              redis.get(leaseKey),
              redis.ttl(leaseKey),
            ]);

            if (currentLease === null) {
              procTelemetry.missingLeaseCount++;
            } else if (currentLease !== claimToken) {
              procTelemetry.mismatchedLeaseCount++;
            } else {
              if (ttl <= 0) {
                procTelemetry.expiredLeaseCount++;
              } else {
                procTelemetry.activeClaimsCount++;
              }
            }
          }

          if (procTelemetry.missingLeaseCount > 0 || procTelemetry.expiredLeaseCount > 0) {
            procTelemetry.workerHeartbeatStatus = 'HEARTBEAT_LOST';
            setStatus(
              'CRITICAL',
              `WORKER_HEARTBEAT_LOST: ${procTelemetry.missingLeaseCount + procTelemetry.expiredLeaseCount} claim(s) in processing have missing/expired lease`
            );
          } else if (procTelemetry.mismatchedLeaseCount > 0) {
            procTelemetry.workerHeartbeatStatus = 'STALE';
            setStatus(
              'WARN',
              `STALE_PROCESSING_CLAIM: ${procTelemetry.mismatchedLeaseCount} claim(s) in processing superseded by newer claim`
            );
          } else if (procTelemetry.malformedProcessingEntryCount > 0) {
            procTelemetry.workerHeartbeatStatus = 'MALFORMED';
            setStatus(
              'WARN',
              `MALFORMED_PROCESSING_ENTRY: ${procTelemetry.malformedProcessingEntryCount} invalid claim entry format(s)`
            );
          }
        }

        redisMetrics.processing = procTelemetry;
      }
    } catch (redisErr: unknown) {
      setStatus('CRITICAL', `REDIS_QUERY_FAILED: ${redisErr instanceof Error ? redisErr.message : String(redisErr)}`);
    }
  }

  // --------------------------------------------------------------------------
  // 2. PostgreSQL Connection Saturation & Headroom Telemetry
  // --------------------------------------------------------------------------
  const pgMetrics: OpsMetrics['postgres'] = {
    status: 'ERROR',
    carnoAppLimit: 40,
  };

  try {
    const dbUrl = resolveDatabaseUrl();
    const pgClient = new Client({
      connectionString: dbUrl,
      application_name: 'carno_ops_checker',
      connectionTimeoutMillis: 5000,
    });

    await pgClient.connect();
    try {
      const statsRes = await pgClient.query<{
        carno_app_total: string;
        runner_total: string;
        total: string;
        max_connections: string;
      }>(`
        SELECT 
          count(*) FILTER (WHERE usename = 'carno_app') as carno_app_total,
          count(*) FILTER (WHERE usename = 'carno_app' AND (application_name = 'carno_maintenance_runner' OR application_name = 'carno-maintenance-runner')) as runner_total,
          count(*) as total,
          current_setting('max_connections') as max_connections
        FROM pg_stat_activity;
      `);

      if (statsRes.rows[0]) {
        const carnoAppTotal = parseInt(statsRes.rows[0].carno_app_total, 10);
        const runnerTotal = parseInt(statsRes.rows[0].runner_total, 10);
        const total = parseInt(statsRes.rows[0].total, 10);
        const maxConns = parseInt(statsRes.rows[0].max_connections, 10);

        pgMetrics.status = 'CONNECTED';
        pgMetrics.carnoAppConnections = carnoAppTotal;
        pgMetrics.runnerConnections = runnerTotal;
        pgMetrics.totalConnections = total;
        pgMetrics.maxConnections = maxConns;
        pgMetrics.headroom = 40 - carnoAppTotal;

        if (carnoAppTotal >= 36) {
          setStatus('CRITICAL', `POSTGRES_CONNECTIONS_CRITICAL: carno_app using ${carnoAppTotal}/40 connections`);
        } else if (carnoAppTotal >= 30) {
          setStatus('WARN', `POSTGRES_CONNECTIONS_HIGH: carno_app using ${carnoAppTotal}/40 connections`);
        }
      }

      // Check maintenance precondition indexes
      const idxRes = await pgClient.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'OTPVerification'
          AND schemaname = 'public'
          AND indexname IN ('OTPVerification_retention_unverified_idx', 'OTPVerification_retention_verified_idx');
      `);
      const foundIndexes = idxRes.rows.map((r) => r.indexname);
      if (foundIndexes.length < 2) {
        setStatus('CRITICAL', 'MAINTENANCE_PRECONDITION_FAILED: Required OTP retention partial indexes missing');
      }

      // Check maintenance advisory lock state & holder metadata
      const lockRes = await pgClient.query<{
        pid: number;
        granted: boolean;
        usename: string;
        application_name: string;
        state: string;
        connection_age_sec: number;
      }>(`
        SELECT 
          l.pid,
          l.granted,
          a.usename,
          a.application_name,
          a.state,
          EXTRACT(EPOCH FROM (clock_timestamp() - a.backend_start))::int as connection_age_sec
        FROM pg_locks l
        JOIN pg_stat_activity a USING (pid)
        WHERE l.locktype = 'advisory' 
          AND l.objid = ${MAINTENANCE_ADVISORY_LOCK_ID};
      `);

      const lockRows = lockRes.rows;
      const holder = lockRows.find((r) => r.granted);
      const waiters = lockRows.filter((r) => !r.granted);

      const lockTelemetry: NonNullable<OpsMetrics['postgres']['maintenanceLock']> = {
        held: !!holder,
        holderPid: holder?.pid,
        holderApp: holder?.application_name,
        holderUser: holder?.usename,
        holderState: holder?.state,
        contention: waiters.length > 0,
        acquisitionAge: 'UNKNOWN_PG_LOCKS_LIMITATION',
        connectionAgeSec: holder?.connection_age_sec,
      };

      pgMetrics.maintenanceLock = lockTelemetry;

      if (lockTelemetry.contention) {
        setStatus('WARN', `MAINTENANCE_LOCK_CONTENTION: ${waiters.length} session(s) contending for advisory lock ${MAINTENANCE_ADVISORY_LOCK_ID}`);
      }

      if (holder) {
        const isRunner =
          holder.application_name === 'carno_maintenance_runner' ||
          holder.application_name === 'carno-maintenance-runner';
        if (isRunner) {
          // Maintenance runner executes as a short-lived standalone process (< 10s).
          // If connection has been alive holding the lock for > 30 minutes, it indicates a stalled runner process.
          if (holder.connection_age_sec > 1800) {
            setStatus(
              'CRITICAL',
              `MAINTENANCE_RUNNER_STALLED: carno_maintenance_runner connection active for ${holder.connection_age_sec}s holding lock ${MAINTENANCE_ADVISORY_LOCK_ID}`
            );
          }
        } else {
          // Held by an unexpected connection (e.g. carno_app or psql session)
          setStatus(
            'WARN',
            `MAINTENANCE_LOCK_UNEXPECTED_HOLDER: Advisory lock ${MAINTENANCE_ADVISORY_LOCK_ID} held by non-runner '${holder.application_name}' (PID ${holder.pid})`
          );
        }
      }
    } finally {
      await pgClient.end().catch(() => {});
    }
  } catch (pgErr: unknown) {
    setStatus('CRITICAL', `POSTGRES_QUERY_FAILED: ${pgErr instanceof Error ? pgErr.message : String(pgErr)}`);
  }

  // --------------------------------------------------------------------------
  // 3. Alert Delivery Check & Deduplication (Webhook Dispatcher)
  // --------------------------------------------------------------------------
  const alertDelivery: OpsMetrics['alertDelivery'] = {
    configured: false,
    deliveryStatus: 'DESTINATION_UNCONFIGURED',
  };

  const isProduction = process.env.NODE_ENV === 'production';
  const rawWebhookUrl = process.env.OPS_ALERT_WEBHOOK_URL?.trim();

  if (rawWebhookUrl) {
    if (isProduction && !rawWebhookUrl.startsWith('https://')) {
      alertDelivery.configured = false;
      alertDelivery.deliveryStatus = 'DESTINATION_UNCONFIGURED';
      alertDelivery.error = 'UNSECURE_HTTP_REJECTED: Production webhook URL must use HTTPS';
      setStatus('WARN', 'ALERT_CONFIG_UNSECURE: OPS_ALERT_WEBHOOK_URL rejected because HTTP is not permitted in production');
    } else if (rawWebhookUrl.startsWith('https://') || (!isProduction && rawWebhookUrl.startsWith('http://'))) {
      alertDelivery.configured = true;

      if (worstStatus === 'OK') {
        alertDelivery.deliveryStatus = 'SKIPPED_HEALTHY';
        // When system is healthy, clear any active throttling keys in Redis
        if (redis && redisMetrics.status === 'CONNECTED') {
          await Promise.all([
            redis.del(`${throttlePrefix}:WARN`).catch(() => {}),
            redis.del(`${throttlePrefix}:CRITICAL`).catch(() => {}),
          ]);
        }
      } else {
        const throttleKey = `${throttlePrefix}:${worstStatus}`;
        let throttled = false;

        if (redisMetrics.status === 'CONNECTED' && !options.forceAlert && redis) {
          try {
            const isThrottled = await redis.get(throttleKey);
            if (isThrottled) {
              throttled = true;
              alertDelivery.throttled = true;
              alertDelivery.deliveryStatus = 'THROTTLED';
            }
          } catch {
            // If Redis throttle check fails, proceed with dispatch
          }
        }

        if (!throttled) {
          try {
            const payload = {
              service: 'carno-platform',
              environment: process.env.NODE_ENV || 'development',
              status: worstStatus,
              timestamp: now,
              reasons,
              queues: redisMetrics.queues,
              processing: redisMetrics.processing,
              connections: {
                carnoApp: pgMetrics.carnoAppConnections,
                runner: pgMetrics.runnerConnections,
                headroom: pgMetrics.headroom,
              },
            };

            const res = await fetch(rawWebhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(5000),
            });

            alertDelivery.sent = res.ok;
            alertDelivery.deliveryStatus = res.ok ? 'DISPATCHED' : 'DELIVERY_FAILED';

            if (!res.ok) {
              alertDelivery.error = `HTTP_${res.status}`;
            } else if (redisMetrics.status === 'CONNECTED' && redis) {
              await redis.set(throttleKey, '1', 'EX', 900).catch(() => {});
            }
          } catch (alertErr: unknown) {
            alertDelivery.sent = false;
            alertDelivery.deliveryStatus = 'DELIVERY_FAILED';
            alertDelivery.error = sanitizeAlertError(alertErr);
          }
        }
      }
    } else {
      alertDelivery.configured = false;
      alertDelivery.deliveryStatus = 'DESTINATION_UNCONFIGURED';
      alertDelivery.error = 'INVALID_WEBHOOK_SCHEME: URL must start with https:// (or http:// in development)';
    }
  }

  const result: OpsMetrics = {
    timestamp: now,
    status: worstStatus,
    reasons,
    redis: redisMetrics,
    postgres: pgMetrics,
    alertDelivery,
  };

  if (!options.quiet) {
    console.log(JSON.stringify(result, null, 2));
  }

  return result;
}

// ----------------------------------------------------------------------------
// CLI Execution Entrypoint
// ----------------------------------------------------------------------------
if (require.main === module || (process.argv[1] && path.basename(process.argv[1]) === 'operational-check.ts')) {
  runOperationalCheck()
    .then((metrics) => {
      let code = 0;
      if (metrics.status === 'CRITICAL') {
        code = 1;
      } else if (metrics.status === 'WARN') {
        code = 2;
      }
      process.exit(code);
    })
    .catch((err) => {
      console.error('[OPS_CHECK_FATAL]', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
