import crypto from 'crypto';
import type { Redis } from 'ioredis';
import { getRedisClient } from './redis';
import { smsService } from '@/lib/sms';
import { getPhoneHash } from './otp';

export interface SmsQueueItem {
  jobId: string;
  phoneHash: string;
  challengeId: string;
  attempts: number;
  createdAt: number;
  expiresAt?: number;
}

export interface DecryptedSmsPayload {
  phone: string;
  code: string;
  challengeId: string;
}

export interface EnqueueResult {
  status: 'ACCEPTED' | 'DUPLICATE_ACTIVE' | 'QUEUE_CAPACITY_REACHED' | 'INVALID_INPUT' | 'FAILED';
  jobId?: string;
  error?: string;
}

export interface ClaimResult {
  status: 'CLAIMED' | 'EMPTY' | 'LEASE_CONFLICT' | 'FAILED';
  jobId?: string;
  claimToken?: string;
  error?: string;
}

export interface ReservationResult {
  status: 'RESERVED' | 'EXHAUSTED' | 'OTP_EXPIRED' | 'LEASE_MISMATCH' | 'METADATA_MISSING';
  attemptNumber?: number;
  attempts?: number;
  expiresAt?: number;
}

export const QUEUE_KEY = 'sms:dispatch:queue';
export const PROCESSING_KEY = 'sms:dispatch:processing';
export const RETRY_KEY = 'sms:dispatch:retry';
export const DEADLETTER_KEY = 'sms:dispatch:deadletter';

export const LEASE_PREFIX = 'sms:lease:';
export const META_PREFIX = 'sms:meta:';
export const PAYLOAD_PREFIX = 'sms:payload:';
export const DEDUPE_PREFIX = 'sms:dedupe:';
export const STATUS_PREFIX = 'sms:status:';
export const DEDUP_TRANSFER_PREFIX = 'sms:dl:dedup:';
export const ACTIVE_MARKER_PREFIX = 'sms:job:active:';

// Capacity and Timing Constants (Frozen Baseline)
export const MAX_QUEUE_CAPACITY = 10000;
export const MAX_RETRY_CAPACITY = 5000;
export const MAX_DEADLETTER_CAPACITY = 1000;
export const MAX_CRASH_RECOVERIES = 2;

export const PAYLOAD_TTL_SECONDS = 420;
export const META_TTL_SECONDS = 450;
export const LEASE_TTL_SECONDS = 45;
export const ACTIVE_MARKER_SAFETY_TTL_SECONDS = 86400; // Explicitly deleted on ACK/Deadletter; safety net 24h

// In-memory test OTP capture store (STRICTLY for test mode when NODE_ENV !== 'production' and TEST_OTP_CAPTURE === 'true')
const testCapturedOtps = new Map<string, string>();

// Optional mock transport for automated unit/integration tests
type MockTransportFn = (job: { phone: string; code: string }) => Promise<{ success: boolean; error?: string }>;
let mockTransport: MockTransportFn | null = null;

// ============================================================================
// AES-256-GCM Encryption / Decryption Utilities
// ============================================================================

export function getSmsPayloadKey(): Buffer {
  const envKey = process.env.SMS_ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error('FAIL_CLOSED: SMS_ENCRYPTION_KEY environment variable is required and must be configured');
  }

  if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
    throw new Error('FAIL_CLOSED: SMS_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes hex)');
  }

  return Buffer.from(envKey, 'hex');
}

