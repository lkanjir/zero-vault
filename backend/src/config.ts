import dotenv from 'dotenv';
import * as z from 'zod';

const requiredTrimmedString = z.string().trim().min(1);

const dbEnvSchema = z.object({
  DATABASE_URL: z.url().trim(),
});

const s3EnvSchema = z.object({
  S3_ENDPOINT: z.url().trim(),
  S3_PUBLIC_ORIGIN: z
    .url()
    .trim()
    .transform((value) => new URL(value).origin),
  S3_REGION: requiredTrimmedString,
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  S3_ACCESS_KEY_ID: requiredTrimmedString,
  S3_SECRET_ACCESS_KEY: requiredTrimmedString,
  S3_BUCKET: requiredTrimmedString,
});

const oidcEnvSchema = z.object({
  OIDC_ISSUER: z.url().transform((v) => v.replace(/\/+$/, '')),
  OIDC_AUDIENCE: requiredTrimmedString,
});

const httpEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  HSTS_ENABLED: z.stringbool().default(false),
});

export type DbConfig = {
  readonly connectionString: string;
};

export type S3Config = {
  readonly endpoint: string;
  readonly publicOrigin: string;
  readonly region: string;
  readonly forcePathStyle: boolean;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
};

export type OidcConfig = {
  readonly issuer: string;
  readonly audience: string;
};

export type HttpConfig = {
  readonly port: number;
  readonly hstsEnabled: boolean;
};

export type ApiConfig = {
  readonly db: DbConfig;
  readonly s3: S3Config;
  readonly oidc: OidcConfig;
  readonly http: HttpConfig;
};

export function loadDotenv(): void {
  dotenv.config({ quiet: true });
}

function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  env: NodeJS.ProcessEnv,
  scope: string,
): z.output<Schema> {
  const result = schema.safeParse(env);

  if (!result.success) {
    console.error(z.prettifyError(result.error));
    throw new Error(`Invalid ${scope} environment configuration`);
  }

  return result.data;
}

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const parsed = parseEnv(dbEnvSchema, env, 'database');
  return {
    connectionString: parsed.DATABASE_URL,
  };
}

export function loadS3Config(env: NodeJS.ProcessEnv = process.env): S3Config {
  const parsed = parseEnv(s3EnvSchema, env, 'S3');
  return {
    endpoint: parsed.S3_ENDPOINT,
    publicOrigin: parsed.S3_PUBLIC_ORIGIN,
    region: parsed.S3_REGION,
    forcePathStyle: parsed.S3_FORCE_PATH_STYLE,
    accessKeyId: parsed.S3_ACCESS_KEY_ID,
    secretAccessKey: parsed.S3_SECRET_ACCESS_KEY,
    bucket: parsed.S3_BUCKET,
  };
}

export function loadOidcConfig(env: NodeJS.ProcessEnv = process.env): OidcConfig {
  const parsed = parseEnv(oidcEnvSchema, env, 'OIDC');
  return {
    issuer: parsed.OIDC_ISSUER,
    audience: parsed.OIDC_AUDIENCE,
  };
}

export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const parsed = parseEnv(httpEnvSchema, env, 'HTTP');
  return {
    port: parsed.PORT,
    hstsEnabled: parsed.HSTS_ENABLED,
  };
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    db: loadDbConfig(env),
    s3: loadS3Config(env),
    oidc: loadOidcConfig(env),
    http: loadHttpConfig(env),
  };
}
