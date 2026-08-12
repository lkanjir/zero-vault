import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { closeDatabase, db } from './db-client.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url));

try {
  console.info('Applying database migrations');

  await migrate(db, { migrationsFolder });

  console.info('Database migrations applied');
} catch (error) {
  console.error('Database migration failed', { error });
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
