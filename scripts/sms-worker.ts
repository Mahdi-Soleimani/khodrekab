/**
 * CARNO PHASE C1.5 STANDALONE SMS WORKER DAEMON
 * Drains sms:dispatch:queue using atomic BLMOVE to processing list.
 * Uses a dedicated Redis connection without web commandTimeout (250ms).
 * Periodically executes reaper to recover orphaned or timed-out jobs.
 * Handles SIGTERM / SIGINT for graceful shutdown without losing in-flight jobs.
 */

import Redis from 'ioredis';
import { processNextJob, reapStaleProcessingJobs, getSmsPayloadKey } from '../src/lib/security/queue';

let isRunning = true;
let isJobInFlight = false;

// Dedicated Redis connection for the worker daemon
// Crucial: NO commandTimeout (0 / omitted) so BLMOVE can block for 3-5 seconds without timeout errors.
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const workerRedis = new Redis(redisUrl, {
  connectTimeout: 5000,
  maxRetriesPerRequest: null, // Required by ioredis for blocking commands like BLMOVE
  retryStrategy(times) {
    const delay = Math.min(times * 500, 5000);
    return delay;
  },
});

function maskUrl(urlOrMsg: string): string {
  return urlOrMsg.replace(/:\/\/[^@]+@/, '://***@');
}

workerRedis.on('error', (err) => {
  const safeMsg = maskUrl(err?.message || 'Worker Redis connection error');
  console.error(`[SMS_WORKER_REDIS_ERROR] ${safeMsg}`);
});

async function runWorker() {
  console.log('[SMS_WORKER] Starting Carno C1.5 Reliable SMS Worker...');

  try {
    const ping = await workerRedis.ping();
    if (ping !== 'PONG') {
      throw new Error(`Unexpected ping response: ${ping}`);
    }
  } catch (err: any) {
    const safeMsg = maskUrl(err?.message || 'Redis unreachable');
    console.error(`[SMS_WORKER_ERROR] Redis is unreachable at startup: ${safeMsg}`);
    process.exit(1);
  }

  // Fail-fast if SMS_ENCRYPTION_KEY is unconfigured or invalid
  try {
    getSmsPayloadKey();
  } catch (keyErr: any) {
    console.error(`[SMS_WORKER_ERROR] Encryption key error: ${keyErr.message}`);
    process.exit(1);
  }

  console.log('[SMS_WORKER_READY] Connected to dedicated Redis client. Listening for dispatch jobs...');

  // Start periodic reaper loop (every 15s) using workerRedis
  const reaperInterval = setInterval(async () => {
    if (!isRunning) return;
    try {
      const reaped = await reapStaleProcessingJobs(45000, workerRedis);
      if (reaped > 0) {
        console.log(`[SMS_REAPER] Recovered ${reaped} stale job(s) from processing list`);
      }
    } catch (err: any) {
      const safeMsg = maskUrl(err?.message || 'Reaper error');
      console.error(`[SMS_REAPER_ERROR] ${safeMsg}`);
    }
  }, 15000);

  // Main processing loop with stepped backoff on errors
  let backoffMs = 500;

  while (isRunning) {
    try {
      isJobInFlight = true;
      // Block for up to 3 seconds waiting for a new job on the dedicated Redis connection
      const processed = await processNextJob(3, workerRedis);
      backoffMs = 500; // Reset backoff on clean iteration
      if (processed) {
        // Small yield between consecutive processed jobs
        await new Promise((r) => setImmediate(r));
      }
    } catch (err: any) {
      const safeMsg = maskUrl(err?.message || 'Worker loop exception');
      console.error(`[SMS_WORKER_LOOP_ERROR] ${safeMsg}`);
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 5000);
    } finally {
      isJobInFlight = false;
    }
  }

  clearInterval(reaperInterval);
  console.log('[SMS_WORKER] Main loop stopped. Performing cleanup...');
  await workerRedis.quit().catch(() => workerRedis.disconnect());
  console.log('[SMS_WORKER] Worker shutdown complete.');
  process.exit(0);
}

function handleShutdown(signal: string) {
  console.log(`\n[SMS_WORKER_SHUTDOWN] Received ${signal}. Shutting down gracefully...`);
  isRunning = false;

  // Force exit after 10s if in-flight job hangs
  setTimeout(() => {
    console.error('[SMS_WORKER_FORCE_EXIT] Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// Execute worker
runWorker().catch((err: any) => {
  const safeMsg = maskUrl(err?.message || 'Fatal error');
  console.error(`[SMS_WORKER_FATAL] ${safeMsg}`);
  process.exit(1);
});
