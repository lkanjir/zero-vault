import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { DbConfig } from '../config.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type DatabaseHandle = {
  readonly db: Database;
  readonly checkConnection: () => Promise<void>;
  readonly close: () => Promise<void>;
};

export function createDatabase(dbConfig: DbConfig): DatabaseHandle {
  const pool = new Pool({ connectionString: dbConfig.connectionString });
  const db = drizzle({ client: pool, schema });

  return {
    db,
    async checkConnection() {
      await db.execute(sql`select 1`);
    },
    async close() {
      await pool.end();
    },
  };
}
