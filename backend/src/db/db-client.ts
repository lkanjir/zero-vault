import { Pool } from 'pg';
import { config } from '../config.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './generated/schema.js';

const pool = new Pool({ connectionString: config.db.connectionString });
export const db = drizzle({ client: pool, schema });
