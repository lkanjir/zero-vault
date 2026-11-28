import { createClient } from 'redis';
import type { RedisReply } from 'rate-limit-redis';
import type { RedisConfig } from '../config.js';

const REDIS_CONNECT_TIMEOUT_MS = 5_000;
const REDIS_CLOSE_TIMEOUT_MS = 2_000;
const REDIS_RECONNECT_MAX_DELAY_MS = 500;
const REDIS_AUTH_ERROR_PATTERN = /^(?:NOAUTH|WRONGPASS)(?:\s|$)/;

function isRedisAuthError(error: Error): boolean {
  return REDIS_AUTH_ERROR_PATTERN.test(error.message);
}

export type RedisSendCommand = (...args: string[]) => Promise<RedisReply>;

export type RedisHandle = {
  readonly connect: () => Promise<void>;
  readonly sendCommand: RedisSendCommand;
  readonly checkConnection: () => Promise<void>;
  readonly close: () => Promise<void>;
};

export function createRedisClient(redisConfig: RedisConfig): RedisHandle {
  const client = createClient({
    url: redisConfig.url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy(retries: number, cause: Error) {
        if (isRedisAuthError(cause)) {
          return cause;
        }

        return Math.min(retries * 50, REDIS_RECONNECT_MAX_DELAY_MS);
      },
    },
  });

  client.on('error', (error: unknown) => {
    console.error('Redis client error', { error });
  });

  return {
    async connect() {
      if (!client.isOpen) {
        await client.connect();
      }
    },
    sendCommand(...args: string[]) {
      return client.sendCommand(args);
    },
    async checkConnection() {
      const response = await client.ping();
      if (response !== 'PONG') {
        throw new Error(`Unexpected Redis PING response: ${response}`);
      }
    },
    async close() {
      if (!client.isOpen) {
        return;
      }

      if (!client.isReady) {
        client.destroy();
        return;
      }

      const closePromise = client.close();
      closePromise.catch(() => undefined);

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closePromise,
          new Promise<never>((_resolve, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`Redis close timed out after ${REDIS_CLOSE_TIMEOUT_MS}ms`));
            }, REDIS_CLOSE_TIMEOUT_MS);
            timeoutHandle.unref();
          }),
        ]);
      } catch {
        client.destroy();
      } finally {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
      }
    },
  };
}
