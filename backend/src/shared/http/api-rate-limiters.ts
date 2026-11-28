import type { RequestHandler } from 'express';
import type { Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { RedisHandle } from '../../redis/redis-client.js';
import { RateLimitStoreUnavailableError } from '../errors/http/rate-limit-store-unavailable-error.js';
import { createAuthenticatedRateLimiter } from './authenticated-rate-limiter.js';
import { createIpRateLimiter } from './ip-rate-limiter.js';

const ONE_MINUTE_MS = 60_000;
const TEN_MINUTES_MS = 10 * ONE_MINUTE_MS;
const DEFAULT_REDIS_RATE_LIMIT_NAMESPACE = 'zv:rl';

export type RateLimitStoreFactory = (identifier: string) => Store;

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

export type ApiRateLimiters = {
  readonly globalIpRateLimiter: RequestHandler;
  readonly entryReadRateLimiter: RequestHandler;
  readonly entryMutationRateLimiter: RequestHandler;
  readonly uploadIntentRateLimiter: RequestHandler;
  readonly uploadPartPresignRateLimiter: RequestHandler;
  readonly uploadCompletionRateLimiter: RequestHandler;
  readonly fileDownloadRateLimiter: RequestHandler;
  readonly folderDownloadRateLimiter: RequestHandler;
  readonly folderDownloadStatusRateLimiter: RequestHandler;
  readonly folderTreeRateLimiter: RequestHandler;
  readonly sharingReadRateLimiter: RequestHandler;
  readonly sharingMutationRateLimiter: RequestHandler;
  readonly auditReadRateLimiter: RequestHandler;
};

export type CreateApiRateLimitersOptions = {
  readonly storeFactory?: RateLimitStoreFactory;
};

export function createApiRateLimiters(options: CreateApiRateLimitersOptions = {}): ApiRateLimiters {
  const createStore = (identifier: string): Store | undefined => options.storeFactory?.(identifier);

  return {
    globalIpRateLimiter: createIpRateLimiter({
      identifier: 'api-ip',
      windowMs: ONE_MINUTE_MS,
      limit: 1_000,
      store: createStore('api-ip'),
    }),

    entryReadRateLimiter: createAuthenticatedRateLimiter({
      identifier: 'entry-read',
      windowMs: ONE_MINUTE_MS,
      limit: 180,
      store: createStore('entry-read'),
    }),

    entryMutationRateLimiter: createAuthenticatedRateLimiter({
      identifier: 'entry-mutation',
      windowMs: ONE_MINUTE_MS,
      limit: 120,
      store: createStore('entry-mutation'),
    }),

    uploadIntentRateLimiter: createAuthenticatedRateLimiter({
      identifier: 'upload-intent',
      windowMs: ONE_MINUTE_MS,
      limit: 120,
      store: createStore('upload-intent'),
    }),

    uploadPartPresignRateLimiter: createAuthenticatedRateLimiter({
      identifier: 'upload-part-presign',
      windowMs: ONE_MINUTE_MS,
      limit: 600,
      store: createStore('upload-part-presign'),
    }),

    uploadCompletionRateLimiter: createAuthenticatedRateLimiter({
      identifier: 'upload-completion',
      windowMs: ONE_MINUTE_MS,
      limit: 120,
      store: createStore('upload-completion'),
    }),

    fileDownloadRateLimiter: createAuthenticatedRateLimiter({
      identifier: 'file-download',
      windowMs: ONE_MINUTE_MS,
      limit: 60,
      store: createStore('file-download'),
    }),

    folderDownloadRateLimiter: createAuthenticatedRateLimiter({
      identifier: 'folder-download',
      windowMs: TEN_MINUTES_MS,
      limit: 10,
      store: createStore('folder-download'),
    }),

    folderDownloadStatusRateLimiter: createAuthenticatedRateLimiter({
      identifier: 'folder-download-status',
      windowMs: ONE_MINUTE_MS,
      limit: 120,
      store: createStore('folder-download-status'),
    }),

    folderTreeRateLimiter: createAuthenticatedRateLimiter({
      identifier: 'folder-tree',
      windowMs: ONE_MINUTE_MS,
      limit: 60,
      store: createStore('folder-tree'),
    }),

    sharingReadRateLimiter: createAuthenticatedRateLimiter({
      identifier: 'sharing-read',
      windowMs: ONE_MINUTE_MS,
      limit: 120,
      store: createStore('sharing-read'),
    }),

    sharingMutationRateLimiter: createAuthenticatedRateLimiter({
      identifier: 'sharing-mutation',
      windowMs: ONE_MINUTE_MS,
      limit: 30,
      store: createStore('sharing-mutation'),
    }),

    auditReadRateLimiter: createAuthenticatedRateLimiter({
      identifier: 'audit-read',
      windowMs: ONE_MINUTE_MS,
      limit: 60,
      store: createStore('audit-read'),
    }),
  };
}
