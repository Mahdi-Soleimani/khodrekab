/**
 * CARNO GATE C5 — PHASE 3 PRODUCTION SMS WORKER DAEMON
 *
 * Concurrency: 1 (strictly sequential processing loop)
 * Delivery semantic: At-least-once delivery with bounded duplicate risk (never exactly-once)
 * Lease TTL: 45 seconds | Heartbeat Interval: 15 seconds
 * Provider Timeout: 10 seconds via AbortSignal.timeout(10000)
 * Attempts: Max 3 initiated attempts. Backoff: Attempt 1 -> 5s, Attempt 2 -> 20s, Attempt 3 -> Deadletter
 * Expiry: Pre-send validation against stored expiresAt. Date.now() >= expiresAt -> Deadletter OTP_EXPIRED_BEFORE_SEND
 * Graceful Shutdown: SIGTERM / SIGINT stops new claims immediately, drains active job up to 15s with heartbeat active.
 * Phase 4 Boundary: Reaper, ZSET promotion scheduler, and retention runners are strictly omitted.
 */

import fs from 'fs';
import path from 'path';
import Redis from 'ioredis';
import {
  atomicClaim,
  conditionalLeaseRefresh,
  conditionalAck,
  transferToDeadletter,
  reserveProviderAttempt,
  recordProviderFailure,
  scheduleRetry,
  getSmsPayloadKey,
  decryptPayload,
  reapStaleProcessingJobs,
  promoteDueRetryJobs,
  ReaperSweepResult,
  PromotionSweepResult,
  META_PREFIX,
  PAYLOAD_PREFIX,
  STATUS_PREFIX,
  LEASE_TTL_SECONDS,
  DecryptedSmsPayload,
} from '../src/lib/security/queue';
import { smsService, maskPhone } from '../src/lib/sms';

export interface SmsWorkerOptions {
  redisClient?: Redis;
  smsService?: {
    sendOtp: (input: { phone: string; code: string }) => Promise<{
      success: boolean;
      providerMessageId?: string;
      error?: string;
    }>;
  };
  pollIntervalMs?: number;       // default: 1000ms
  heartbeatIntervalMs?: number;  // default: 15000ms
  leaseTtlSeconds?: number;      // default: 45s
  shutdownGraceMs?: number;      // default: 15000ms
  autoStartSignals?: boolean;    // default: true
  enableReaper?: boolean;        // default: true
  reaperCadenceMs?: number;      // default: 15000ms
  enableScheduler?: boolean;     // default: true
  schedulerCadenceMs?: number;   // default: 1000ms
  promotionBatchSize?: number;   // default: 100
}

export interface ProcessResult {
  processed: boolean;
  status?: string;
  reason?: string;
  jobId?: string;
  attemptNumber?: number;
  backoffMs?: number;
  error?: string;
}

export class SmsWorker {
  private redis: Redis;
  private smsService: {
    sendOtp: (input: { phone: string; code: string }) => Promise<{
      success: boolean;
      providerMessageId?: string;
      error?: string;
    }>;
  };
  private pollIntervalMs: number;
  private heartbeatIntervalMs: number;
  private leaseTtlSeconds: number;
  private shutdownGraceMs: number;
  private enableReaper: boolean;
  private reaperCadenceMs: number;
  private enableScheduler: boolean;
  private schedulerCadenceMs: number;
  private promotionBatchSize: number;

  private isRunning = false;
  private isJobInFlight = false;
  private isReaping = false;
  private isScheduling = false;
  private reaperTimer: NodeJS.Timeout | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private activeJobPromise: Promise<ProcessResult> | null = null;
  private loopPromise: Promise<void> | null = null;
  private shutdownInitiated = false;
  private managesOwnRedis = false;

