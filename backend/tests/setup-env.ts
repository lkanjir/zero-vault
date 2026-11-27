Object.assign(process.env, {
  S3_ENDPOINT: 'http://localhost:4566',
  S3_PUBLIC_ORIGIN: 'http://localhost:4566',
  S3_REGION: 'eu-central-1',
  S3_FORCE_PATH_STYLE: 'true',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
  S3_BUCKET: 'test-live',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  OIDC_ISSUER: 'http://localhost:8080/realms/zero-vault',
  OIDC_AUDIENCE: 'zero-vault-api',
});
