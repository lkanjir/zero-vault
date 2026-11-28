import { RedisStore } from 'rate-limit-redis';
import type { RedisHandle } from '../../../redis/redis-client.js';
import { RateLimitStoreUnavailableError } from '../../errors/http/rate-limit-store-unavailable-error.js';
import type { RateLimitStoreFactory } from './rate-limit-store.js';

const DEFAULT_REDIS_RATE_LIMIT_NAMESPACE = 'zv:rl';

function isRedisNoScriptError(error: unknown): boolean {
  return error instanceof Error && /^NOSCRIPT(?:\s|$)/.test(error.message);
}

export function createRedisRateLimitStoreFactory(
  redis: Pick<RedisHandle, 'sendCommand'>,
  namespace: string = DEFAULT_REDIS_RATE_LIMIT_NAMESPACE,
): RateLimitStoreFactory {
  return (identifier: string) =>
    new RedisStore({
      sendCommand: async (...args: string[]) => {
        try {
          return await redis.sendCommand(...args);
        } catch (error) {
          // Preserve Redis NOSCRIPT replies so rate-limit-redis reloads its Lua scripts automatically.
          if (isRedisNoScriptError(error)) {
            throw error;
          }

          throw new RateLimitStoreUnavailableError(identifier, { cause: error });
        }
      },
      prefix: `${namespace}:${identifier}:`,
    });
}