  constructor(options: SmsWorkerOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
    this.leaseTtlSeconds = options.leaseTtlSeconds ?? LEASE_TTL_SECONDS;
    this.shutdownGraceMs = options.shutdownGraceMs ?? 15000;
    this.smsService = options.smsService ?? smsService;
    this.enableReaper = options.enableReaper ?? true;
    this.reaperCadenceMs = options.reaperCadenceMs ?? 15000;
    this.enableScheduler = options.enableScheduler ?? true;
    this.schedulerCadenceMs = options.schedulerCadenceMs ?? 1000;
    this.promotionBatchSize = options.promotionBatchSize ?? 100;

    if (options.redisClient) {
      this.redis = options.redisClient;
      this.managesOwnRedis = false;
    } else {
      this.redis = this.createDefaultRedisClient();
      this.managesOwnRedis = true;
    }

    if (options.autoStartSignals !== false) {
      this.bindProcessSignals();
    }
  }

  private createDefaultRedisClient(): Redis {
    const isProduction = process.env.NODE_ENV === 'production';
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6380';
    let password = process.env.REDIS_PASSWORD;
    const candidatePasswordFiles = [
      process.env.REDIS_PASSWORD_FILE,
      '/run/secrets/redis_password',
      path.join(process.cwd(), 'secrets/redis_password.txt'),
    ].filter((p): p is string => Boolean(p));

    if (!password) {
      for (const p of candidatePasswordFiles) {
        try {
          const resolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
          if (fs.existsSync(resolved)) {
            const fileContent = fs.readFileSync(resolved, 'utf8').trim();
            if (fileContent.length > 0) {
              password = fileContent;
              break;
            }
          }
        } catch {}
      }
    }

    if (isProduction && !password && !redisUrl.includes('@')) {
      throw new Error('[SMS_WORKER_FATAL] FAIL_CLOSED: Redis authentication required in production, but no password configured');
    }

    const client = new Redis(redisUrl, {
      connectTimeout: 5000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 1,
      password: password || undefined,
      retryStrategy(times) {
        return Math.min(times * 200, 3000);
      },
    });

    client.on('error', (err) => {
      const masked = err.message.replace(/:([^:@]+)@/g, ':***@');
      console.error('[SMS_WORKER_REDIS_ERROR]', masked);
    });

    return client;
  }

  private bindProcessSignals(): void {
    const onSignal = (sig: string) => {
      console.log(`\n[SMS_WORKER_SHUTDOWN] Received ${sig}. Starting graceful shutdown...`);
      this.stop().catch((err) => {
        console.error('[SMS_WORKER_SHUTDOWN_ERROR]', err);
      });
    };

    process.once('SIGTERM', () => onSignal('SIGTERM'));
    process.once('SIGINT', () => onSignal('SIGINT'));
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    // Fail-fast if SMS_ENCRYPTION_KEY is unconfigured or invalid
    try {
      getSmsPayloadKey();
    } catch (keyErr: unknown) {
      const msg = keyErr instanceof Error ? keyErr.message : String(keyErr);
      console.error(`[SMS_WORKER_FATAL] Encryption key unconfigured or invalid: ${msg}`);
      throw keyErr;
    }

    this.isRunning = true;
    this.shutdownInitiated = false;
    console.log('[SMS_WORKER_READY] Worker loop started. Listening for SMS dispatch jobs...');

    if (this.enableReaper) {
      this.startReaperLoop();
    }
    if (this.enableScheduler) {
      this.startSchedulerLoop();
    }

    this.loopPromise = this.runLoop();
    await this.loopPromise;
  }

  private startReaperLoop(): void {
    this.reaperTimer = setInterval(async () => {
      if (!this.isRunning || this.shutdownInitiated || this.isReaping) return;
      await this.runReaperSweep();
    }, this.reaperCadenceMs);
  }

  private startSchedulerLoop(): void {
    this.schedulerTimer = setInterval(async () => {
      if (!this.isRunning || this.shutdownInitiated || this.isScheduling) return;
      await this.runSchedulerTick();
    }, this.schedulerCadenceMs);
  }

