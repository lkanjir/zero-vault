import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

const dbUrl = process.env['DATABASE_URL'];

if (!dbUrl) {
  throw new Error('Empty connection string');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: dbUrl,
  },
});
