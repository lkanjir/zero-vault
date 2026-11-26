import { createApp } from './app.js';
import { loadApiConfig, loadDotenv } from './config.js';
import { createDatabase } from './db/db-client.js';
import { closeHttpServer, registerGracefulShutdown } from './shared/runtime/graceful-shutdown.js';

loadDotenv();

const apiConfig = loadApiConfig();
const database = createDatabase(apiConfig.db);
const app = createApp({ config: apiConfig, database });

const server = app.listen(apiConfig.http.port, () => {
  console.info(`Backend listening on http://localhost:${apiConfig.http.port}`);
});

registerGracefulShutdown({
  name: 'HTTP server',
  onShutdown: async () => {
    await closeHttpServer(server);
    await database.close();
  },
});