  public async runReaperSweep(): Promise<ReaperSweepResult> {
    if (this.isReaping || this.shutdownInitiated) {
      return { reaped: 0, requeued: 0, divertedRetry: 0, deadlettered: 0, staleRemoved: 0, activeSkipped: 0, errors: 0, details: [] };
    }
    this.isReaping = true;
    try {
      const result = await reapStaleProcessingJobs(this.leaseTtlSeconds * 1000, this.redis);
      if (result.reaped > 0 || result.staleRemoved > 0) {
        console.log(`[SMS_WORKER_REAPER] Sweep complete: requeued=${result.requeued}, divertedRetry=${result.divertedRetry}, deadlettered=${result.deadlettered}, staleRemoved=${result.staleRemoved}`);
      }
      return result;
    } catch (err: unknown) {
      console.error('[SMS_WORKER_REAPER_ERROR]', err instanceof Error ? err.message : String(err));
      return { reaped: 0, requeued: 0, divertedRetry: 0, deadlettered: 0, staleRemoved: 0, activeSkipped: 0, errors: 1, details: [] };
    } finally {
      this.isReaping = false;
    }
  }

  public async runSchedulerTick(): Promise<PromotionSweepResult> {
    if (this.isScheduling || this.shutdownInitiated) {
      return { examined: 0, promoted: 0, postponed: 0, deadlettered: 0, skipped: 0, errors: 0, details: [] };
    }
    this.isScheduling = true;
    try {
      const result = await promoteDueRetryJobs(this.promotionBatchSize, this.redis);
      if (result.promoted > 0 || result.postponed > 0 || result.deadlettered > 0) {
        console.log(`[SMS_WORKER_SCHEDULER] Tick complete: promoted=${result.promoted}, postponed=${result.postponed}, deadlettered=${result.deadlettered}`);
      }
      return result;
    } catch (err: unknown) {
      console.error('[SMS_WORKER_SCHEDULER_ERROR]', err instanceof Error ? err.message : String(err));
      return { examined: 0, promoted: 0, postponed: 0, deadlettered: 0, skipped: 0, errors: 1, details: [] };
    } finally {
      this.isScheduling = false;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning && !this.isJobInFlight) return;
    this.shutdownInitiated = true;
    this.isRunning = false;

    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }

    if (this.isJobInFlight && this.activeJobPromise) {
      console.log(`[SMS_WORKER_DRAINING] Draining active job (grace period: ${this.shutdownGraceMs}ms)...`);
      let timeoutHandle: NodeJS.Timeout;
      const graceTimeout = new Promise<'TIMED_OUT'>((resolve) => {
        timeoutHandle = setTimeout(() => resolve('TIMED_OUT'), this.shutdownGraceMs);
      });

      const outcome = await Promise.race([this.activeJobPromise, graceTimeout]);
      clearTimeout(timeoutHandle!);

      if (outcome === 'TIMED_OUT') {
        console.warn('[SMS_WORKER_ABANDON] Grace period expired while job in flight. Abandoning claim for Phase 4 Reaper recovery.');
      } else {
        console.log('[SMS_WORKER_DRAINED] Active job drained cleanly.');
      }
    }

    if (this.managesOwnRedis) {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
    }

