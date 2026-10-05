import crypto from 'crypto';
import type { Redis } from 'ioredis';
import { getRedisClient, isRedisAvailable } from './redis';
import { smsService } from '@/lib/sms';
import { getPhoneHash } from './otp';
import { maskPhone } from '@/lib/sms/phone';

export interface SmsQueueItem {
  jobId: string;
  phoneHash: string;
  challengeId: string;
  attempts: number;
  createdAt: number;
}

export interface DecryptedSmsPayload {
  phone: string;
  code: string;
  challengeId: string;
}

const QUEUE_KEY = 'sms:dispatch:queue';
const PROCESSING_KEY = 'sms:dispatch:processing';
const DEADLETTER_KEY = 'sms:dispatch:deadletter';
const PAYLOAD_PREFIX = 'sms:payload:';
const DEDUPE_PREFIX = 'sms:dedupe:';
const STATUS_PREFIX = 'sms:status:';

// In-memory test OTP capture store (STRICTLY for test mode when NODE_ENV !== 'production' and TEST_OTP_CAPTURE === 'true')
const testCapturedOtps = new Map<string, string>();

// Optional mock transport for automated unit/integration tests
type MockTransportFn = (job: { phone: string; code: string }) => Promise<{ success: boolean; error?: string }>;
let mockTransport: MockTransportFn | null = null;

/**
 * Returns a 32-byte key for AES-256-GCM payload encryption.
 * Must be configured via process.env.SMS_ENCRYPTION_KEY at runtime.
 * Strict fail-closed: accepts ONLY 64 hex characters (matching 32 random bytes from `openssl rand -hex 32`).
 * Rejects everything else in all environments (no raw UTF-8, no fallback to pepper, no dev constants).
 */
export function getSmsPayloadKey(): Buffer {
  const envKey = process.env.SMS_ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error('FAIL_CLOSED: SMS_ENCRYPTION_KEY environment variable is required and must be configured');
  }

  // Exactly 64 hex characters represents 32 random bytes (e.g. from openssl rand -hex 32)
  if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
    throw new Error('FAIL_CLOSED: SMS_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes hex)');
  }

  return Buffer.from(envKey, 'hex');
}


/**
 * Encrypts SMS payload with AES-256-GCM (12-byte random IV, 16-byte auth tag).
 */