export function encryptPayload(payload: DecryptedSmsPayload): string {
  const key = getSmsPayloadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const jsonStr = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

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

// ============================================================================
// LUA SCRIPTS (Atomic Primitives)
// ============================================================================

const ENQUEUE_LUA = `
local queueKey = KEYS[1]
local metaKey = KEYS[2]
local payloadKey = KEYS[3]
local activeKey = KEYS[4]

local jobId = ARGV[1]
local phoneHash = ARGV[2]
local challengeId = ARGV[3]
local expiresAt = ARGV[4]
local createdAt = ARGV[5]
local encryptedPayload = ARGV[6]
local maxCap = tonumber(ARGV[7])
local payloadTtl = tonumber(ARGV[8])
local metaTtl = tonumber(ARGV[9])
local activeTtl = tonumber(ARGV[10])

-- 1. Deduplication check: Set active marker atomically
local activeSet = redis.call('SET', activeKey, '1', 'NX', 'EX', activeTtl)
if not activeSet then
  return cjson.encode({ status = 'DUPLICATE_ACTIVE' })
end

-- 2. Capacity check: Queue must never exceed maxCap (10,000)
local qLen = redis.call('LLEN', queueKey)
if qLen >= maxCap then
  redis.call('DEL', activeKey)
  return cjson.encode({ status = 'QUEUE_CAPACITY_REACHED' })
end

-- 3. Write Payload (guarded by pcall for OOM)
local ok_p, err_p = pcall(redis.call, 'SET', payloadKey, encryptedPayload, 'EX', payloadTtl)
if not ok_p then
  redis.call('DEL', activeKey)
  return redis.error_reply("OOM_PAYLOAD_FAILED: " .. tostring(err_p))
end

-- 4. Write Metadata (guarded by pcall for OOM)
local ok_m, err_m = pcall(redis.call, 'HSET', metaKey,
  'jobId', jobId,
  'phoneHash', phoneHash,
  'challengeId', challengeId,
  'expiresAt', expiresAt,
  'createdAt', createdAt,
  'providerAttemptsInitiated', '0',
  'providerAttemptsFailed', '0',
  'crashRecoveries', '0'
)
if not ok_m then
  redis.call('DEL', payloadKey)
  redis.call('DEL', activeKey)
  return redis.error_reply("OOM_META_FAILED: " .. tostring(err_m))
end
redis.call('EXPIRE', metaKey, metaTtl)

-- 5. Insert into Queue (guarded by pcall for OOM)
local ok_q, err_q = pcall(redis.call, 'LPUSH', queueKey, jobId)
if not ok_q then
  redis.call('DEL', metaKey)
  redis.call('DEL', payloadKey)
  redis.call('DEL', activeKey)
  return redis.error_reply("OOM_QUEUE_PUSH_FAILED: " .. tostring(err_q))
end

return cjson.encode({ status = 'ACCEPTED', jobId = jobId })
`;

const CLAIM_LUA = `
local queueKey = KEYS[1]
local processingKey = KEYS[2]
local leasePrefix = KEYS[3]

local claimToken = ARGV[1]
local leaseTtl = tonumber(ARGV[2])

-- Loop up to 50 times to handle ghost duplicates at queue tail without blocking
for step = 1, 50 do
  local jobId = redis.call('LINDEX', queueKey, -1)
  if not jobId then
    return cjson.encode({ status = 'EMPTY' })
  end

  local leaseKey = leasePrefix .. jobId
  local currentLease = redis.call('GET', leaseKey)

  if currentLease and currentLease ~= false then
    -- Candidate has an active lease. Check if active processing claim exists:
    local expectedItem = jobId .. ":" .. currentLease
    local inProc = redis.call('LPOS', processingKey, expectedItem)
    if inProc and inProc ~= false then
      -- PROVEN GHOST DUPLICATE: Job is actively processing under valid claim.
      -- Purge-and-Advance: Pop redundant duplicate from queue tail.
      -- Do NOT touch active lease, processing, meta, or payload!
      redis.call('RPOP', queueKey)
      -- Continue loop to inspect next item behind it
    else
      -- Lease exists but not in processing (inconsistent/zombie lease).
      -- Do not overwrite; abort claim for this item.
      return cjson.encode({ status = 'LEASE_CONFLICT', jobId = jobId })
    end
  else
    -- Candidate has NO active lease. Acquire lease first with NX:
    local ok_set, set_res = pcall(redis.call, 'SET', leaseKey, claimToken, 'NX', 'EX', leaseTtl)
    if not ok_set then
      return redis.error_reply("OOM_LEASE_SET_FAILED: " .. tostring(set_res))
    end

    if not set_res then
      -- Race condition: another worker grabbed lease in between; re-evaluate
      return cjson.encode({ status = 'LEASE_CONFLICT', jobId = jobId })
    end

    -- Write destination: push to processing
    local processingItem = jobId .. ":" .. claimToken
    local ok_proc, err_proc = pcall(redis.call, 'LPUSH', processingKey, processingItem)
    if not ok_proc then
      -- OOM on processing push: execute compensation (DEL never OOMs)
      redis.call('DEL', leaseKey)
      return redis.error_reply("OOM_PROCESSING_PUSH_FAILED: " .. tostring(err_proc))
    end

    -- Destination write established! Remove candidate from queue tail:
    redis.call('RPOP', queueKey)

    return cjson.encode({ status = 'CLAIMED', jobId = jobId, claimToken = claimToken })
  end
end

return cjson.encode({ status = 'EMPTY' })
`;

const REFRESH_LEASE_LUA = `
local leaseKey = KEYS[1]
local metaKey = KEYS[2]
local claimToken = ARGV[1]
local extendSeconds = tonumber(ARGV[2])

if redis.call('EXISTS', metaKey) == 0 then
  return 'METADATA_MISSING'
end

local current = redis.call('GET', leaseKey)
if not current or current ~= claimToken then
  return 'LEASE_LOST'
end

redis.call('EXPIRE', leaseKey, extendSeconds)
return 'RENEWED'
`;

const CONDITIONAL_ACK_LUA = `
local processingKey = KEYS[1]
local leaseKey = KEYS[2]
local metaKey = KEYS[3]
local payloadKey = KEYS[4]
local activeKey = KEYS[5]

local jobId = ARGV[1]
local claimToken = ARGV[2]

local currentLease = redis.call('GET', leaseKey)
if not currentLease or currentLease ~= claimToken then
  return 'LEASE_MISMATCH'
end

local processingItem = jobId .. ":" .. claimToken
local removed = redis.call('LREM', processingKey, 1, processingItem)
if removed == 0 then
  return 'NOT_IN_PROCESSING'
end

redis.call('DEL', leaseKey)
redis.call('DEL', metaKey)
redis.call('DEL', payloadKey)
redis.call('DEL', activeKey)

return 'ACKED'
`;

const DEADLETTER_TRANSFER_LUA = `
local sourceKey = KEYS[1]
local deadletterKey = KEYS[2]
local dedupKey = KEYS[3]
local leaseKey = KEYS[4]
local metaKey = KEYS[5]
local payloadKey = KEYS[6]
local activeKey = KEYS[7]

local jobId = ARGV[1]
local sourceType = ARGV[2]
local claimToken = ARGV[3]
local deadletterJson = ARGV[4]

-- 1. True Idempotency Check: Dedup Key
local alreadyPushed = redis.call('EXISTS', dedupKey)
if alreadyPushed ~= 0 then
  -- Transfer was already executed for this exact transferId.
  -- Ensure source removal and accessory cleanup are finished, then return TRANSFERRED.
  if sourceType == 'processing' then
    local item = jobId .. ":" .. claimToken
    redis.call('LREM', sourceKey, 1, item)
  elseif sourceType == 'queue' then
    redis.call('LREM', sourceKey, 1, jobId)
  elseif sourceType == 'retry' then
    redis.call('ZREM', sourceKey, jobId)
  end
  redis.call('DEL', leaseKey)
  redis.call('DEL', metaKey)
  redis.call('DEL', payloadKey)
  redis.call('DEL', activeKey)
  return 'TRANSFERRED'
end

-- 2. Lease Ownership & Safety Check (for new transfer attempts)
if sourceType == 'processing' then
  local currentLease = redis.call('GET', leaseKey)
  if not currentLease or currentLease ~= claimToken then
    return redis.error_reply("LEASE_MISMATCH")
  end
elseif sourceType == 'queue' or sourceType == 'retry' then
  local activeLease = redis.call('GET', leaseKey)
  if activeLease and activeLease ~= false then
    return redis.error_reply("ACTIVE_LEASE_EXISTS")
  end
else
  return redis.error_reply("INVALID_SOURCE_TYPE: " .. tostring(sourceType))
end

-- 3. First insertion into Deadletter (guarded by pcall for OOM)
local ok_push, err_push = pcall(redis.call, 'LPUSH', deadletterKey, deadletterJson)
if not ok_push then
  return redis.error_reply("OOM_DEADLETTER_FAILED: " .. tostring(err_push))
end
redis.call('LTRIM', deadletterKey, 0, 999)
redis.call('SET', dedupKey, 'COMPLETED', 'EX', 86400)

-- 3. Strictly Type-Safe Source Removal
if sourceType == 'processing' then
  local item = jobId .. ":" .. claimToken
  redis.call('LREM', sourceKey, 1, item)
elseif sourceType == 'queue' then
  redis.call('LREM', sourceKey, 1, jobId)
elseif sourceType == 'retry' then
  redis.call('ZREM', sourceKey, jobId)
end

-- 4. Clean up accessories
redis.call('DEL', leaseKey)
redis.call('DEL', metaKey)
redis.call('DEL', payloadKey)
redis.call('DEL', activeKey)

return 'TRANSFERRED'
`;

const RESERVE_ATTEMPT_LUA = `
local leaseKey = KEYS[1]
local metaKey = KEYS[2]
local claimToken = ARGV[1]
local nowMs = tonumber(ARGV[2])

local currentLease = redis.call('GET', leaseKey)
if not currentLease or currentLease ~= claimToken then
  return cjson.encode({ status = 'LEASE_MISMATCH' })
end

if redis.call('EXISTS', metaKey) == 0 then
  return cjson.encode({ status = 'METADATA_MISSING' })
end

local expiresAt = tonumber(redis.call('HGET', metaKey, 'expiresAt') or '0')
if expiresAt > 0 and nowMs >= expiresAt then
  return cjson.encode({ status = 'OTP_EXPIRED', expiresAt = expiresAt })
end

local initiated = tonumber(redis.call('HGET', metaKey, 'providerAttemptsInitiated') or '0')
if initiated >= 3 then
  return cjson.encode({ status = 'EXHAUSTED', attempts = initiated })
end

local newCount = redis.call('HINCRBY', metaKey, 'providerAttemptsInitiated', 1)
return cjson.encode({ status = 'RESERVED', attemptNumber = newCount })
`;

export interface ReaperSweepResult {
  reaped: number;
  requeued: number;
  divertedRetry: number;
  deadlettered: number;
  staleRemoved: number;
  activeSkipped: number;
  errors: number;
  details?: Array<{ jobId?: string; status: string; error?: string }>;
}

export interface PromotionSweepResult {
  examined: number;
  promoted: number;
  postponed: number;
  deadlettered: number;
  skipped: number;
  errors: number;
  details?: Array<{ jobId: string; status: string; error?: string }>;
}

const REAPER_LUA = `
local processingKey = KEYS[1]
local queueKey = KEYS[2]
local retryKey = KEYS[3]
local deadletterKey = KEYS[4]
local leasePrefix = KEYS[5]
local metaPrefix = KEYS[6]
local payloadPrefix = KEYS[7]
local activePrefix = KEYS[8]
local dedupPrefix = KEYS[9]

local item = ARGV[1]
local maxQueueCap = tonumber(ARGV[2])
local maxRetryCap = tonumber(ARGV[3])
local maxCrashRecoveries = tonumber(ARGV[4])
local nowMs = tonumber(ARGV[5])

-- 1. Parse jobId and claimToken
local colonIdx = string.find(item, ":")
if not colonIdx then
  redis.call('LREM', processingKey, 1, item)
  return cjson.encode({ status = 'MALFORMED_ENTRY_REMOVED' })
end

local jobId = string.sub(item, 1, colonIdx - 1)
local claimToken = string.sub(item, colonIdx + 1)

local leaseKey = leasePrefix .. jobId
local metaKey = metaPrefix .. jobId
local payloadKey = payloadPrefix .. jobId
local activeKey = activePrefix .. jobId

-- 2. Inspect Lease
local currentLease = redis.call('GET', leaseKey)

-- Case A: Lease matches claimToken -> Claim is active and healthy
if currentLease and currentLease == claimToken then
  return cjson.encode({ status = 'ACTIVE_CLAIM_SKIPPED', jobId = jobId, claimToken = claimToken })
end

-- Case B: Lease exists but has different claimToken -> Newer claim exists
if currentLease and currentLease ~= false then
  -- Only remove the obsolete processing entry; preserve newer claim's state completely
  redis.call('LREM', processingKey, 1, item)
  return cjson.encode({ status = 'STALE_ENTRY_REMOVED', jobId = jobId, oldClaimToken = claimToken })
end

-- Case C: Lease is absent / expired -> Abandoned claim recovery

-- Idempotency check 1: Resumed Deadletter transfer
local dlDedupKey = dedupPrefix .. "REAP:DL:" .. jobId .. ":" .. claimToken
if redis.call('EXISTS', dlDedupKey) ~= 0 then
  redis.call('LREM', processingKey, 1, item)
  redis.call('DEL', metaKey)
  redis.call('DEL', payloadKey)
  redis.call('DEL', activeKey)
  return cjson.encode({ status = 'DEADLETTER_RESUMED', jobId = jobId })
end

-- Idempotency check 2: Resumed Queue transfer (already in queue)
local inQueue = redis.call('LPOS', queueKey, jobId)
if inQueue and inQueue ~= false then
  redis.call('LREM', processingKey, 1, item)
  return cjson.encode({ status = 'REQUEUED_QUEUE_RESUMED', jobId = jobId })
end

-- Idempotency check 3: Resumed Retry transfer (already in retry)
local inRetry = redis.call('ZSCORE', retryKey, jobId)
if inRetry and inRetry ~= false then
  redis.call('LREM', processingKey, 1, item)
  return cjson.encode({ status = 'DIVERTED_RETRY_RESUMED', jobId = jobId })
end

-- Validation: Metadata check
if redis.call('EXISTS', metaKey) == 0 then
  local transferId = "REAP:META:" .. jobId .. ":" .. claimToken
  local dlRecord = cjson.encode({
    jobId = jobId,
    sourceType = 'processing',
    claimToken = claimToken,
    reason = 'METADATA_MISSING',
    transferId = transferId,
    timestamp = nowMs
  })
  local ok_dl, err_dl = pcall(redis.call, 'LPUSH', deadletterKey, dlRecord)
  if not ok_dl then
    return redis.error_reply("OOM_DEADLETTER_FAILED: " .. tostring(err_dl))
  end
  redis.call('LTRIM', deadletterKey, 0, 999)
  redis.call('SET', dlDedupKey, 'COMPLETED', 'EX', 86400)
  redis.call('LREM', processingKey, 1, item)
  redis.call('DEL', payloadKey)
  redis.call('DEL', activeKey)
  return cjson.encode({ status = 'DEADLETTER_METADATA_MISSING', jobId = jobId })
end

-- Validation: Payload check
if redis.call('EXISTS', payloadKey) == 0 then
  local transferId = "REAP:PAYLOAD:" .. jobId .. ":" .. claimToken
  local dlRecord = cjson.encode({
    jobId = jobId,
    sourceType = 'processing',
    claimToken = claimToken,
    reason = 'PAYLOAD_MISSING',
    transferId = transferId,
    timestamp = nowMs
  })
  local ok_dl, err_dl = pcall(redis.call, 'LPUSH', deadletterKey, dlRecord)
  if not ok_dl then
    return redis.error_reply("OOM_DEADLETTER_FAILED: " .. tostring(err_dl))
  end
  redis.call('LTRIM', deadletterKey, 0, 999)
  redis.call('SET', dlDedupKey, 'COMPLETED', 'EX', 86400)
  redis.call('LREM', processingKey, 1, item)
  redis.call('DEL', metaKey)
  redis.call('DEL', activeKey)
  return cjson.encode({ status = 'DEADLETTER_PAYLOAD_MISSING', jobId = jobId })
end

-- Validation: OTP Expiration check
local expiresAt = tonumber(redis.call('HGET', metaKey, 'expiresAt') or '0')
if expiresAt > 0 and nowMs >= expiresAt then
  local transferId = "REAP:EXPIRED:" .. jobId .. ":" .. claimToken
  local dlRecord = cjson.encode({
    jobId = jobId,
    sourceType = 'processing',
    claimToken = claimToken,
    reason = 'OTP_EXPIRED_BEFORE_RECOVERY',
    transferId = transferId,
    timestamp = nowMs,
    expiresAt = expiresAt
  })
  local ok_dl, err_dl = pcall(redis.call, 'LPUSH', deadletterKey, dlRecord)
  if not ok_dl then
    return redis.error_reply("OOM_DEADLETTER_FAILED: " .. tostring(err_dl))
  end
  redis.call('LTRIM', deadletterKey, 0, 999)
  redis.call('SET', dlDedupKey, 'COMPLETED', 'EX', 86400)
  redis.call('LREM', processingKey, 1, item)
  redis.call('DEL', metaKey)
  redis.call('DEL', payloadKey)
  redis.call('DEL', activeKey)
  return cjson.encode({ status = 'DEADLETTER_OTP_EXPIRED', jobId = jobId })
end

-- Validation: Crash Recoveries Cap (frozen maximum = 2)
local crashRecoveries = tonumber(redis.call('HGET', metaKey, 'crashRecoveries') or '0')
if (crashRecoveries + 1) >= maxCrashRecoveries then
  local transferId = "REAP:MAX_CRASH:" .. jobId .. ":" .. claimToken
  local dlRecord = cjson.encode({
    jobId = jobId,
    sourceType = 'processing',
    claimToken = claimToken,
    reason = 'MAX_CRASH_RECOVERIES_EXCEEDED',
    transferId = transferId,
    timestamp = nowMs,
    crashRecoveries = crashRecoveries + 1
  })
  local ok_dl, err_dl = pcall(redis.call, 'LPUSH', deadletterKey, dlRecord)
  if not ok_dl then
    return redis.error_reply("OOM_DEADLETTER_FAILED: " .. tostring(err_dl))
  end
  redis.call('LTRIM', deadletterKey, 0, 999)
  redis.call('SET', dlDedupKey, 'COMPLETED', 'EX', 86400)
  redis.call('LREM', processingKey, 1, item)
  redis.call('DEL', metaKey)
  redis.call('DEL', payloadKey)
  redis.call('DEL', activeKey)
  return cjson.encode({ status = 'DEADLETTER_MAX_CRASH', jobId = jobId, crashRecoveries = crashRecoveries + 1 })
end

-- Recovery Destination Selection
local qLen = redis.call('LLEN', queueKey)
if qLen < maxQueueCap then
  -- Destination 1: Requeue to Queue
  local ok_q, err_q = pcall(redis.call, 'LPUSH', queueKey, jobId)
  if not ok_q then
    return redis.error_reply("OOM_QUEUE_RECOVERY_FAILED: " .. tostring(err_q))
  end
  -- Destination write confirmed! Remove processing item and increment crashRecoveries
  redis.call('LREM', processingKey, 1, item)
  local newRecoveries = redis.call('HINCRBY', metaKey, 'crashRecoveries', 1)
  return cjson.encode({ status = 'REQUEUED_QUEUE', jobId = jobId, crashRecoveries = tonumber(newRecoveries) })
end

local zLen = redis.call('ZCARD', retryKey)
if zLen < maxRetryCap then
  -- Destination 2: Divert to Retry ZSET
  local retryScore = nowMs + 5000
  local ok_z, err_z = pcall(redis.call, 'ZADD', retryKey, retryScore, jobId)
  if not ok_z then
    return redis.error_reply("OOM_RETRY_RECOVERY_FAILED: " .. tostring(err_z))
  end
  -- Destination write confirmed! Remove processing item and increment crashRecoveries
  redis.call('LREM', processingKey, 1, item)
  local newRecoveries = redis.call('HINCRBY', metaKey, 'crashRecoveries', 1)
  return cjson.encode({ status = 'DIVERTED_RETRY', jobId = jobId, crashRecoveries = tonumber(newRecoveries), retryScore = retryScore })
end

-- Destination 3: Both Queue and Retry are full -> RETRY_CAPACITY_EXCEEDED Deadletter
local transferId = "REAP:CAP_EXCEEDED:" .. jobId .. ":" .. claimToken
local dlRecord = cjson.encode({
  jobId = jobId,
  sourceType = 'processing',
  claimToken = claimToken,
  reason = 'RETRY_CAPACITY_EXCEEDED',
  transferId = transferId,
  timestamp = nowMs
})
local ok_dl, err_dl = pcall(redis.call, 'LPUSH', deadletterKey, dlRecord)
if not ok_dl then
  return redis.error_reply("OOM_DEADLETTER_FAILED: " .. tostring(err_dl))
end
redis.call('LTRIM', deadletterKey, 0, 999)
redis.call('SET', dlDedupKey, 'COMPLETED', 'EX', 86400)
redis.call('LREM', processingKey, 1, item)
redis.call('DEL', metaKey)
redis.call('DEL', payloadKey)
redis.call('DEL', activeKey)
return cjson.encode({ status = 'DEADLETTER_CAPACITY_EXCEEDED', jobId = jobId })
`;

const PROMOTION_LUA = `
local retryKey = KEYS[1]
local queueKey = KEYS[2]
local deadletterKey = KEYS[3]
local leasePrefix = KEYS[4]
local metaPrefix = KEYS[5]
local payloadPrefix = KEYS[6]
local activePrefix = KEYS[7]
local dedupPrefix = KEYS[8]

local jobId = ARGV[1]
local maxQueueCap = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])

-- 1. Check if job is in Retry ZSET and score is due
local currentScore = redis.call('ZSCORE', retryKey, jobId)
if not currentScore then
  return cjson.encode({ status = 'NOT_IN_RETRY', jobId = jobId })
end

currentScore = tonumber(currentScore)
if currentScore > nowMs then
  return cjson.encode({ status = 'NOT_DUE', jobId = jobId, score = currentScore, nowMs = nowMs })
end

local leaseKey = leasePrefix .. jobId
local metaKey = metaPrefix .. jobId
local payloadKey = payloadPrefix .. jobId
local activeKey = activePrefix .. jobId

-- 2. Check if active lease exists (ownership protection)
local activeLease = redis.call('GET', leaseKey)
if activeLease and activeLease ~= false then
  return cjson.encode({ status = 'ACTIVE_LEASE_EXISTS', jobId = jobId, lease = activeLease })
end

-- 3. Idempotency: Already in Queue?
local alreadyInQueue = redis.call('LPOS', queueKey, jobId)
if alreadyInQueue and alreadyInQueue ~= false then
  redis.call('ZREM', retryKey, jobId)
  return cjson.encode({ status = 'PROMOTED_DUPLICATE_PURGED', jobId = jobId })
end

-- 4. Validate Metadata
if redis.call('EXISTS', metaKey) == 0 then
  local transferId = "SCHED:META:" .. jobId
  local dlRecord = cjson.encode({
    jobId = jobId,
    sourceType = 'retry',
    reason = 'METADATA_MISSING',
    transferId = transferId,
    timestamp = nowMs
  })
  local ok_dl, err_dl = pcall(redis.call, 'LPUSH', deadletterKey, dlRecord)
  if not ok_dl then
    return redis.error_reply("OOM_DEADLETTER_FAILED: " .. tostring(err_dl))
  end
  redis.call('LTRIM', deadletterKey, 0, 999)
  redis.call('ZREM', retryKey, jobId)
  redis.call('DEL', payloadKey)
  redis.call('DEL', activeKey)
  return cjson.encode({ status = 'DEADLETTER_METADATA_MISSING', jobId = jobId })
end

-- 5. Validate Payload
if redis.call('EXISTS', payloadKey) == 0 then
  local transferId = "SCHED:PAYLOAD:" .. jobId
  local dlRecord = cjson.encode({
    jobId = jobId,
    sourceType = 'retry',
    reason = 'PAYLOAD_MISSING',
    transferId = transferId,
    timestamp = nowMs
  })
  local ok_dl, err_dl = pcall(redis.call, 'LPUSH', deadletterKey, dlRecord)
  if not ok_dl then
    return redis.error_reply("OOM_DEADLETTER_FAILED: " .. tostring(err_dl))
  end
  redis.call('LTRIM', deadletterKey, 0, 999)
  redis.call('ZREM', retryKey, jobId)
  redis.call('DEL', metaKey)
  redis.call('DEL', activeKey)
  return cjson.encode({ status = 'DEADLETTER_PAYLOAD_MISSING', jobId = jobId })
end

-- 6. Validate OTP Expiration
local expiresAt = tonumber(redis.call('HGET', metaKey, 'expiresAt') or '0')
if expiresAt > 0 and nowMs >= expiresAt then
  local transferId = "SCHED:EXPIRED:" .. jobId
  local dlRecord = cjson.encode({
    jobId = jobId,
    sourceType = 'retry',
    reason = 'OTP_EXPIRED_BEFORE_SEND',
    transferId = transferId,
    timestamp = nowMs,
    expiresAt = expiresAt
  })
  local ok_dl, err_dl = pcall(redis.call, 'LPUSH', deadletterKey, dlRecord)
  if not ok_dl then
    return redis.error_reply("OOM_DEADLETTER_FAILED: " .. tostring(err_dl))
  end
  redis.call('LTRIM', deadletterKey, 0, 999)
  redis.call('ZREM', retryKey, jobId)
  redis.call('DEL', metaKey)
  redis.call('DEL', payloadKey)
  redis.call('DEL', activeKey)
  return cjson.encode({ status = 'DEADLETTER_OTP_EXPIRED', jobId = jobId })
end

-- 7. Queue Capacity Check
local qLen = redis.call('LLEN', queueKey)
if qLen >= maxQueueCap then
  -- Queue is full! Keep in Retry ZSET and postpone score to nowMs + 2000
  local nextScore = nowMs + 2000
  redis.call('ZADD', retryKey, nextScore, jobId)
  return cjson.encode({ status = 'QUEUE_FULL_POSTPONED', jobId = jobId, nextScore = nextScore })
end

-- 8. Atomic Destination Write (LPUSH queue)
local ok_q, err_q = pcall(redis.call, 'LPUSH', queueKey, jobId)
if not ok_q then
  return redis.error_reply("OOM_QUEUE_PROMOTION_FAILED: " .. tostring(err_q))
end

-- 9. Remove source from Retry ZSET (destination is established!)
redis.call('ZREM', retryKey, jobId)
return cjson.encode({ status = 'PROMOTED', jobId = jobId })
`;

// ============================================================================
// PHASE 2 ATOMIC QUEUE ENGINE API
// ============================================================================

/**
 * 1. Atomic Enqueue with Deduplication & Capacity Bound
 */
export async function atomicEnqueue(params: {
  phone: string;
  code: string;
  challengeId: string;
  jobId?: string;
  expiresAt?: number | Date;
  customRedis?: Redis;
}): Promise<EnqueueResult> {
  const redis = params.customRedis || getRedisClient();
  if (!redis) {
    throw new Error('FAIL_CLOSED: Redis client unavailable');
  }

  if (!params.phone || !params.code || !params.challengeId) {
    return { status: 'INVALID_INPUT', error: 'Missing required dispatch parameters' };
  }

  const jobId = params.jobId || crypto.randomUUID();
  const phoneHash = getPhoneHash(params.phone);
  const createdAt = Date.now();

  let expiresAtMs: number;
  if (params.expiresAt instanceof Date) {
    expiresAtMs = params.expiresAt.getTime();
  } else if (typeof params.expiresAt === 'number') {
    expiresAtMs = params.expiresAt;
  } else {
    expiresAtMs = createdAt + 300000; // 5 minutes default
  }

  let encryptedPayload: string;
  try {
    encryptedPayload = encryptPayload({
      phone: params.phone,
      code: params.code,
      challengeId: params.challengeId,
    });
  } catch (encErr: unknown) {
    return { status: 'FAILED', error: encErr instanceof Error ? encErr.message : 'Encryption failed' };
  }

  try {
    const rawRes = await redis.eval(
      ENQUEUE_LUA,
      4,
      QUEUE_KEY,
      `${META_PREFIX}${jobId}`,
      `${PAYLOAD_PREFIX}${jobId}`,
      `${ACTIVE_MARKER_PREFIX}${jobId}`,
      jobId,
      phoneHash,
      params.challengeId,
      expiresAtMs.toString(),
      createdAt.toString(),
      encryptedPayload,
      MAX_QUEUE_CAPACITY.toString(),
      PAYLOAD_TTL_SECONDS.toString(),
      META_TTL_SECONDS.toString(),
      ACTIVE_MARKER_SAFETY_TTL_SECONDS.toString()
    );

    const parsed = typeof rawRes === 'string' ? JSON.parse(rawRes) : rawRes;
    return parsed as EnqueueResult;
  } catch (err: unknown) {
    console.error('[ATOMIC_ENQUEUE_ERROR]', err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Backward-compatible enqueueSmsDispatch returning jobId string.
 * Fails closed if Redis is unavailable or enqueue is rejected.
 */
export async function enqueueSmsDispatch(job: {
  phone: string;
  code: string;
  challengeId: string;
  expiresAt?: number | Date;
  customRedis?: Redis;
}): Promise<string> {
  const result = await atomicEnqueue(job);
  if (result.status === 'ACCEPTED' && result.jobId) {
    const redis = job.customRedis || getRedisClient();
    if (redis) {
      const phoneHash = getPhoneHash(job.phone);
      await redis.set(`${STATUS_PREFIX}${phoneHash}`, 'queued', 'EX', 120);
    }
    return result.jobId;
  }

  throw new Error(`FAIL_CLOSED: SMS dispatch enqueue rejected: ${result.status} (${result.error || 'Capacity/Policy limit'})`);
}

/**
 * 2. Atomic Claim with per-claim Token & Purge-and-Advance
 */
export async function atomicClaim(customRedis?: Redis): Promise<ClaimResult> {
  const redis = customRedis || getRedisClient();
  if (!redis) {
    return { status: 'FAILED', error: 'Redis client unavailable' };
  }

  const claimToken = crypto.randomUUID();

  try {
    const rawRes = await redis.eval(
      CLAIM_LUA,
      3,
      QUEUE_KEY,
      PROCESSING_KEY,
      LEASE_PREFIX,
      claimToken,
      LEASE_TTL_SECONDS.toString()
    );

    const parsed = typeof rawRes === 'string' ? JSON.parse(rawRes) : rawRes;
    return parsed as ClaimResult;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ATOMIC_CLAIM_ERROR]', msg);
    return { status: 'FAILED', error: msg };
  }
}

/**
 * 3. Conditional Lease Refresh
 */
export async function conditionalLeaseRefresh(
  jobId: string,
  claimToken: string,
  extendSeconds = LEASE_TTL_SECONDS,
  customRedis?: Redis
): Promise<'RENEWED' | 'LEASE_LOST' | 'METADATA_MISSING' | 'FAILED'> {
  const redis = customRedis || getRedisClient();
  if (!redis) return 'FAILED';

  try {
    const res = await redis.eval(
      REFRESH_LEASE_LUA,
      2,
      `${LEASE_PREFIX}${jobId}`,
      `${META_PREFIX}${jobId}`,
      claimToken,
      extendSeconds.toString()
    );
    return res as 'RENEWED' | 'LEASE_LOST' | 'METADATA_MISSING';
  } catch (err: unknown) {
    console.error('[LEASE_REFRESH_ERROR]', err instanceof Error ? err.message : String(err));
    return 'FAILED';
  }
}

/**
 * 4. Conditional ACK
 */
export async function conditionalAck(
  jobId: string,
  claimToken: string,
  customRedis?: Redis
): Promise<'ACKED' | 'LEASE_MISMATCH' | 'NOT_IN_PROCESSING' | 'FAILED'> {
  const redis = customRedis || getRedisClient();
  if (!redis) return 'FAILED';

  try {
    const res = await redis.eval(
      CONDITIONAL_ACK_LUA,
      5,
      PROCESSING_KEY,
      `${LEASE_PREFIX}${jobId}`,
      `${META_PREFIX}${jobId}`,
      `${PAYLOAD_PREFIX}${jobId}`,
      `${ACTIVE_MARKER_PREFIX}${jobId}`,
      jobId,
      claimToken
    );
    return res as 'ACKED' | 'LEASE_MISMATCH' | 'NOT_IN_PROCESSING';
  } catch (err: unknown) {
    console.error('[CONDITIONAL_ACK_ERROR]', err instanceof Error ? err.message : String(err));
    return 'FAILED';
  }
}

/**
 * 5. True Idempotent Deadletter Transfer
 */
export async function transferToDeadletter(params: {
  jobId: string;
  sourceType: 'processing' | 'queue' | 'retry';
  claimToken?: string;
  reason: string;
  customRedis?: Redis;
  extraContext?: Record<string, unknown>;
}): Promise<'TRANSFERRED' | 'REJECTED' | 'FAILED'> {
  const redis = params.customRedis || getRedisClient();
  if (!redis) return 'FAILED';

  let sourceKey: string;
  if (params.sourceType === 'processing') sourceKey = PROCESSING_KEY;
  else if (params.sourceType === 'queue') sourceKey = QUEUE_KEY;
  else if (params.sourceType === 'retry') sourceKey = RETRY_KEY;
  else return 'FAILED';

  const token = params.claimToken || '';
  const transferId = params.sourceType === 'processing'
    ? `PROC:${params.jobId}:${token}`
    : `SYS:${params.sourceType}:${params.jobId}`;

  const deadletterRecord = JSON.stringify({
    jobId: params.jobId,
    sourceType: params.sourceType,
    claimToken: token || undefined,
    reason: params.reason,
    transferId,
    timestamp: Date.now(),
    extra: params.extraContext,
  });

  try {
    const res = await redis.eval(
      DEADLETTER_TRANSFER_LUA,
      7,
      sourceKey,
      DEADLETTER_KEY,
      `${DEDUP_TRANSFER_PREFIX}${transferId}`,
      `${LEASE_PREFIX}${params.jobId}`,
      `${META_PREFIX}${params.jobId}`,
      `${PAYLOAD_PREFIX}${params.jobId}`,
      `${ACTIVE_MARKER_PREFIX}${params.jobId}`,
      params.jobId,
      params.sourceType,
      token,
      deadletterRecord
    );

    return res === 'TRANSFERRED' ? 'TRANSFERRED' : 'FAILED';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('LEASE_MISMATCH') || msg.includes('ACTIVE_LEASE_EXISTS')) {
      console.warn(`[DEADLETTER_TRANSFER_REJECTED] ${msg}`);
      return 'REJECTED';
    }
    console.error('[DEADLETTER_TRANSFER_ERROR]', msg);
    return 'FAILED';
  }
}

/**
 * 6. Atomic Provider Attempt Reservation
 */
export async function reserveProviderAttempt(
  jobId: string,
  claimToken: string,
  customRedis?: Redis
): Promise<ReservationResult> {
  const redis = customRedis || getRedisClient();
  if (!redis) {
    return { status: 'LEASE_MISMATCH' };
  }

  const nowMs = Date.now();

  try {
    const rawRes = await redis.eval(
      RESERVE_ATTEMPT_LUA,
      2,
      `${LEASE_PREFIX}${jobId}`,
      `${META_PREFIX}${jobId}`,
      claimToken,
      nowMs.toString()
    );

    const parsed = typeof rawRes === 'string' ? JSON.parse(rawRes) : rawRes;
    return parsed as ReservationResult;
  } catch (err: unknown) {
    console.error('[RESERVE_ATTEMPT_ERROR]', err instanceof Error ? err.message : String(err));
    return { status: 'LEASE_MISMATCH' };
  }
}

/**
 * 7. Record Provider Failure Counter (Independent from reaper crashes)
 */
export async function recordProviderFailure(
  jobId: string,
  customRedis?: Redis
): Promise<number> {
  const redis = customRedis || getRedisClient();
  if (!redis) return 0;

  try {
    const newCount = await redis.hincrby(`${META_PREFIX}${jobId}`, 'providerAttemptsFailed', 1);
    return newCount;
  } catch (err: unknown) {
    console.error('[RECORD_PROVIDER_FAILURE_ERROR]', err instanceof Error ? err.message : String(err));
    return 0;
  }
}

/**
 * 8. Schedule Delayed Retry into ZSET with Capacity Guard
 */
export async function scheduleRetry(
  jobId: string,
  claimToken: string,
  delayMs: number,
  customRedis?: Redis
): Promise<'SCHEDULED' | 'OVERFLOW_DEADLETTER' | 'FAILED'> {
  const redis = customRedis || getRedisClient();
  if (!redis) return 'FAILED';

  const nextAttemptAt = Date.now() + delayMs;
  const processingItem = `${jobId}:${claimToken}`;

  // Atomic Lua for retry scheduling: checks ZCARD < 5000
  const RETRY_LUA = `
    local processingKey = KEYS[1]
    local retryKey = KEYS[2]
    local deadletterKey = KEYS[3]
    local leaseKey = KEYS[4]
    local metaKey = KEYS[5]
    local payloadKey = KEYS[6]
    local activeKey = KEYS[7]

    local jobId = ARGV[1]
    local procItem = ARGV[2]
    local nextScore = tonumber(ARGV[3])
    local maxRetryCap = tonumber(ARGV[4])
    local nowMs = tonumber(ARGV[5])

    -- 1. Check current lease
    local curLease = redis.call('GET', leaseKey)
    -- Remove from processing item
    redis.call('LREM', processingKey, 1, procItem)
    redis.call('DEL', leaseKey)

    -- 2. Check retry ZSET capacity (5,000)
    local zLen = redis.call('ZCARD', retryKey)
    if zLen < maxRetryCap then
      redis.call('ZADD', retryKey, nextScore, jobId)
      return 'SCHEDULED'
    else
      -- Overflow to Deadletter
      local dlRecord = cjson.encode({
        jobId = jobId,
        reason = 'RETRY_CAPACITY_EXCEEDED',
        timestamp = nowMs
      })
      redis.call('LPUSH', deadletterKey, dlRecord)
      redis.call('LTRIM', deadletterKey, 0, 999)
      redis.call('DEL', metaKey)
      redis.call('DEL', payloadKey)
      redis.call('DEL', activeKey)
      return 'OVERFLOW_DEADLETTER'
    end
  `;

  try {
    const res = await redis.eval(
      RETRY_LUA,
      7,
      PROCESSING_KEY,
      RETRY_KEY,
      DEADLETTER_KEY,
      `${LEASE_PREFIX}${jobId}`,
      `${META_PREFIX}${jobId}`,
      `${PAYLOAD_PREFIX}${jobId}`,
      `${ACTIVE_MARKER_PREFIX}${jobId}`,
      jobId,
      processingItem,
      nextAttemptAt.toString(),
      MAX_RETRY_CAPACITY.toString(),
      Date.now().toString()
    );
    return res as 'SCHEDULED' | 'OVERFLOW_DEADLETTER';
  } catch (err: unknown) {
    console.error('[SCHEDULE_RETRY_ERROR]', err instanceof Error ? err.message : String(err));
    return 'FAILED';
  }
}

// ============================================================================
// WORKER PROCESSING (Preserved for compatibility with sms-worker.ts)
// ============================================================================

export async function processNextJob(
  timeoutSeconds = 0,
  customRedis?: Redis
): Promise<boolean> {
  void timeoutSeconds;
  const redis = customRedis || getRedisClient();
  if (!redis) return false;

  const claimRes = await atomicClaim(redis);
  if (claimRes.status !== 'CLAIMED' || !claimRes.jobId || !claimRes.claimToken) {
    return false;
  }

  const { jobId, claimToken } = claimRes;

  // 1. Fetch metadata
  const meta = await redis.hgetall(`${META_PREFIX}${jobId}`);
  if (!meta || Object.keys(meta).length === 0) {
    await transferToDeadletter({
      jobId,
      sourceType: 'processing',
      claimToken,
      reason: 'METADATA_MISSING',
      customRedis: redis,
    });
    return false;
  }

  // 2. Fetch and decrypt payload
  const payloadStr = await redis.get(`${PAYLOAD_PREFIX}${jobId}`);
  if (!payloadStr) {
    await transferToDeadletter({
      jobId,
      sourceType: 'processing',
      claimToken,
      reason: 'PAYLOAD_MISSING',
      customRedis: redis,
    });
    return false;
  }

  let payload: DecryptedSmsPayload;
  try {
    payload = decryptPayload(payloadStr);
  } catch {
    await transferToDeadletter({
      jobId,
      sourceType: 'processing',
      claimToken,
      reason: 'PAYLOAD_DECRYPT_ERROR',
      customRedis: redis,
    });
    return false;
  }

  // 3. Reserve provider attempt
  const reservation = await reserveProviderAttempt(jobId, claimToken, redis);
  if (reservation.status === 'OTP_EXPIRED') {
    await transferToDeadletter({
      jobId,
      sourceType: 'processing',
      claimToken,
      reason: 'OTP_EXPIRED_BEFORE_SEND',
      customRedis: redis,
    });
    return false;
  }

  if (reservation.status === 'EXHAUSTED') {
    await transferToDeadletter({
      jobId,
      sourceType: 'processing',
      claimToken,
      reason: 'MAX_PROVIDER_ATTEMPTS_EXCEEDED',
      customRedis: redis,
    });
    return false;
  }

  if (reservation.status !== 'RESERVED') {
    return false;
  }

  // 4. Dispatch to Gateway or Mock Transport
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
  } catch (dispatchErr: unknown) {
    sendSuccess = false;
    sendError = dispatchErr instanceof Error ? dispatchErr.message : 'Transport dispatch exception';
  }

  if (process.env.NODE_ENV !== 'production' && process.env.TEST_OTP_CAPTURE === 'true') {
    testCapturedOtps.set(payload.challengeId, payload.code);
  }

  if (sendSuccess) {
    await conditionalAck(jobId, claimToken, redis);
    await redis.set(`${STATUS_PREFIX}${meta.phoneHash}`, 'sent', 'EX', 120);
    await redis.incr('sms:stat:sent');
    return true;
  }

  // On Failure: record provider failure
  await recordProviderFailure(jobId, redis);
  console.warn(`[SMS_DISPATCH_FAILED] Attempt ${reservation.attemptNumber} failed: ${sendError}`);

  if ((reservation.attemptNumber || 0) < 3) {
    // Retry with backoff: attempt 1 -> 5s, attempt 2 -> 20s
    const backoffMs = reservation.attemptNumber === 1 ? 5000 : 20000;
    await scheduleRetry(jobId, claimToken, backoffMs, redis);
  } else {
    await transferToDeadletter({
      jobId,
      sourceType: 'processing',
      claimToken,
      reason: 'MAX_PROVIDER_ATTEMPTS_EXCEEDED',
      customRedis: redis,
    });
  }

  return false;
}

/**
 * Phase 4 Atomic Item Reaper
 * Executes single atomic Lua transition for an abandoned or stale processing claim.
 */
export async function atomicReapItem(
  item: string,
  customRedis?: Redis
): Promise<{ status: string; jobId?: string; crashRecoveries?: number; retryScore?: number; error?: string }> {
  const redis = customRedis || getRedisClient();
  if (!redis) return { status: 'FAILED', error: 'Redis client unavailable' };

  try {
    const rawRes = await redis.eval(
      REAPER_LUA,
      9,
      PROCESSING_KEY,
      QUEUE_KEY,
      RETRY_KEY,
      DEADLETTER_KEY,
      LEASE_PREFIX,
      META_PREFIX,
      PAYLOAD_PREFIX,
      ACTIVE_MARKER_PREFIX,
      DEDUP_TRANSFER_PREFIX,
      item,
      MAX_QUEUE_CAPACITY.toString(),
      MAX_RETRY_CAPACITY.toString(),
      MAX_CRASH_RECOVERIES.toString(),
      Date.now().toString()
    );

    const parsed = typeof rawRes === 'string' ? JSON.parse(rawRes) : rawRes;
    return parsed;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ATOMIC_REAP_ITEM_ERROR]', msg);
    return { status: 'FAILED', error: msg };
  }
}

