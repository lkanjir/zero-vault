import dotenv from 'dotenv';
import * as z from 'zod';

const requiredTrimmedString = z.string().trim().min(1);

const dbEnvSchema = z.object({
  DATABASE_URL: z.url().trim(),
});

const redisEnvSchema = z.object({
  REDIS_URL: z
    .url()
    .trim()
    .refine(
      (value) => {
        const protocol = new URL(value).protocol;
        return protocol === 'redis:' || protocol === 'rediss:';
      },
      { message: 'REDIS_URL must use the redis:// or rediss:// protocol' },
    ),
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

const KEYCLOAK_ISSUER_PATH_REGEX = /^(.*)\/realms\/([^/]+)$/;

const oidcEnvSchema = z.object({
  OIDC_ISSUER: z
    .url()
    .transform((v) => v.replace(/\/+$/, ''))
    .refine((v) => KEYCLOAK_ISSUER_PATH_REGEX.test(new URL(v).pathname), {
      message: 'OIDC_ISSUER must end with /realms/<realm>',
    }),
  OIDC_AUDIENCE: requiredTrimmedString,
  OIDC_CLIENT_ID: requiredTrimmedString.default('zero-vault-web'),
});

const trustProxyEnvSchema = z
  .string()
  .optional()
  .transform((value) => (value ?? '').trim())
  .superRefine((value, ctx) => {
    if (value === '' || value.toLowerCase() === 'false') {
      return;
    }

    if (value.toLowerCase() === 'true') {
      ctx.addIssue({
        code: 'custom',
        message:
          'TRUST_PROXY must not be "true"; specify a hop count (e.g. "1") or trusted proxy subnet/keyword (e.g. "loopback").',
      });
      return;
    }

    if (/^-\d+$/.test(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'TRUST_PROXY hop count must be a non-negative integer.',
      });
      return;
    }

    if (/^\d+$/.test(value)) {
      const hops = Number(value);
      if (!Number.isSafeInteger(hops) || hops > 64) {
        ctx.addIssue({
          code: 'custom',
          message: 'TRUST_PROXY hop count must be an integer between 0 and 64.',
        });
      }
    }
  })
  .transform((value): TrustProxyConfig => {
    if (value === '' || value.toLowerCase() === 'false') {
      return false;
    }

    if (/^\d+$/.test(value)) {
      const hops = Number(value);
      return hops === 0 ? false : hops;
    }

    return value;
  });

export const DEFAULT_USER_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB
export const DEFAULT_MAX_PENDING_UPLOAD_INTENTS_PER_USER = 20;

const uploadLimitsEnvSchema = z.object({
  USER_STORAGE_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_USER_STORAGE_QUOTA_BYTES),
  MAX_PENDING_UPLOAD_INTENTS_PER_USER: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(DEFAULT_MAX_PENDING_UPLOAD_INTENTS_PER_USER),
});

const httpEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  HSTS_ENABLED: z.stringbool().default(false),
  TRUST_PROXY: trustProxyEnvSchema,
});

export type DbConfig = {
  readonly connectionString: string;
};

export type RedisConfig = {
  readonly url: string;
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
  readonly clientId: string;
  readonly url: string;
  readonly realm: string;
};

export type TrustProxyConfig = false | number | string;

export type HttpConfig = {
  readonly port: number;
  readonly hstsEnabled: boolean;
  readonly trustProxy: TrustProxyConfig;
};

export type UploadLimitsConfig = {
  readonly userStorageQuotaBytes: number;
  readonly maxPendingUploadIntentsPerUser: number;
};

export type ApiConfig = {
  readonly db: DbConfig;
  readonly redis: RedisConfig;
  readonly s3: S3Config;
  readonly oidc: OidcConfig;
  readonly http: HttpConfig;
  readonly uploadLimits: UploadLimitsConfig;
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

export function loadRedisConfig(env: NodeJS.ProcessEnv = process.env): RedisConfig {
  const parsed = parseEnv(redisEnvSchema, env, 'Redis');
  return {
    url: parsed.REDIS_URL,
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
  const issuerUrl = new URL(parsed.OIDC_ISSUER);
  const match = KEYCLOAK_ISSUER_PATH_REGEX.exec(issuerUrl.pathname);

  if (!match || !match[2]) {
    throw new Error('Invalid OIDC environment configuration');
  }

  return {
    issuer: parsed.OIDC_ISSUER,
    audience: parsed.OIDC_AUDIENCE,
    clientId: parsed.OIDC_CLIENT_ID,
    url: `${issuerUrl.origin}${match[1] ?? ''}`,
    realm: match[2],
  };
}

export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const parsed = parseEnv(httpEnvSchema, env, 'HTTP');
  return {
    port: parsed.PORT,
    hstsEnabled: parsed.HSTS_ENABLED,
    trustProxy: parsed.TRUST_PROXY,
  };
}

export function loadUploadLimitsConfig(env: NodeJS.ProcessEnv = process.env): UploadLimitsConfig {
  const parsed = parseEnv(uploadLimitsEnvSchema, env, 'upload limits');
  return {
    userStorageQuotaBytes: parsed.USER_STORAGE_QUOTA_BYTES,
    maxPendingUploadIntentsPerUser: parsed.MAX_PENDING_UPLOAD_INTENTS_PER_USER,
  };
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    db: loadDbConfig(env),
    redis: loadRedisConfig(env),
    s3: loadS3Config(env),
    oidc: loadOidcConfig(env),
    http: loadHttpConfig(env),
    uploadLimits: loadUploadLimitsConfig(env),
  };
}
