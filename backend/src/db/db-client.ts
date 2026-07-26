import { Pool } from 'pg';
import { config } from '../config.js';
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';

const pool = new Pool({ connectionString: config.db.connectionString });
export const db = drizzle({ client: pool, schema });
export type Database = typeof db;

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
