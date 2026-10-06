import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getRedisClient, isRedisAvailable } from './redis';

function getOtpPepper(): string {
  const pepper = process.env.OTP_PEPPER;
  if (!pepper || pepper.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: OTP_PEPPER is missing or insecure in production environment');
    }
    return 'insecure_dev_pepper_do_not_use_in_prod_0123456789abcdef';
  }
  return pepper;
}

const LOCKOUT_MAX_ATTEMPTS = parseInt(process.env.OTP_LOCKOUT_MAX_ATTEMPTS || '10', 10);
const LOCKOUT_DURATION_SECONDS = parseInt(process.env.OTP_LOCKOUT_DURATION_SECONDS || '1800', 10); // 30 minutes
const WINDOW_DURATION_MS = 60 * 60 * 1000; // 1 hour

// In-memory counter fallback for local development only
const devFailCounters = new Map<string, { count: number; lockedUntil?: number }>();

type OtpFailureCounterStore = {
  otpFailureCounter: {
    findUnique(args: { where: { phoneHash: string } }): Promise<{
      phoneHash: string;
      windowStart: Date;
      failCount: number;
      lockedUntil: Date | null;
    } | null>;
    upsert(args: {
      where: { phoneHash: string };
      create: { phoneHash: string; windowStart: Date; failCount: number };
      update: { windowStart: Date; failCount: number; lockedUntil: Date | null };
    }): Promise<unknown>;
    update(args: {
      where: { phoneHash: string };
      data: { failCount: number; lockedUntil: Date | null };
    }): Promise<unknown>;
    delete(args: { where: { phoneHash: string } }): Promise<unknown>;
  };
};

const counterPrisma = prisma as unknown as OtpFailureCounterStore;

export function getPhoneHash(phone: string): string {
  return crypto
    .createHmac('sha256', getOtpPepper())
    .update(`phone_identity:${phone}`)
    .digest('hex');
}

/**
 * Computes HMAC-SHA256 digest of (phone || challengeId || code).
 */
export function computeOtpHash(phone: string, challengeId: string, code: string): string {
  const pepper = getOtpPepper();

  return crypto
    .createHmac('sha256', pepper)
    .update(`${phone}:${challengeId}:${code}`)
    .digest('hex');
}

/**
 * Timing-safe comparison of provided OTP digest vs stored digest.
 */
export function verifyOtpTimingSafe(providedHash: string, storedHash: string): boolean {
  if (!providedHash || !storedHash) return false;
  const bufA = Buffer.from(providedHash);
  const bufB = Buffer.from(storedHash);

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Checks if a phone number is locked out due to >= 10 failed attempts across challenges.
 * Fail-closed (A1 b): throws Error if counter stores are unreachable or timeout > 250ms.
 */
export async function checkOtpLockout(phone: string): Promise<{ locked: boolean; remainingSeconds?: number }> {
  const phoneHash = getPhoneHash(phone);
  const redis = getRedisClient();
  const redisHealthy = await isRedisAvailable();

  // In production, Redis availability is mandatory for fail-closed security
  if (process.env.NODE_ENV === 'production' && !redisHealthy) {
    throw new Error('FAIL_CLOSED: Counter store unreachable or timed out during verify check');
  }

  let redisCount = 0;
  let redisTtl = 0;

  if (redisHealthy && redis) {
    try {
      const readPromise = (async () => {
        const key = `otp:fail:${phoneHash}`;
        const [val, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
        return { val, ttl };
      })();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis read timeout > 250ms')), 250)
      );

      const res = await Promise.race([readPromise, timeoutPromise]);
      redisCount = res.val ? parseInt(res.val, 10) : 0;
      redisTtl = res.ttl > 0 ? res.ttl : 0;
    } catch {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('FAIL_CLOSED: Failed to read Redis lockout counter');
      }
    }
  }

  // Check PostgreSQL durable backstop (A1 c)
  let postgresCount = 0;
  let postgresLockedUntil: Date | null = null;

  try {
    const dbPromise = counterPrisma.otpFailureCounter.findUnique({
      where: { phoneHash },
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DB read timeout > 250ms')), 250)
    );
    const dbRecord = await Promise.race([dbPromise, timeoutPromise]);

    if (dbRecord) {
      // Check if within window
      if (Date.now() - dbRecord.windowStart.getTime() < WINDOW_DURATION_MS) {
        postgresCount = dbRecord.failCount;
      }
      postgresLockedUntil = dbRecord.lockedUntil;
    }
  } catch {
    // If PostgreSQL fails in production, fail closed
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FAIL_CLOSED: Failed to read PostgreSQL lockout backstop');
    }
  }

  // Development in-memory check if both down in dev
  if (!redisHealthy && process.env.NODE_ENV !== 'production') {
    const devEntry = devFailCounters.get(phoneHash);
    if (devEntry) {
      if (devEntry.lockedUntil && devEntry.lockedUntil > Date.now()) {
        const left = Math.ceil((devEntry.lockedUntil - Date.now()) / 1000);
        return { locked: true, remainingSeconds: left };
      }
      if (devEntry.count >= LOCKOUT_MAX_ATTEMPTS) {
        return { locked: true, remainingSeconds: LOCKOUT_DURATION_SECONDS };
      }
    }
  }

  // Check active lock in PostgreSQL
  if (postgresLockedUntil && postgresLockedUntil.getTime() > Date.now()) {
    const remaining = Math.ceil((postgresLockedUntil.getTime() - Date.now()) / 1000);
    return { locked: true, remainingSeconds: remaining };
  }

  // Effective count = MAX(redis, postgres) within window
  const effectiveCount = Math.max(redisCount, postgresCount);

  if (effectiveCount >= LOCKOUT_MAX_ATTEMPTS) {
    const remaining = redisTtl > 0 ? redisTtl : LOCKOUT_DURATION_SECONDS;
    return { locked: true, remainingSeconds: remaining };
  }

  return { locked: false };
}

