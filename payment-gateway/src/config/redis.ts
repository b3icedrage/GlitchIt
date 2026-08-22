// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Redis Client
// ═══════════════════════════════════════════════════════════════════════
import Redis from 'ioredis';
import { config } from './index.js';

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (client) return client;

  client = new Redis(config.redis_url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times: number) {
      if (times > 3) {
        console.error('[Redis] Max retries reached');
        return null;
      }
      return Math.min(times * 200, 2000);
    },
  });

  client.on('error', (err: Error) => {
    console.error('[Redis] Connection error:', err.message);
  });

  client.on('connect', () => {
    console.log('[Redis] Connected');
  });

  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    client.disconnect();
    client = null;
  }
}

export default { getRedisClient, closeRedis };
