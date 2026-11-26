import { createApp } from './app.js';
import { loadApiConfig, loadDotenv } from './config.js';
import { createDatabase } from './db/db-client.js';

loadDotenv();

const apiConfig = loadApiConfig();
const database = createDatabase(apiConfig.db);
const app = createApp({ config: apiConfig, database });

app.listen(apiConfig.http.port, () => {
  console.info(`Backend listening on http://localhost:${apiConfig.http.port}`);
});
