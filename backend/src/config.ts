import dotenv from 'dotenv';
import * as z from 'zod';

dotenv.config({});

const requiredTrimmedString = z.string().trim().min(1);

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  S3_ENDPOINT: z.url().trim(),
  S3_REGION: requiredTrimmedString,
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  S3_ACCESS_KEY_ID: requiredTrimmedString,
  S3_SECRET_ACCESS_KEY: requiredTrimmedString,
  S3_BUCKET: requiredTrimmedString,
  DATABASE_URL: z.url().trim(),
  OIDC_ISSUER: z.url().transform((v) => v.replace(/\/+$/, '')),
  OIDC_AUDIENCE: requiredTrimmedString,
  HSTS_ENABLED: z.stringbool().default(false),
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
    bucket: env.S3_BUCKET,
  },
  db: {
    connectionString: env.DATABASE_URL,
  },
  oidc: {
    issuer: env.OIDC_ISSUER,
    audience: env.OIDC_AUDIENCE,
  },
  http: {
    hstsEnabled: env.HSTS_ENABLED,
  },
} as const;
