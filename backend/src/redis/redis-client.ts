import { createClient } from 'redis';
import type { RedisReply } from 'rate-limit-redis';
import type { RedisConfig } from '../config.js';

const REDIS_CONNECT_TIMEOUT_MS = 5_000;

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
    socket: {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
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

      try {
        await client.close();
      } catch {
        client.destroy();
      }
    },
  };
}
