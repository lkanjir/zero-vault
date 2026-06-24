import dotenv from 'dotenv';
import * as z from 'zod';

dotenv.config({});

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_QUARANTINE_BUCKET: z.string().min(1),
  S3_LIVE_BUCKET: z.string().min(1),
  DATABASE_URL: z.string().min(1),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error(z.prettifyError(result.error));
  throw new Error('Invalid environment configuration');
}

const env = result.data;

export const config = {
  port: env.PORT,
  s3: {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    buckets: {
      quarantine: env.S3_QUARANTINE_BUCKET,
      live: env.S3_LIVE_BUCKET,
    },
  },
  db: {
    connectionString: env.DATABASE_URL,
  },
} as const;