export function encryptPayload(payload: DecryptedSmsPayload): string {
  const key = getSmsPayloadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const jsonStr = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts AES-256-GCM payload.
 */
export function decryptPayload(ciphertext: string): DecryptedSmsPayload {
  const key = getSmsPayloadKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const encryptedData = Buffer.from(dataHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as DecryptedSmsPayload;
}

/**
 * Enqueues an SMS dispatch job.
 * Metadata only stored in queue; sensitive payload encrypted in short-TTL key.
 * Fail-closed: throws if Redis is unavailable.
 */
export async function enqueueSmsDispatch(job: {
  phone: string;
  code: string;
  challengeId: string;
}): Promise<string> {
  const redis = getRedisClient();
  const redisHealthy = await isRedisAvailable();

  if (!redisHealthy || !redis) {
    throw new Error('FAIL_CLOSED: Redis queue unavailable');
  }

  const jobId = crypto.randomUUID();
  const phoneHash = getPhoneHash(job.phone);

  const queueItem: SmsQueueItem = {
    jobId,
    phoneHash,
    challengeId: job.challengeId,
    attempts: 1,
    createdAt: Date.now(),
  };

  const encrypted = encryptPayload({
    phone: job.phone,
    code: job.code,
    challengeId: job.challengeId,
  });

  // Store encrypted payload with 180s TTL
  await redis.set(`${PAYLOAD_PREFIX}${jobId}`, encrypted, 'EX', 180);

  // Push metadata to queue
  await redis.lpush(QUEUE_KEY, JSON.stringify(queueItem));

  // Set initial status
  await redis.set(`${STATUS_PREFIX}${phoneHash}`, 'queued', 'EX', 120);

  return jobId;
}

/**
 * Standalone worker item processor.
 * Atomically moves next item from QUEUE to PROCESSING (via LMOVE or BLMOVE).
 * Checks dedupe key, decrypts payload, sends via transport, updates dedupe AFTER send, and ACKs.
 */
export async function processNextJob(
  timeoutSeconds = 0,
  customRedis?: Redis
): Promise<boolean> {
  const redis = customRedis || getRedisClient();
  if (!redis) return false;

  let itemStr: string | null = null;
  try {
    if (timeoutSeconds > 0) {
      itemStr = await redis.blmove(QUEUE_KEY, PROCESSING_KEY, 'RIGHT', 'LEFT', timeoutSeconds);
    } else {
      itemStr = await redis.lmove(QUEUE_KEY, PROCESSING_KEY, 'RIGHT', 'LEFT');
    }
  } catch (err) {
    console.error('[SMS_QUEUE_LMOVE_ERROR]', err);
    return false;
  }

  if (!itemStr) return false;

  let item: SmsQueueItem;
  try {
    item = JSON.parse(itemStr) as SmsQueueItem;
  } catch (parseErr) {
    console.error('[SMS_QUEUE_INVALID_JSON] Discarding corrupt item');
    await redis.lrem(PROCESSING_KEY, 1, itemStr);
    return false;
  }

  // 1. Dedupe check: has this challengeId already been successfully sent?
  try {
    const dedupeExists = await redis.exists(`${DEDUPE_PREFIX}${item.challengeId}`);
    if (dedupeExists === 1) {
      // Already sent! Ack and drop without duplicate gateway call.
      console.log(`[SMS_DEDUPE_SKIPPED] Challenge ${item.challengeId} was already dispatched`);
      await redis.lrem(PROCESSING_KEY, 1, itemStr);
      await redis.del(`${PAYLOAD_PREFIX}${item.jobId}`);
      await redis.set(`${STATUS_PREFIX}${item.phoneHash}`, 'sent', 'EX', 120);
      return true;
    }
  } catch (dedupeErr) {
    console.error('[SMS_DEDUPE_CHECK_ERROR]', dedupeErr);
  }

  // 2. Fetch and decrypt payload
  let payloadStr: string | null = null;
  try {
    payloadStr = await redis.get(`${PAYLOAD_PREFIX}${item.jobId}`);
  } catch (readErr) {
    console.error('[SMS_PAYLOAD_READ_ERROR]', readErr);
  }

  if (!payloadStr) {
    console.warn(`[SMS_PAYLOAD_MISSING] Payload expired or missing for job ${item.jobId}`);
    await redis.lrem(PROCESSING_KEY, 1, itemStr);
    return false;
  }

  let payload: DecryptedSmsPayload;
  try {
    payload = decryptPayload(payloadStr);
  } catch (decryptErr) {
    console.error('[SMS_PAYLOAD_DECRYPT_ERROR]', decryptErr);
    await redis.lrem(PROCESSING_KEY, 1, itemStr);
    await redis.del(`${PAYLOAD_PREFIX}${item.jobId}`);
    return false;
  }

  // 3. Dispatch to gateway or mock transport
  let sendSuccess = false;
  let sendError: string | undefined;

  try {
    if (mockTransport) {
      const mockRes = await mockTransport({ phone: payload.phone, code: payload.code });
      sendSuccess = mockRes.success;
      sendError = mockRes.error;
    } else {
      const realRes = await smsService.sendOtp({ phone: payload.phone, code: payload.code });
      sendSuccess = realRes.success;
      sendError = realRes.error;
    }
  } catch (dispatchErr: any) {
    sendSuccess = false;
    sendError = dispatchErr?.message || 'Transport dispatch exception';
  }

  // TEST-ONLY OTP HOOK: If test capture enabled in non-production, record code for local test assertions
  if (process.env.NODE_ENV !== 'production' && process.env.TEST_OTP_CAPTURE === 'true') {
    testCapturedOtps.set(payload.challengeId, payload.code);
  }

  // 4. Handle result
  if (sendSuccess) {
    // Condition 3.b: Write dedupe key AFTER the gateway call returns success
    try {
      await redis.set(`${DEDUPE_PREFIX}${item.challengeId}`, '1', 'EX', 300);
      // ACK: remove from processing list
      await redis.lrem(PROCESSING_KEY, 1, itemStr);
      // Delete payload key on ACK
      await redis.del(`${PAYLOAD_PREFIX}${item.jobId}`);
      // Update delivery status
      await redis.set(`${STATUS_PREFIX}${item.phoneHash}`, 'sent', 'EX', 120);
      await redis.incr('sms:stat:sent');
    } catch (ackErr) {
      console.error('[SMS_ACK_ERROR]', ackErr);
    }

    console.log(`[SMS_DISPATCHED] Successfully sent SMS for ${maskPhone(payload.phone)}`);
    return true;
  }

  // On Failure:
  console.warn(`[SMS_DISPATCH_FAILED] Attempt ${item.attempts} failed for ${maskPhone(payload.phone)}: ${sendError}`);
  item.attempts += 1;

  if (item.attempts <= 3) {
    // Re-queue with incremented attempts
    try {
      await redis.lrem(PROCESSING_KEY, 1, itemStr);
      await redis.lpush(QUEUE_KEY, JSON.stringify(item));
      await redis.incr('sms:stat:retried');
    } catch (requeueErr) {
      console.error('[SMS_REQUEUE_ERROR]', requeueErr);
    }
  } else {
    // Exceeded max attempts: move to deadletter
    try {
      await redis.lrem(PROCESSING_KEY, 1, itemStr);
      await redis.lpush(DEADLETTER_KEY, JSON.stringify(item));
      // Delete payload on dead-lettering
      await redis.del(`${PAYLOAD_PREFIX}${item.jobId}`);
      // Mark status failed
      await redis.set(`${STATUS_PREFIX}${item.phoneHash}`, 'failed', 'EX', 120);
      // Evict cooldown key so user can re-request without waiting
      await redis.del(`sms:phone:${item.phoneHash}:cooldown`);
      await redis.incr('sms:stat:deadletter');
    } catch (dlErr) {
      console.error('[SMS_DEADLETTER_ERROR]', dlErr);
    }
    console.error(`[SMS_DEADLETTERED] Job ${item.jobId} moved to deadletter after 3 attempts`);
  }

  return false;
}

/**
 * Reaper daemon that recovers stuck/abandoned jobs from PROCESSING list.
 * Any job older than visibilityTimeoutMs (default 45s) is re-queued or dead-lettered.
 */
export async function reapStaleProcessingJobs(
  visibilityTimeoutMs = 45000,
  customRedis?: Redis
): Promise<number> {
  const redis = customRedis || getRedisClient();
  if (!redis) return 0;

  let items: string[] = [];
  try {
    items = await redis.lrange(PROCESSING_KEY, 0, -1);
  } catch (err) {
    console.error('[SMS_REAPER_LRANGE_ERROR]', err);
    return 0;
  }

  if (!items || items.length === 0) return 0;

  const now = Date.now();
  let reapedCount = 0;

  for (const itemStr of items) {
    try {
      const item = JSON.parse(itemStr) as SmsQueueItem;
      const age = now - item.createdAt;

      if (age > visibilityTimeoutMs) {
        reapedCount++;
        if (item.attempts < 3) {
          item.attempts += 1;
          await redis.lrem(PROCESSING_KEY, 1, itemStr);
          await redis.lpush(QUEUE_KEY, JSON.stringify(item));
          await redis.incr('sms:stat:reaped');
          console.warn(`[SMS_REAPER_REQUEUED] Re-queued orphaned job ${item.jobId} (age: ${age}ms)`);
        } else {
          await redis.lrem(PROCESSING_KEY, 1, itemStr);
          await redis.lpush(DEADLETTER_KEY, JSON.stringify(item));
          await redis.del(`${PAYLOAD_PREFIX}${item.jobId}`);
          await redis.del(`sms:phone:${item.phoneHash}:cooldown`);
          await redis.incr('sms:stat:deadletter');
          console.error(`[SMS_REAPER_DEADLETTERED] Job ${item.jobId} exceeded max attempts`);
        }
      }
    } catch (parseErr) {
      await redis.lrem(PROCESSING_KEY, 1, itemStr);
    }
  }

  return reapedCount;
}

/**
 * Checks lightweight delivery status for a phone (Option 2 pick).
 */
export async function getSmsDeliveryStatus(phone: string): Promise<'queued' | 'sent' | 'failed' | null> {
  const phoneHash = getPhoneHash(phone);
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const status = await redis.get(`${STATUS_PREFIX}${phoneHash}`);
    return status as 'queued' | 'sent' | 'failed' | null;
  } catch {
    return null;
  }
}

/**
 * Sets a mock SMS transport for testing.
 * Hard-disabled when NODE_ENV === 'production'.
 */
export function setMockSmsTransport(transport: MockTransportFn | null): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Mock SMS transport injection is strictly forbidden in production');
  }
  mockTransport = transport;
}

/**
 * Retrieves an OTP captured during testing without brute-force hash-cracking.
 * Hard-disabled when NODE_ENV === 'production'.
 */
export function getCapturedTestOtp(challengeId: string): string | null {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: TEST-ONLY OTP capture hook is strictly forbidden in production');
  }
  if (process.env.TEST_OTP_CAPTURE !== 'true') {
    return null;
  }
  return testCapturedOtps.get(challengeId) || null;
}

/**
 * Clears captured test OTPs.
 */
export function clearCapturedTestOtps(): void {
  testCapturedOtps.clear();
}
