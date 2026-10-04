import { getRedisClient, isRedisAvailable } from './redis';
import { smsService } from '@/lib/sms';
import { getPhoneHash } from './otp';

export interface SmsDispatchJob {
  phone: string;
  code: string;
  challengeId: string;
  phoneHash: string;
  timestamp: number;
}

const QUEUE_KEY = 'sms:dispatch:queue';
let isWorkerRunning = false;

/**
 * Enqueues an SMS dispatch job to the Redis queue.
 * In production: strictly fail-closed if Redis is unavailable or push fails.
 */
export async function enqueueSmsDispatch(job: {
  phone: string;
  code: string;
  challengeId: string;
}): Promise<void> {
  const phoneHash = getPhoneHash(job.phone);
  const payload: SmsDispatchJob = {
    ...job,
    phoneHash,
    timestamp: Date.now(),
  };

  const redis = getRedisClient();
  const redisHealthy = await isRedisAvailable();

  if (!redisHealthy || !redis) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FAIL_CLOSED: Redis queue unavailable in production');
    }
    // In development only: dispatch asynchronously without blocking response
    setImmediate(async () => {
      try {
        await processSingleDispatch(payload);
      } catch (err) {
        console.error('[DEV_SMS_DISPATCH_ERROR]', err);
      }
    });
    return;
  }

  // Push to Redis queue
  await redis.lpush(QUEUE_KEY, JSON.stringify(payload));
  // Set initial status
  await redis.set(`sms:status:${phoneHash}`, 'queued', 'EX', 120);

  // Trigger worker to process queue
  triggerWorker();
}

/**
 * Dispatches a single job via MeliPayamak SMS service.
 */
async function processSingleDispatch(job: SmsDispatchJob): Promise<boolean> {
  const redis = getRedisClient();
  const sendResult = await smsService.sendOtp({
    phone: job.phone,
    code: job.code,
  });

  if (!sendResult.success) {
    console.error(`[SMS_QUEUE_DELIVERY_FAILED] Phone: ${job.phoneHash.substring(0, 8)} Error: ${sendResult.error}`);
    if (redis) {
      try {
        // Record failure status
        await redis.set(`sms:status:${job.phoneHash}`, 'failed', 'EX', 120);
        // Evict phone cooldown key immediately so client can retry without waiting 60s
        await redis.del(`sms:phone:${job.phoneHash}:cooldown`);
      } catch {}
    }
    return false;
  }

  if (redis) {
    try {
      await redis.set(`sms:status:${job.phoneHash}`, 'sent', 'EX', 120);
    } catch {}
  }
  return true;
}

/**
 * Worker processor that drains the Redis queue.
 */
export async function triggerWorker(): Promise<void> {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  try {
    const redis = getRedisClient();
    if (!redis) return;

    while (true) {
      const item = await redis.rpop(QUEUE_KEY);
      if (!item) break;

      try {
        const job = JSON.parse(item) as SmsDispatchJob;
        await processSingleDispatch(job);
      } catch (err) {
        console.error('[SMS_WORKER_ITEM_ERROR]', err);
      }
    }
  } catch (err) {
    console.error('[SMS_WORKER_DRAIN_ERROR]', err);
  } finally {
    isWorkerRunning = false;
  }
}

/**
 * Checks lightweight delivery status for a phone (Option 2 pick).
 */
export async function getSmsDeliveryStatus(phone: string): Promise<'queued' | 'sent' | 'failed' | null> {
  const phoneHash = getPhoneHash(phone);
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const status = await redis.get(`sms:status:${phoneHash}`);
    return status as 'queued' | 'sent' | 'failed' | null;
  } catch {
    return null;
  }
}