/**
 * Phase 4 Atomic Due-Job Promotion
 * Evaluates single due Retry ZSET member and atomically promotes to Queue, postpones, or deadletters.
 */
export async function atomicPromoteItem(
  jobId: string,
  customRedis?: Redis
): Promise<{ status: string; jobId: string; nextScore?: number; score?: number; error?: string }> {
  const redis = customRedis || getRedisClient();
  if (!redis) return { status: 'FAILED', jobId, error: 'Redis client unavailable' };

  try {
    const rawRes = await redis.eval(
      PROMOTION_LUA,
      8,
      RETRY_KEY,
      QUEUE_KEY,
      DEADLETTER_KEY,
      LEASE_PREFIX,
      META_PREFIX,
      PAYLOAD_PREFIX,
      ACTIVE_MARKER_PREFIX,
      DEDUP_TRANSFER_PREFIX,
      jobId,
      MAX_QUEUE_CAPACITY.toString(),
      Date.now().toString()
    );

    const parsed = typeof rawRes === 'string' ? JSON.parse(rawRes) : rawRes;
    return parsed;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ATOMIC_PROMOTE_ITEM_ERROR]', msg);
    return { status: 'FAILED', jobId, error: msg };
  }
}

/**
 * Bounded Reaper Sweep
 * Iterates items currently in sms:dispatch:processing and applies atomic lease-aware recovery.
 */
