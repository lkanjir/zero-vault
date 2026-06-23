import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

const dbUrl = process.env['DATABASE_URL'];

if (!dbUrl) {
  throw new Error('Empty connection string');
}

export default defineConfig({
  dialect: 'postgresql',
  out: './src/db/generated',
  dbCredentials: {
    url: dbUrl,
  },
  schemaFilter: ['public'],
  introspect: {
    casing: 'camel',
  },
});
