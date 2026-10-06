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

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  try {
    redisInstance = new Redis(redisUrl, {
      connectTimeout: 500,
      commandTimeout: 250,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        // Continuous backoff up to 2 seconds so connection auto-heals after Redis restarts
        return Math.min(times * 150, 2000);
      },
      lazyConnect: false,
    });

    redisInstance.on('error', (err) => {
      // Prevent unhandled rejection; log structured warning
      if (process.env.NODE_ENV === 'production') {
        console.error('[SECURITY_REDIS_ERROR]', err.message);
      }
    });

    return redisInstance;
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[SECURITY_REDIS_INIT_FAILED]', error);
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