/**
 * Records a failed verification attempt in both Redis and PostgreSQL.
 * Fail-closed (A1 b): throws Error if the increment write fails.
 */
export async function recordOtpFailure(phone: string): Promise<void> {
  const phoneHash = getPhoneHash(phone);
  const redis = getRedisClient();
  const redisHealthy = await isRedisAvailable();

  if (process.env.NODE_ENV === 'production' && !redisHealthy) {
    throw new Error('FAIL_CLOSED: Cannot record failure increment, Redis store unreachable');
  }

  let redisSuccess = false;
  if (redisHealthy && redis) {
    try {
      const key = `otp:fail:${phoneHash}`;
      const newCount = await redis.incr(key);
      if (newCount === 1) {
        await redis.expire(key, 3600); // 1 hour window
      }
      if (newCount >= LOCKOUT_MAX_ATTEMPTS) {
        await redis.expire(key, LOCKOUT_DURATION_SECONDS); // 30 min lock
      }
      redisSuccess = true;
    } catch {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('FAIL_CLOSED: Failed to write Redis failure increment');
      }
    }
  }

  // Record in PostgreSQL backstop (A1 c)
  let postgresSuccess = false;
  try {
    const now = new Date();
    const existing = await counterPrisma.otpFailureCounter.findUnique({
      where: { phoneHash },
    });

    if (!existing || now.getTime() - existing.windowStart.getTime() > WINDOW_DURATION_MS) {
      await counterPrisma.otpFailureCounter.upsert({
        where: { phoneHash },
        create: {
          phoneHash,
          windowStart: now,
          failCount: 1,
        },
        update: {
          windowStart: now,
          failCount: 1,
          lockedUntil: null,
        },
      });
    } else {
      const nextCount = existing.failCount + 1;
      const lockedUntil =
        nextCount >= LOCKOUT_MAX_ATTEMPTS
          ? new Date(now.getTime() + LOCKOUT_DURATION_SECONDS * 1000)
          : null;

      await counterPrisma.otpFailureCounter.update({
        where: { phoneHash },
        data: {
          failCount: nextCount,
          lockedUntil,
        },
      });
    }
    postgresSuccess = true;
  } catch {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FAIL_CLOSED: Failed to write PostgreSQL failure increment');
    }
  }

  // Dev fallback tracking
  if (process.env.NODE_ENV !== 'production' && !redisSuccess && !postgresSuccess) {
    const cur = devFailCounters.get(phoneHash) || { count: 0 };
    cur.count += 1;
    if (cur.count >= LOCKOUT_MAX_ATTEMPTS) {
      cur.lockedUntil = Date.now() + LOCKOUT_DURATION_SECONDS * 1000;
    }
    devFailCounters.set(phoneHash, cur);
  }
}

/**
 * Clears failed attempt counters upon successful verification.
 */
export async function clearOtpFailure(phone: string): Promise<void> {
  const phoneHash = getPhoneHash(phone);
  const redis = getRedisClient();

  if (redis) {
    try {
      await redis.del(`otp:fail:${phoneHash}`);
    } catch {
      // Non-critical cleanup
    }
  }

  try {
    await counterPrisma.otpFailureCounter.delete({
      where: { phoneHash },
    }).catch(() => {});
  } catch {
    // Non-critical cleanup
  }

  devFailCounters.delete(phoneHash);
}
