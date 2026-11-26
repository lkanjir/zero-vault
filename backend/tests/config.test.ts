import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadApiConfig,
  loadDbConfig,
  loadHttpConfig,
  loadOidcConfig,
  loadS3Config,
} from '../src/config.js';

describe('modular environment config loaders', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads database config without requiring S3 or OIDC variables', () => {
    const dbConfig = loadDbConfig({
      DATABASE_URL: '  postgresql://user:pass@localhost:5432/zerovault  ',
    });

    expect(dbConfig).toStrictEqual({
      connectionString: 'postgresql://user:pass@localhost:5432/zerovault',
    });
  });

  it('loads S3 config and normalizes publicOrigin to its origin', () => {
    const s3Config = loadS3Config({
      S3_ENDPOINT: 'http://localhost:4566',
      S3_PUBLIC_ORIGIN: 'https://storage.example.com/bucket/path',
      S3_REGION: 'eu-central-1',
      S3_FORCE_PATH_STYLE: 'true',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_BUCKET: 'vault',
    });

    expect(s3Config).toStrictEqual({
      endpoint: 'http://localhost:4566',
      publicOrigin: 'https://storage.example.com',
      region: 'eu-central-1',
      forcePathStyle: true,
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'vault',
    });
  });

  it('loads OIDC config, strips trailing slashes, and derives Keycloak url, realm, and clientId', () => {
    const oidcConfig = loadOidcConfig({
      OIDC_ISSUER: 'https://auth.example.com/auth/realms/zero-vault///',
      OIDC_AUDIENCE: 'zero-vault-api',
      OIDC_CLIENT_ID: 'custom-web-client',
    });

    expect(oidcConfig).toStrictEqual({
      issuer: 'https://auth.example.com/auth/realms/zero-vault',
      audience: 'zero-vault-api',
      clientId: 'custom-web-client',
      url: 'https://auth.example.com/auth',
      realm: 'zero-vault',
    });
  });

  it('defaults OIDC_CLIENT_ID to zero-vault-web and rejects issuers without a realm path', () => {
    const oidcConfig = loadOidcConfig({
      OIDC_ISSUER: 'http://localhost:8080/realms/zero-vault',
      OIDC_AUDIENCE: 'zero-vault-api',
    });

    expect(oidcConfig).toStrictEqual({
      issuer: 'http://localhost:8080/realms/zero-vault',
      audience: 'zero-vault-api',
      clientId: 'zero-vault-web',
      url: 'http://localhost:8080',
      realm: 'zero-vault',
    });

    expect(() =>
      loadOidcConfig({
        OIDC_ISSUER: 'http://localhost:8080',
        OIDC_AUDIENCE: 'zero-vault-api',
      }),
    ).toThrow('Invalid OIDC environment configuration');
  });

  it('applies HTTP defaults when optional variables are omitted', () => {
    expect(loadHttpConfig({})).toStrictEqual({
      port: 3000,
      hstsEnabled: false,
    });
  });

  it('loads full API config when all sections are valid', () => {
    const apiConfig = loadApiConfig({
      PORT: '4000',
      HSTS_ENABLED: 'true',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/zerovault',
      S3_ENDPOINT: 'http://localhost:4566',
      S3_PUBLIC_ORIGIN: 'http://localhost:4566',
      S3_REGION: 'eu-central-1',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_BUCKET: 'vault',
      OIDC_ISSUER: 'https://auth.example.com/realms/zero-vault',
      OIDC_AUDIENCE: 'zero-vault-api',
    });

    expect(apiConfig.http).toStrictEqual({ port: 4000, hstsEnabled: true });
    expect(apiConfig.db.connectionString).toBe('postgresql://user:pass@localhost:5432/zerovault');
    expect(apiConfig.s3.forcePathStyle).toBe(false);
    expect(apiConfig.oidc.audience).toBe('zero-vault-api');
  });

  it('throws a scoped error when required variables are missing or invalid', () => {
    expect(() => loadDbConfig({})).toThrow('Invalid database environment configuration');
    expect(() => loadOidcConfig({ OIDC_ISSUER: 'not-a-url' })).toThrow(
      'Invalid OIDC environment configuration',
    );
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