export async function reapStaleProcessingJobs(
  visibilityTimeoutMs = 45000,
  customRedis?: Redis
): Promise<ReaperSweepResult & number> {
  void visibilityTimeoutMs;
  const redis = customRedis || getRedisClient();
  const emptyRes: ReaperSweepResult = {
    reaped: 0,
    requeued: 0,
    divertedRetry: 0,
    deadlettered: 0,
    staleRemoved: 0,
    activeSkipped: 0,
    errors: 0,
    details: [],
  };
  if (!redis) return Object.assign(0, emptyRes) as unknown as ReaperSweepResult & number;

  let items: string[] = [];
  try {
    items = await redis.lrange(PROCESSING_KEY, 0, -1);
  } catch (err: unknown) {
    console.error('[REAPER_SWEEP_LRANGE_ERROR]', err instanceof Error ? err.message : String(err));
    return Object.assign(0, { ...emptyRes, errors: 1 }) as unknown as ReaperSweepResult & number;
  }

  if (!items || items.length === 0) {
    return Object.assign(0, emptyRes) as unknown as ReaperSweepResult & number;
  }

  let requeued = 0;
  let divertedRetry = 0;
  let deadlettered = 0;
  let staleRemoved = 0;
  let activeSkipped = 0;
  let errors = 0;
  const details: Array<{ jobId?: string; status: string; error?: string }> = [];

  for (const item of items) {
    const res = await atomicReapItem(item, redis);
    details.push(res);
    if (res.status === 'REQUEUED_QUEUE' || res.status === 'REQUEUED_QUEUE_RESUMED') {
      requeued++;
    } else if (res.status === 'DIVERTED_RETRY' || res.status === 'DIVERTED_RETRY_RESUMED') {
      divertedRetry++;
    } else if (res.status.startsWith('DEADLETTER')) {
      deadlettered++;
    } else if (res.status === 'STALE_ENTRY_REMOVED' || res.status === 'MALFORMED_ENTRY_REMOVED') {
      staleRemoved++;
    } else if (res.status === 'ACTIVE_CLAIM_SKIPPED') {
      activeSkipped++;
    } else {
      errors++;
    }
  }

  const reaped = requeued + divertedRetry + deadlettered;
  const sweepRes: ReaperSweepResult = {
    reaped,
    requeued,
    divertedRetry,
    deadlettered,
    staleRemoved,
    activeSkipped,
    errors,
    details,
  };

  const composite = Object.assign(
    Object.create({
      valueOf() {
        return sweepRes.reaped;
      },
      [Symbol.toPrimitive](hint: string) {
        return hint === 'string' ? String(sweepRes.reaped) : sweepRes.reaped;
      },
    }),
    sweepRes
  );

  return composite as ReaperSweepResult & number;
}

