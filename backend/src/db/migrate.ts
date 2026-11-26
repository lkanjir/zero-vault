import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { loadDbConfig, loadDotenv } from '../config.js';
import { createDatabase } from './db-client.js';

loadDotenv();

const migrationsFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url));
const database = createDatabase(loadDbConfig());

try {
  console.info('Applying database migrations');

  await migrate(database.db, { migrationsFolder });

  console.info('Database migrations applied');
} catch (error) {
  console.error('Database migration failed', { error });
  process.exitCode = 1;
} finally {
  await database.close();
}
