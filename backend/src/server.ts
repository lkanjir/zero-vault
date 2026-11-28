import { createApp } from './app.js';
import { loadApiConfig, loadDotenv } from './config.js';
import { createDatabase } from './db/db-client.js';
import { createRedisClient } from './redis/redis-client.js';
import { closeHttpServer, registerGracefulShutdown } from './shared/runtime/graceful-shutdown.js';

loadDotenv();

const apiConfig = loadApiConfig();
const database = createDatabase(apiConfig.db);
const redis = createRedisClient(apiConfig.redis);

let server: ReturnType<ReturnType<typeof createApp>['listen']>;

try {
  await redis.connect();
  const app = createApp({ config: apiConfig, database, redis });
  server = app.listen(apiConfig.http.port, () => {
    console.info(`Backend listening on http://localhost:${apiConfig.http.port}`);
  });
} catch (error) {
  await redis.close().catch(() => undefined);
  await database.close().catch(() => undefined);
  throw error;
}

registerGracefulShutdown({
  name: 'HTTP server',
  onShutdown: async () => {
    try {
      await closeHttpServer(server);
    } finally {
      try {
        await redis.close();
      } finally {
        await database.close();
      }
    }
  },
});
