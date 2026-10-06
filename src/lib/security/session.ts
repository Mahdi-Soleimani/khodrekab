import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { resolveClientIp } from './ip';

export const SESSION_LIFETIME_SECONDS = 2592000; // 30 days (1 month persistent session)

export interface SessionCookieConfig {
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
}

/**
 * Single source of truth for session cookie configuration.
 * Production: __Host-carno_session (Secure, Path=/)
 * Development: carno_session
 */
export function getSessionCookieConfig(): SessionCookieConfig {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    name: isProd ? '__Host-carno_session' : 'carno_session',
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_LIFETIME_SECONDS,
  };
}

/**
 * Resolves JWT secret with strict environment fail-closed rules.
 */
export function getJwtSecret(): string {
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('FAIL_CLOSED: JWT_SECRET must be set and >= 32 characters in production');
    }
    return secret;
  }

  const devSecret = process.env.JWT_SECRET || process.env.JWT_DEV_SECRET;
  if (!devSecret || devSecret.length < 16) {
    throw new Error('FAIL_CLOSED: JWT_SECRET or JWT_DEV_SECRET must be set in development');
  }
  return devSecret;
}

export function parseCookiesFromHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const list: Record<string, string> = {};
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    if (key) {
      try {
        list[key] = decodeURIComponent(val);
      } catch {
        list[key] = val;
      }
    }
  }
  return list;
}

export interface SessionCreationResult {
  token: string;
  jti: string;
  expiresAt: Date;
  cookieConfig: SessionCookieConfig;
}

/**
 * Creates a stateful session in the database and returns a signed HS256 JWT.
 */
export async function createSession(userId: string, req?: Request): Promise<SessionCreationResult> {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_SECONDS * 1000);

  let ipHash: string | null = null;
  let userAgentHash: string | null = null;

  if (req) {
    const clientIp = resolveClientIp(req);
    if (clientIp) {
      ipHash = crypto.createHash('sha256').update(clientIp).digest('hex');
    }
    const ua = req.headers.get('user-agent');
    if (ua) {
      userAgentHash = crypto.createHash('sha256').update(ua).digest('hex');
    }
  }

  await prisma.session.create({
    data: {
      userId,
      jti,
      ipHash,
      userAgentHash,
      expiresAt,
    },
  });

  const secret = getJwtSecret();
  const token = jwt.sign(
    { userId, jti },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: SESSION_LIFETIME_SECONDS,
    }
  );

  return {
    token,
    jti,
    expiresAt,
    cookieConfig: getSessionCookieConfig(),
  };
}

export interface SessionValidationResult {
  valid: boolean;
  userId?: string;
  jti?: string;
  session?: unknown;
  code?: 'UNAUTHENTICATED' | 'LEGACY_TOKEN_REJECTED' | 'INVALID_JWT' | 'SESSION_REVOKED_OR_EXPIRED' | 'DB_MIGRATION_PENDING';
  status?: number;
  shouldDeleteLegacy?: boolean;
}

/**
 * Validates a session token directly.
 */
export async function validateSessionToken(token: string): Promise<SessionValidationResult> {
  let decoded: { userId: string; jti: string };
  try {
    const secret = getJwtSecret();
    decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    }) as { userId: string; jti: string };
  } catch {
    return {
      valid: false,
      code: 'INVALID_JWT',
      status: 401,
    };
  }

  if (!decoded.userId || !decoded.jti) {
    return {
      valid: false,
      code: 'INVALID_JWT',
      status: 401,
    };
  }

  try {
    const session = await prisma.session.findUnique({
      where: { jti: decoded.jti },
    });

    if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) {
      return {
        valid: false,
        code: 'SESSION_REVOKED_OR_EXPIRED',
        status: 401,
      };
    }

    return {
      valid: true,
      userId: decoded.userId,
      jti: decoded.jti,
      session,
    };
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj?.code === 'P2021' || errorObj?.code === 'P2022' || errorObj?.message?.includes('does not exist')) {
      return {
        valid: false,
        code: 'DB_MIGRATION_PENDING',
        status: 503,
      };
    }
    throw err;
  }
}

/**
 * Validates session from incoming Request or cookie header.
 * Fail-closed: missing session, revoked session, or legacy token returns 401.
 * Missing DB table/column returns 503.
 */
export async function validateSession(req: Request): Promise<SessionValidationResult> {
  const cookieHeader = req.headers.get('cookie');
  const cookies = parseCookiesFromHeader(cookieHeader);

  const cookieConfig = getSessionCookieConfig();
  const sessionToken = cookies[cookieConfig.name] || cookies['carno_session'] || cookies['__Host-carno_session'] || cookies['token'];

  if (!sessionToken) {
    return {
      valid: false,
      code: 'UNAUTHENTICATED',
      status: 401,
      shouldDeleteLegacy: false,
    };
  }

  const res = await validateSessionToken(sessionToken);
  return {
    ...res,
    shouldDeleteLegacy: !res.valid && Boolean(cookies['token']),
  };
}

/**
 * Revokes a session by setting revokedAt = now.
 */
export async function revokeSession(jti: string): Promise<void> {
  try {
    await prisma.session.update({
      where: { jti },
      data: { revokedAt: new Date() },
    });
  } catch {
    // Ignore if not found
  }
}