/**
 * Retry ZSET Due-Job Promotion Scheduler
 * Promotes due jobs (score <= now) to Queue in bounded batches.
 */
export async function promoteDueRetryJobs(
  batchSize = 100,
  customRedis?: Redis
): Promise<PromotionSweepResult> {
  const redis = customRedis || getRedisClient();
  if (!redis) {
    return { examined: 0, promoted: 0, postponed: 0, deadlettered: 0, skipped: 0, errors: 0, details: [] };
  }

  const nowMs = Date.now();
  let dueJobIds: string[] = [];
  try {
    dueJobIds = await redis.zrangebyscore(RETRY_KEY, 0, nowMs, 'LIMIT', 0, batchSize);
  } catch (err: unknown) {
    console.error('[PROMOTE_DUE_RETRY_ERROR] Failed to query ZSET:', err instanceof Error ? err.message : String(err));
    return { examined: 0, promoted: 0, postponed: 0, deadlettered: 0, skipped: 0, errors: 1, details: [] };
  }

  if (!dueJobIds || dueJobIds.length === 0) {
    return { examined: 0, promoted: 0, postponed: 0, deadlettered: 0, skipped: 0, errors: 0, details: [] };
  }

  let promoted = 0;
  let postponed = 0;
  let deadlettered = 0;
  let skipped = 0;
  let errors = 0;
  const details: Array<{ jobId: string; status: string; error?: string }> = [];

  for (const jobId of dueJobIds) {
    const res = await atomicPromoteItem(jobId, redis);
    details.push(res);
    if (res.status === 'PROMOTED' || res.status === 'PROMOTED_DUPLICATE_PURGED') {
      promoted++;
    } else if (res.status === 'QUEUE_FULL_POSTPONED') {
      postponed++;
    } else if (res.status.startsWith('DEADLETTER')) {
      deadlettered++;
    } else if (res.status === 'ACTIVE_LEASE_EXISTS' || res.status === 'NOT_DUE' || res.status === 'NOT_IN_RETRY') {
      skipped++;
    } else {
      errors++;
    }
  }

  return {
    examined: dueJobIds.length,
    promoted,
    postponed,
    deadlettered,
    skipped,
    errors,
    details,
  };
}

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

export function setMockSmsTransport(transport: MockTransportFn | null): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Mock SMS transport injection is strictly forbidden in production');
  }
  mockTransport = transport;
}

export function getCapturedTestOtp(challengeId: string): string | null {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: TEST-ONLY OTP capture hook is strictly forbidden in production');
  }
  if (process.env.TEST_OTP_CAPTURE !== 'true') {
    return null;
  }
  return testCapturedOtps.get(challengeId) || null;
}

export function clearCapturedTestOtps(): void {
  testCapturedOtps.clear();
}
