import crypto from 'crypto';
import { getRedisClient, isRedisAvailable } from './redis';

export interface RateLimitCheckResult {
  allowed: boolean;
  statusCode?: number;
  userMessage?: string;
  reason?: string;
  cooldownSeconds?: number;
}

// In-memory fallback for local development only
interface MemoryEntry {
  count: number;
  resetAt: number;
}
const memoryStore = new Map<string, MemoryEntry>();

function getMemoryCount(key: string, ttlSeconds: number): number {
  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || entry.resetAt <= now) {
    return 0;
  }
  return entry.count;
}

function incrementMemoryCount(key: string, ttlSeconds: number): number {
  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || entry.resetAt <= now) {
    const newEntry = { count: 1, resetAt: now + ttlSeconds * 1000 };
    memoryStore.set(key, newEntry);
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

function setMemoryCooldown(key: string, seconds: number) {
  memoryStore.set(key, { count: 1, resetAt: Date.now() + seconds * 1000 });
}

function getMemoryCooldownRemaining(key: string): number {
  const entry = memoryStore.get(key);
  if (!entry) return 0;
  const remaining = Math.ceil((entry.resetAt - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

/**
 * Checks all SMS rate limits atomically.
 */
export async function checkSmsRateLimits(params: {
  phone: string;
  clientIp: string;
}): Promise<RateLimitCheckResult> {
  // 1. Check Global Kill Switch
  if (process.env.SMS_KILL_SWITCH === 'true') {
    return {
      allowed: false,
      statusCode: 503,
      userMessage: 'سرویس ارسال پیامک موقتاً جهت بهینه‌سازی در دسترس نیست. لطفاً دقایقی دیگر مراجعه فرمایید.',
      reason: 'KILL_SWITCH_ACTIVE',
    };
  }

  // Load configured thresholds
  const globalDailyCap = parseInt(process.env.SMS_GLOBAL_DAILY_CAP || '300', 10);
  const globalHourlyCap = parseInt(process.env.SMS_GLOBAL_HOURLY_CAP || '60', 10);
  const ipHourlyCap = parseInt(process.env.SMS_IP_HOURLY_CAP || '20', 10);
  const phoneHourlyCap = parseInt(process.env.SMS_PHONE_HOURLY_CAP || '3', 10);
  const phoneDailyCap = parseInt(process.env.SMS_PHONE_DAILY_CAP || '10', 10);

  // Hash phone and IP for key anonymity
  const phoneHash = crypto.createHash('sha256').update(params.phone).digest('hex').substring(0, 16);
  const ipHash = crypto.createHash('sha256').update(params.clientIp).digest('hex').substring(0, 16);

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const hourStr = dateStr + now.getUTCHours().toString().padStart(2, '0'); // YYYYMMDDHH

  const globalDayKey = `sms:global:day:${dateStr}`;
  const globalHourKey = `sms:global:hour:${hourStr}`;
  const phoneCooldownKey = `sms:phone:${phoneHash}:cooldown`;
  const phoneHourKey = `sms:phone:${phoneHash}:hour:${hourStr}`;
  const phoneDayKey = `sms:phone:${phoneHash}:day:${dateStr}`;
  const ipHourKey = `sms:ip:${ipHash}:hour:${hourStr}`;

  const redis = getRedisClient();
  const redisHealthy = await isRedisAvailable();

  // Fail-closed in production if Redis is unreachable
  if (!redisHealthy) {
    if (process.env.NODE_ENV === 'production') {
      return {
        allowed: false,
        statusCode: 503,
        userMessage: 'سرویس ارسال پیامک موقتاً جهت بهینه‌سازی در دسترس نیست. لطفاً دقایقی دیگر مراجعه فرمایید.',
        reason: 'REDIS_UNAVAILABLE_FAIL_CLOSED',
      };
    }

    // In development only: fall back to in-memory store
    const cooldownLeft = getMemoryCooldownRemaining(phoneCooldownKey);
    if (cooldownLeft > 0) {
      return {
        allowed: false,
        statusCode: 429,
        userMessage: `کد تایید به تازگی ارسال شده است. لطفاً ${cooldownLeft} ثانیه دیگر دوباره امتحان کنید.`,
        reason: 'COOLDOWN_ACTIVE',
        cooldownSeconds: cooldownLeft,
      };
    }

    const curPhoneHour = getMemoryCount(phoneHourKey, 3600);
    if (curPhoneHour >= phoneHourlyCap) {
      return {
        allowed: false,
        statusCode: 429,
        userMessage: 'تعداد درخواست‌های پیامک برای این شماره بیش از حد مجاز است. لطفاً ساعاتی دیگر تلاش کنید.',
        reason: 'PHONE_HOURLY_CAP_EXCEEDED',
      };
    }

    const curPhoneDay = getMemoryCount(phoneDayKey, 86400);
    if (curPhoneDay >= phoneDailyCap) {
      return {
        allowed: false,
        statusCode: 429,
        userMessage: 'تعداد درخواست‌های پیامک برای این شماره بیش از حد مجاز روزانه است. لطفاً فردا تلاش فرمایید.',
        reason: 'PHONE_DAILY_CAP_EXCEEDED',
      };
    }

    const curIpHour = getMemoryCount(ipHourKey, 3600);
    if (curIpHour >= ipHourlyCap) {
      return {
        allowed: false,
        statusCode: 429,
        userMessage: 'تعداد درخواست‌های پیامک از این شبکه بیش از حد مجاز است. لطفاً ساعاتی دیگر تلاش کنید.',
        reason: 'IP_HOURLY_CAP_EXCEEDED',
      };
    }

    const curGlobalHour = getMemoryCount(globalHourKey, 3600);
    if (curGlobalHour >= globalHourlyCap) {
      return {
        allowed: false,
        statusCode: 429,
        userMessage: 'سرویس پیامک موقتاً با ترافیک بالا مواجه است. لطفاً دقایقی دیگر مراجعه فرمایید.',
        reason: 'GLOBAL_HOURLY_CAP_EXCEEDED',
      };
    }

    const curGlobalDay = getMemoryCount(globalDayKey, 86400);
    if (curGlobalDay >= globalDailyCap) {
      return {
        allowed: false,
        statusCode: 429,
        userMessage: 'ظرفیت ارسال روزانه پیامک به پایان رسیده است. لطفاً فردا تلاش فرمایید.',
        reason: 'GLOBAL_DAILY_CAP_EXCEEDED',
      };
    }

    // Determine cooldown ladder: 60s (1st), 120s (2nd), 300s (3rd+)
    const nextLadderSec = curPhoneHour === 0 ? 60 : curPhoneHour === 1 ? 120 : 300;
    setMemoryCooldown(phoneCooldownKey, nextLadderSec);
    incrementMemoryCount(phoneHourKey, 3600);
    incrementMemoryCount(phoneDayKey, 86400);
    incrementMemoryCount(ipHourKey, 3600);
    incrementMemoryCount(globalHourKey, 3600);
    incrementMemoryCount(globalDayKey, 86400);

    return { allowed: true, cooldownSeconds: nextLadderSec };
  }

  // --- Redis Lua Script for Atomic Rate Limiting ---
  const luaScript = `
    local phoneCooldownKey = KEYS[1]
    local phoneHourKey     = KEYS[2]
    local phoneDayKey      = KEYS[3]
    local ipHourKey        = KEYS[4]
    local globalHourKey    = KEYS[5]
    local globalDayKey     = KEYS[6]

    local globalDailyCap  = tonumber(ARGV[1])
    local globalHourlyCap = tonumber(ARGV[2])
    local ipHourlyCap     = tonumber(ARGV[3])
    local phoneHourlyCap  = tonumber(ARGV[4])
    local phoneDailyCap   = tonumber(ARGV[5])

    -- 1. Check Cooldown
    local ttl = redis.call('TTL', phoneCooldownKey)
    if ttl > 0 then
      return {0, 'COOLDOWN_ACTIVE', ttl}
    end

    -- 2. Check Global Daily Cap
    local gDay = tonumber(redis.call('GET', globalDayKey) or '0')
    if gDay >= globalDailyCap then
      return {0, 'GLOBAL_DAILY_CAP_EXCEEDED', 0}
    end

    -- 3. Check Global Hourly Cap
    local gHour = tonumber(redis.call('GET', globalHourKey) or '0')
    if gHour >= globalHourlyCap then
      return {0, 'GLOBAL_HOURLY_CAP_EXCEEDED', 0}
    end

    -- 4. Check Phone Daily Cap
    local pDay = tonumber(redis.call('GET', phoneDayKey) or '0')
    if pDay >= phoneDailyCap then
      return {0, 'PHONE_DAILY_CAP_EXCEEDED', 0}
    end

    -- 5. Check Phone Hourly Cap
    local pHour = tonumber(redis.call('GET', phoneHourKey) or '0')
    if pHour >= phoneHourlyCap then
      return {0, 'PHONE_HOURLY_CAP_EXCEEDED', 0}
    end

    -- 6. Check IP Hourly Cap
    local ipHour = tonumber(redis.call('GET', ipHourKey) or '0')
    if ipHour >= ipHourlyCap then
      return {0, 'IP_HOURLY_CAP_EXCEEDED', 0}
    end

    -- Ladder progression: 60s (1st), 120s (2nd), 300s (3rd+)
    local cooldown = 60
    if pHour == 1 then
      cooldown = 120
    elseif pHour >= 2 then
      cooldown = 300
    end

    -- Apply increments atomically
    redis.call('SET', phoneCooldownKey, '1', 'EX', cooldown)
    
    redis.call('INCR', phoneHourKey)
    redis.call('EXPIRE', phoneHourKey, 3600)

    redis.call('INCR', phoneDayKey)
    redis.call('EXPIRE', phoneDayKey, 86400)

    redis.call('INCR', ipHourKey)
    redis.call('EXPIRE', ipHourKey, 3600)

    redis.call('INCR', globalHourKey)
    redis.call('EXPIRE', globalHourKey, 3600)

    redis.call('INCR', globalDayKey)
    redis.call('EXPIRE', globalDayKey, 86400)

    return {1, 'ALLOWED', cooldown}
  `;

  try {
    const result = (await redis!.eval(
      luaScript,
      6,
      phoneCooldownKey,
      phoneHourKey,
      phoneDayKey,
      ipHourKey,
      globalHourKey,
      globalDayKey,
      globalDailyCap,
      globalHourlyCap,
      ipHourlyCap,
      phoneHourlyCap,
      phoneDailyCap
    )) as [number, string, number];

    const [allowedFlag, reason, cooldownRemaining] = result;

    if (allowedFlag === 1) {
      return { allowed: true, cooldownSeconds: cooldownRemaining };
    }

    if (reason === 'COOLDOWN_ACTIVE') {
      return {
        allowed: false,
        statusCode: 429,
        userMessage: `کد تایید به تازگی ارسال شده است. لطفاً ${cooldownRemaining} ثانیه دیگر دوباره امتحان کنید.`,
        reason,
        cooldownSeconds: cooldownRemaining,
      };
    }

    if (reason === 'PHONE_HOURLY_CAP_EXCEEDED') {
      return {
        allowed: false,
        statusCode: 429,
        userMessage: 'تعداد درخواست‌های پیامک برای این شماره بیش از حد مجاز است. لطفاً ساعاتی دیگر تلاش کنید.',
        reason,
      };
    }

    if (reason === 'PHONE_DAILY_CAP_EXCEEDED') {
      return {
        allowed: false,
        statusCode: 429,
        userMessage: 'تعداد درخواست‌های پیامک برای این شماره بیش از حد مجاز روزانه است. لطفاً فردا تلاش فرمایید.',
        reason,
      };
    }

    if (reason === 'IP_HOURLY_CAP_EXCEEDED') {
      return {
        allowed: false,
        statusCode: 429,
        userMessage: 'تعداد درخواست‌های پیامک از این شبکه بیش از حد مجاز است. لطفاً ساعاتی دیگر تلاش کنید.',
        reason,
      };
    }

    return {
      allowed: false,
      statusCode: 429,
      userMessage: 'سرویس پیامک موقتاً با ترافیک بالا مواجه است. لطفاً دقایقی دیگر مراجعه فرمایید.',
      reason,
    };
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      return {
        allowed: false,
        statusCode: 503,
        userMessage: 'سرویس ارسال پیامک موقتاً جهت بهینه‌سازی در دسترس نیست. لطفاً دقایقی دیگر مراجعه فرمایید.',
        reason: 'REDIS_EVAL_ERROR_FAIL_CLOSED',
      };
    }
    return { allowed: true, cooldownSeconds: 60 };
  }
}

/**
 * Per-userId rate limiter for /api/waitlist/status:
 * 60 requests per minute per userId.
 * Fail closed: if Redis is unavailable or times out, returns status 503.
 */
export async function checkStatusRateLimit(userId: string): Promise<{
  allowed: boolean;
  status?: number;
  error?: string;
}> {
  const redis = getRedisClient();
  if (!redis) {
    return {
      allowed: false,
      status: 503,
      error: 'سرویس موقتاً در دسترس نیست. لطفاً دقایقی دیگر تلاش کنید.',
    };
  }

  const key = `rl:status:${userId}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 60);
    }

    if (count > 60) {
      return {
        allowed: false,
        status: 429,
        error: 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً یک دقیقه دیگر تلاش کنید.',
      };
    }

    return { allowed: true };
  } catch (err: any) {
    console.error(`[STATUS_LIMITER_FAIL_CLOSED] Redis error for user ${userId}:`, err.message);
    return {
      allowed: false,
      status: 503,
      error: 'سرویس موقتاً در دسترس نیست. لطفاً دقایقی دیگر تلاش کنید.',
    };
  }
}