    console.log('[SMS_WORKER_STOPPED] Worker daemon shutdown complete.');
  }

  private async runLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const result = await this.processSingleJob();
        if (!result.processed && result.reason === 'EMPTY') {
          // Bounded, non-busy wait when queue is empty
          await new Promise((r) => setTimeout(r, this.pollIntervalMs));
        } else if (result.processed) {
          // Micro-yield between consecutive jobs to avoid thread starvation
          await new Promise((r) => setImmediate(r));
        }
      } catch (loopErr: unknown) {
        console.error('[SMS_WORKER_LOOP_ERROR]', loopErr instanceof Error ? loopErr.message : String(loopErr));
        await new Promise((r) => setTimeout(r, Math.min(this.pollIntervalMs, 2000)));
      }
    }
  }

  /**
   * Process a single claim with strict single-concurrency, heartbeat, expiry,
   * reservation, provider dispatch, ACK or retry/deadletter.
   */
  public async processSingleJob(): Promise<ProcessResult> {
    if (this.shutdownInitiated) {
      return { processed: false, reason: 'SHUTDOWN_IN_PROGRESS' };
    }

    // 1. Atomic Claim (concurrency = 1)
    let claimRes;
    try {
      claimRes = await atomicClaim(this.redis);
    } catch (claimErr: unknown) {
      const msg = claimErr instanceof Error ? claimErr.message : String(claimErr);
      console.error('[SMS_WORKER_CLAIM_EXCEPTION]', msg);
      return { processed: false, reason: 'REDIS_CLAIM_ERROR', error: msg };
    }

    if (claimRes.status === 'EMPTY' || !claimRes.jobId || !claimRes.claimToken) {
      return { processed: false, reason: claimRes.status };
    }

    const { jobId, claimToken } = claimRes;
    this.isJobInFlight = true;

    // Track active promise for shutdown draining
    const executionPromise = this.executeClaim(jobId, claimToken);
    this.activeJobPromise = executionPromise;

    try {
      const result = await executionPromise;
      return result;
    } finally {
      this.isJobInFlight = false;
      this.activeJobPromise = null;
    }
  }

  private async executeClaim(jobId: string, claimToken: string): Promise<ProcessResult> {
    let claimLost = false;
    let heartbeatActive = true;
    let heartbeatBusy = false;

    // 2. Lease Heartbeat: 15s interval, 45s TTL, conditional ownership check
    const heartbeatTimer = setInterval(async () => {
      if (!heartbeatActive || claimLost || heartbeatBusy) return;
      heartbeatBusy = true;
      try {
        const refreshRes = await conditionalLeaseRefresh(jobId, claimToken, this.leaseTtlSeconds, this.redis);
        if (refreshRes === 'LEASE_LOST') {
          claimLost = true;
          console.warn(`[SMS_WORKER_HEARTBEAT_LOST] Lease lost for ${jobId}; marking local claim lost`);
        }
      } catch (hbErr: unknown) {
        console.warn(`[SMS_WORKER_HEARTBEAT_WARN] Refresh failed for ${jobId}:`, hbErr instanceof Error ? hbErr.message : String(hbErr));
      } finally {
        heartbeatBusy = false;
      }
    }, this.heartbeatIntervalMs);

    const stopHeartbeat = () => {
      heartbeatActive = false;
      clearInterval(heartbeatTimer);
    };

    try {
      // 3. Fetch Metadata
      let meta: Record<string, string>;
      try {
        meta = await this.redis.hgetall(`${META_PREFIX}${jobId}`);
      } catch (metaErr: unknown) {
        stopHeartbeat();
        return { processed: false, reason: 'METADATA_FETCH_ERROR', error: String(metaErr) };
      }

      if (!meta || Object.keys(meta).length === 0) {
        stopHeartbeat();
        if (!claimLost) {
          await transferToDeadletter({
            jobId,
            sourceType: 'processing',
            claimToken,
            reason: 'METADATA_MISSING',
            customRedis: this.redis,
          });
        }
        return { processed: false, reason: 'METADATA_MISSING' };
      }

      // 4. Fetch and Decrypt Payload
      let payloadStr: string | null;
      try {
        payloadStr = await this.redis.get(`${PAYLOAD_PREFIX}${jobId}`);
      } catch (pErr: unknown) {
        stopHeartbeat();
        return { processed: false, reason: 'PAYLOAD_FETCH_ERROR', error: String(pErr) };
      }

      if (!payloadStr) {
        stopHeartbeat();
        if (!claimLost) {
          await transferToDeadletter({
            jobId,
            sourceType: 'processing',
            claimToken,
            reason: 'PAYLOAD_MISSING',
            customRedis: this.redis,
          });
        }
        return { processed: false, reason: 'PAYLOAD_MISSING' };
      }

      let payload: DecryptedSmsPayload;
      try {
        payload = decryptPayload(payloadStr);
      } catch {
        stopHeartbeat();
        if (!claimLost) {
          await transferToDeadletter({
            jobId,
            sourceType: 'processing',
            claimToken,
            reason: 'PAYLOAD_DECRYPT_ERROR',
            customRedis: this.redis,
          });
        }
        return { processed: false, reason: 'PAYLOAD_DECRYPT_ERROR' };
      }

      // 5. Atomic Provider Attempt Reservation (1, 2, 3 ok; 4 exhausted; checks lease ownership & expiry)
      const reservation = await reserveProviderAttempt(jobId, claimToken, this.redis);

      if (reservation.status === 'LEASE_MISMATCH') {
        stopHeartbeat();
        claimLost = true;
        return { processed: false, reason: 'LEASE_MISMATCH' };
      }

      if (reservation.status === 'OTP_EXPIRED') {
        stopHeartbeat();
        if (!claimLost) {
          await transferToDeadletter({
            jobId,
            sourceType: 'processing',
            claimToken,
            reason: 'OTP_EXPIRED_BEFORE_SEND',
            customRedis: this.redis,
          });
        }
        return { processed: false, reason: 'OTP_EXPIRED' };
      }

      if (reservation.status === 'EXHAUSTED') {
        stopHeartbeat();
        if (!claimLost) {
          await transferToDeadletter({
            jobId,
            sourceType: 'processing',
            claimToken,
            reason: 'MAX_PROVIDER_ATTEMPTS_EXCEEDED',
            customRedis: this.redis,
          });
        }
        return { processed: false, reason: 'MAX_ATTEMPTS_EXHAUSTED' };
      }

      if (reservation.status !== 'RESERVED' || !reservation.attemptNumber) {
        stopHeartbeat();
        return { processed: false, reason: reservation.status };
      }

      // Pre-send absolute expiry check (recheck stored expiresAt immediately before HTTP call)
      const expiresAt = Number(meta.expiresAt || 0);
      if (expiresAt > 0 && Date.now() >= expiresAt) {
        stopHeartbeat();
        if (!claimLost) {
          await transferToDeadletter({
            jobId,
            sourceType: 'processing',
            claimToken,
            reason: 'OTP_EXPIRED_BEFORE_SEND',
            customRedis: this.redis,
          });
        }
        return { processed: false, reason: 'OTP_EXPIRED_BEFORE_SEND' };
      }

      // Guard against lost lease before HTTP request initiation
      if (claimLost) {
        stopHeartbeat();
        console.warn(`[SMS_WORKER_ABORT] Claim lost prior to HTTP call for ${jobId}; aborting dispatch`);
        return { processed: false, reason: 'CLAIM_LOST_BEFORE_DISPATCH' };
      }

      // 6. Initiate HTTP Request to SMS Provider
      const masked = maskPhone(payload.phone);
      console.log(`[SMS_WORKER_DISPATCH] Dispatching job ${jobId} (attempt ${reservation.attemptNumber}/3) for ${masked}`);

      let sendSuccess = false;
      let sendError: string | undefined;
      let sendMsgId: string | undefined;

      try {
        const res = await this.smsService.sendOtp({ phone: payload.phone, code: payload.code });
        sendSuccess = res.success;
        sendError = res.error;
        sendMsgId = res.providerMessageId;
      } catch (dispErr: unknown) {
        sendSuccess = false;
        sendError = dispErr instanceof Error ? dispErr.message : 'DISPATCH_EXCEPTION';
      }

      // Stop heartbeat deterministically when provider call finishes
      stopHeartbeat();

      // Guard against lost lease during provider call
      if (claimLost) {
        console.warn(
          `[SMS_WORKER_UNCERTAINTY] Provider call finished (success=${sendSuccess}) for ${jobId}, but claim lease was lost. Outcome cannot be safely acknowledged; stale worker will not modify newer claim.`
        );
        return { processed: false, reason: 'CLAIM_LOST_DURING_DISPATCH' };
      }

      // 7. Success Path: Conditional ACK
      if (sendSuccess) {
        let ackRes: 'ACKED' | 'LEASE_MISMATCH' | 'NOT_IN_PROCESSING' | 'FAILED';
        try {
          ackRes = await conditionalAck(jobId, claimToken, this.redis);
        } catch (ackErr: unknown) {
          ackRes = 'FAILED';
          console.error(`[SMS_WORKER_ACK_ERROR] Redis failure during ACK for ${jobId}:`, ackErr instanceof Error ? ackErr.message : String(ackErr));
        }

        if (ackRes === 'ACKED') {
          try {
            await this.redis.set(`${STATUS_PREFIX}${meta.phoneHash}`, 'sent', 'EX', 120);
            await this.redis.incr('sms:stat:sent');
          } catch {}
          console.log(`[SMS_WORKER_ACKED] Job ${jobId} completed successfully (RecId: ${sendMsgId || 'N/A'})`);
          return { processed: true, status: 'ACKED', jobId };
        } else if (ackRes === 'LEASE_MISMATCH') {
          console.warn(`[SMS_WORKER_UNCERTAINTY] Provider succeeded but ACK rejected with LEASE_MISMATCH for ${jobId}. Newer claim untouched.`);
          return { processed: false, reason: 'ACK_LEASE_MISMATCH', jobId };
        } else if (ackRes === 'NOT_IN_PROCESSING') {
          console.warn(`[SMS_WORKER_UNCERTAINTY] Provider succeeded but job ${jobId} was not found in processing list.`);
          return { processed: false, reason: 'ACK_NOT_IN_PROCESSING', jobId };
        } else {
          console.error(`[SMS_WORKER_UNCERTAINTY] Provider succeeded but Redis failure occurred during ACK for ${jobId}. Outcome uncertain.`);
          return { processed: false, reason: 'ACK_REDIS_FAILURE', jobId };
        }
      }

      // 8. Failure and Retry Path
      try {
        await recordProviderFailure(jobId, this.redis);
      } catch (failErr: unknown) {
        console.error(`[SMS_WORKER_ERROR] Failed to record failure for ${jobId}:`, failErr instanceof Error ? failErr.message : String(failErr));
      }

      console.warn(`[SMS_WORKER_FAILED] Attempt ${reservation.attemptNumber}/3 failed for ${jobId}: ${sendError}`);

      const attemptNum = reservation.attemptNumber;
      if (attemptNum < 3) {
        // Backoff: Attempt 1 -> 5s, Attempt 2 -> 20s
        const backoffMs = attemptNum === 1 ? 5000 : 20000;
        try {
          const schedRes = await scheduleRetry(jobId, claimToken, backoffMs, this.redis);
          if (schedRes === 'SCHEDULED') {
            console.log(`[SMS_WORKER_RETRY] Job ${jobId} scheduled for retry in ${backoffMs}ms`);
            return { processed: false, reason: 'RETRY_SCHEDULED', attemptNumber: attemptNum, backoffMs };
          } else if (schedRes === 'OVERFLOW_DEADLETTER') {
            console.warn(`[SMS_WORKER_RETRY] Retry queue full; job ${jobId} overflowed to Deadletter`);
            return { processed: false, reason: 'RETRY_CAPACITY_OVERFLOW' };
          } else {
            console.warn(`[SMS_WORKER_RETRY] scheduleRetry returned ${schedRes} for ${jobId}`);
            return { processed: false, reason: schedRes };
          }
        } catch (schedErr: unknown) {
          console.error(`[SMS_WORKER_ERROR] Redis failure scheduling retry for ${jobId}; retry is NOT durable:`, schedErr instanceof Error ? schedErr.message : String(schedErr));
          return { processed: false, reason: 'RETRY_SCHED_REDIS_ERROR', error: String(schedErr) };
        }
      } else {
        // Exhausted attempt 3 -> Deadletter
        try {
          await transferToDeadletter({
            jobId,
            sourceType: 'processing',
            claimToken,
            reason: 'MAX_PROVIDER_ATTEMPTS_EXCEEDED',
            customRedis: this.redis,
          });
          console.warn(`[SMS_WORKER_DEADLETTER] Job ${jobId} exhausted all 3 provider attempts; transferred to Deadletter`);
          return { processed: false, reason: 'MAX_PROVIDER_ATTEMPTS_EXCEEDED' };
        } catch (dlErr: unknown) {
          console.error(`[SMS_WORKER_ERROR] Redis failure transferring exhausted job ${jobId} to Deadletter:`, dlErr instanceof Error ? dlErr.message : String(dlErr));
          return { processed: false, reason: 'DEADLETTER_TRANSFER_ERROR', error: String(dlErr) };
        }
      }
    } finally {
      stopHeartbeat();
    }
  }
}

// ----------------------------------------------------------------------------
// Standalone Daemon Entrypoint
// ----------------------------------------------------------------------------
if (process.argv[1]?.includes('sms-worker') && !process.env.TEST_ENV) {
  const worker = new SmsWorker();
  worker.start().catch((err: unknown) => {
    console.error('[SMS_WORKER_FATAL]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
