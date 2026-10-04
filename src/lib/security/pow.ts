import crypto from 'crypto';

const POW_PEPPER = process.env.POW_SECRET_PEPPER || 'dev_pow_secret_pepper_min_32_characters_long_1234';
const DEFAULT_DIFFICULTY = 3; // 3 leading hex zeros (e.g. "000...")
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface PoWChallenge {
  challenge: string;
  difficulty: number;
  expiresAt: number;
}

export interface PoWSolutionPayload {
  challenge: string;
  solution: string;
}

/**
 * Generates an in-house signed PoW challenge.
 */
export function generatePoWChallenge(difficulty = DEFAULT_DIFFICULTY): PoWChallenge {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const rawPayload = `${timestamp}:${difficulty}:${nonce}`;

  const signature = crypto
    .createHmac('sha256', POW_PEPPER)
    .update(rawPayload)
    .digest('hex');

  const challenge = Buffer.from(`${rawPayload}:${signature}`).toString('base64');
  return {
    challenge,
    difficulty,
    expiresAt: timestamp + CHALLENGE_TTL_MS,
  };
}

/**
 * Verifies an in-house PoW solution.
 */
export function verifyPoWSolution(payload: PoWSolutionPayload): { valid: boolean; reason?: string } {
  if (!payload || !payload.challenge || !payload.solution) {
    return { valid: false, reason: 'کد چالش امنیتی یا پاسخ ارسال نشده است.' };
  }

  try {
    const decoded = Buffer.from(payload.challenge, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 4) {
      return { valid: false, reason: 'قالب چالش امنیتی نامعتبر است.' };
    }

    const [timestampStr, difficultyStr, nonce, receivedSig] = parts;
    const timestamp = parseInt(timestampStr, 10);
    const difficulty = parseInt(difficultyStr, 10);

    // 1. Check expiration
    if (Date.now() - timestamp > CHALLENGE_TTL_MS) {
      return { valid: false, reason: 'چالش امنیتی منقضی شده است. لطفاً صفحه را بازنگری کنید.' };
    }

    // 2. Verify signature
    const expectedSig = crypto
      .createHmac('sha256', POW_PEPPER)
      .update(`${timestamp}:${difficulty}:${nonce}`)
      .digest('hex');

    if (
      receivedSig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(Buffer.from(receivedSig), Buffer.from(expectedSig))
    ) {
      return { valid: false, reason: 'امضای چالش امنیتی نامعتبر است.' };
    }

    // 3. Verify hash difficulty
    const hash = crypto
      .createHash('sha256')
      .update(`${payload.challenge}:${payload.solution}`)
      .digest('hex');

    const targetPrefix = '0'.repeat(difficulty);
    if (!hash.startsWith(targetPrefix)) {
      return { valid: false, reason: 'پاسخ چالش امنیتی نادرست است.' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, reason: 'خطا در ارزیابی چالش امنیتی.' };
  }
}

/**
 * Validates honeypot and minimum fill time (> 1.5s).
 */
export function validateHoneypotAndTiming(body: { _hp?: string; fillTimeMs?: number }): { valid: boolean; reason?: string } {
  // Honeypot field must be completely empty
  if (body._hp && body._hp.trim().length > 0) {
    return { valid: false, reason: 'درخواست غیرمجاز توسط سامانه امنیتی شناسایی شد.' };
  }

  // Minimum fill time must be at least 1500ms
  if (typeof body.fillTimeMs === 'number' && body.fillTimeMs < 1500) {
    return { valid: false, reason: 'ثبت اطلاعات سریع‌تر از حد مجاز انسانی انجام شد.' };
  }

  return { valid: true };
}

/**
 * Solves PoW challenge (used by tests and client-side simulator).
 */
export function solvePoW(challenge: string, difficulty: number): string {
  const targetPrefix = '0'.repeat(difficulty);
  let counter = 0;

  while (counter < 2000000) {
    const candidate = counter.toString();
    const hash = crypto
      .createHash('sha256')
      .update(`${challenge}:${candidate}`)
      .digest('hex');

    if (hash.startsWith(targetPrefix)) {
      return candidate;
    }
    counter++;
  }
  throw new Error('PoW solve exceeded maximum iterations');
}
