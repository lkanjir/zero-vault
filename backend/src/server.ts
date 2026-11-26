import { loadDotenv, loadHttpConfig } from './config.js';

loadDotenv();

const { app } = await import('./app.js');
const httpConfig = loadHttpConfig();

app.listen(httpConfig.port, () => {
  console.info(`Backend listening on http://localhost:${httpConfig.port}`);
});
