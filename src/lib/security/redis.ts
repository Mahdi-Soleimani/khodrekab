import fs from 'fs';
import path from 'path';
import Redis from 'ioredis';

let redisInstance: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (redisInstance && redisInstance.status !== 'end') {
    return redisInstance;
  }
  if (redisInstance && redisInstance.status === 'end') {
    try {
      redisInstance.disconnect();
    } catch {}
    redisInstance = null;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  let configuredPassword = process.env.REDIS_PASSWORD;
  
  const candidatePasswordFiles = [
    process.env.REDIS_PASSWORD_FILE,
    '/run/secrets/redis_password',
    path.join(process.cwd(), 'secrets/redis_password.txt'),
  ].filter((p): p is string => Boolean(p));

  if (!configuredPassword) {
    for (const p of candidatePasswordFiles) {
      try {
        const resolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
        if (fs.existsSync(resolved)) {
          const fileContent = fs.readFileSync(resolved, 'utf8').trim();
          if (fileContent.length > 0) {
            configuredPassword = fileContent;
            break;
          }
        }
      } catch {
        // continue checking next candidate
      }
    }
  }

  // Fail-Closed Validation for Production:
  // Connecting without authentication in production is strictly prohibited.
  const hasUrlAuth = /rediss?:\/\/[^:]+:[^@]+@/.test(redisUrl) || /rediss?:\/\/:[^@]+@/.test(redisUrl);
  if (isProduction && !configuredPassword && !hasUrlAuth) {
    console.error('[SECURITY_REDIS_FATAL] FAIL_CLOSED: Redis authentication required in production, but no password is configured.');
    return null;
  }
  
  try {
    const redisOptions: import('ioredis').RedisOptions = {
      connectTimeout: 500,
      commandTimeout: 250,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        // Continuous backoff up to 2 seconds so connection auto-heals after Redis restarts
        return Math.min(times * 150, 2000);
      },
      lazyConnect: false,
    };

    if (configuredPassword && !hasUrlAuth) {
      redisOptions.password = configuredPassword;
    }

    redisInstance = new Redis(redisUrl, redisOptions);

    redisInstance.on('error', (err) => {
      // Prevent unhandled rejection; log structured warning with masked credentials
      if (process.env.NODE_ENV === 'production') {
        const masked = err.message.replace(/:([^:@]+)@/g, ':***@');
        console.error('[SECURITY_REDIS_ERROR]', masked);
      }
    });

    return redisInstance;
  } catch (error: unknown) {
    if (process.env.NODE_ENV === 'production') {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const msg = errorMsg.replace(/:([^:@]+)@/g, ':***@');
      console.error('[SECURITY_REDIS_INIT_FAILED]', msg);
    }
    return null;
  }
}

/**
 * Health check that verifies Redis responsiveness within 250ms timeout.
 */
export async function isRedisAvailable(): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;

  try {
    const pingPromise = client.ping();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Redis ping timeout > 250ms')), 250)
    );
    const res = await Promise.race([pingPromise, timeoutPromise]);
    return res === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Close Redis connection cleanly (used in tests/teardown).
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisInstance) {
    try {
      await redisInstance.quit();
    } catch {
      redisInstance.disconnect();
    } finally {
      redisInstance = null;
    }
  }
}
