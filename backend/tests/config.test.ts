import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FOLDER_DOWNLOAD_MAX_FILES,
  DEFAULT_FOLDER_DOWNLOAD_MAX_TOTAL_BYTES,
  DEFAULT_MAX_PENDING_UPLOAD_INTENTS_PER_USER,
  DEFAULT_USER_STORAGE_QUOTA_BYTES,
  loadApiConfig,
  loadDbConfig,
  loadFolderDownloadLimitsConfig,
  loadHttpConfig,
  loadOidcConfig,
  loadRedisConfig,
  loadS3Config,
  loadUploadLimitsConfig,
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

  it('loads Redis config for redis:// and rediss:// URLs and rejects other protocols', () => {
    expect(
      loadRedisConfig({
        REDIS_URL: '  redis://localhost:6379  ',
      }),
    ).toStrictEqual({
      url: 'redis://localhost:6379',
    });

    expect(
      loadRedisConfig({
        REDIS_URL: 'rediss://:secret@redis.internal:6380/0',
      }),
    ).toStrictEqual({
      url: 'rediss://:secret@redis.internal:6380/0',
    });

    expect(() => loadRedisConfig({ REDIS_URL: 'http://localhost:6379' })).toThrow(
      'Invalid Redis environment configuration',
    );
    expect(() => loadRedisConfig({})).toThrow('Invalid Redis environment configuration');
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
      trustProxy: false,
    });
  });

  it('parses TRUST_PROXY hop counts, subnets, and rejects permissive or invalid values', () => {
    expect(loadHttpConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(loadHttpConfig({ TRUST_PROXY: '0' }).trustProxy).toBe(false);
    expect(loadHttpConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadHttpConfig({ TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(loadHttpConfig({ TRUST_PROXY: '  loopback  ' }).trustProxy).toBe('loopback');
    expect(loadHttpConfig({ TRUST_PROXY: '10.0.0.0/8, loopback' }).trustProxy).toBe(
      '10.0.0.0/8, loopback',
    );
    expect(loadHttpConfig({ TRUST_PROXY: '127.0.0.1, ::1/128, uniquelocal' }).trustProxy).toBe(
      '127.0.0.1, ::1/128, uniquelocal',
    );

    for (const invalid of [
      'true',
      '-1',
      '65',
      '1.5',
      'all',
      'not-a-subnet',
      '10.0.0.0/99',
      '0.0.0.0/0',
      '::/0',
      'loopback,',
    ]) {
      expect(() => loadHttpConfig({ TRUST_PROXY: invalid }), `TRUST_PROXY=${invalid}`).toThrow(
        'Invalid HTTP environment configuration',
      );
    }
  });

  it('loads full API config when all sections are valid', () => {
    const apiConfig = loadApiConfig({
      PORT: '4000',
      HSTS_ENABLED: 'true',
      TRUST_PROXY: '1',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/zerovault',
      REDIS_URL: 'redis://localhost:6379',
      S3_ENDPOINT: 'http://localhost:4566',
      S3_PUBLIC_ORIGIN: 'http://localhost:4566',
      S3_REGION: 'eu-central-1',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_BUCKET: 'vault',
      OIDC_ISSUER: 'https://auth.example.com/realms/zero-vault',
      OIDC_AUDIENCE: 'zero-vault-api',
    });

    expect(apiConfig.http).toStrictEqual({ port: 4000, hstsEnabled: true, trustProxy: 1 });
    expect(apiConfig.db.connectionString).toBe('postgresql://user:pass@localhost:5432/zerovault');
    expect(apiConfig.redis.url).toBe('redis://localhost:6379');
    expect(apiConfig.uploadLimits).toStrictEqual({
      userStorageQuotaBytes: DEFAULT_USER_STORAGE_QUOTA_BYTES,
      maxPendingUploadIntentsPerUser: DEFAULT_MAX_PENDING_UPLOAD_INTENTS_PER_USER,
    });
    expect(apiConfig.folderDownloadLimits).toStrictEqual({
      maxFiles: DEFAULT_FOLDER_DOWNLOAD_MAX_FILES,
      maxTotalBytes: DEFAULT_FOLDER_DOWNLOAD_MAX_TOTAL_BYTES,
    });
    expect(apiConfig.s3.forcePathStyle).toBe(false);
    expect(apiConfig.oidc.audience).toBe('zero-vault-api');
  });

  it('loads folder download limit defaults and custom values and rejects non-positive limits', () => {
    expect(loadFolderDownloadLimitsConfig({})).toStrictEqual({
      maxFiles: DEFAULT_FOLDER_DOWNLOAD_MAX_FILES,
      maxTotalBytes: DEFAULT_FOLDER_DOWNLOAD_MAX_TOTAL_BYTES,
    });

    expect(
      loadFolderDownloadLimitsConfig({
        FOLDER_DOWNLOAD_MAX_FILES: '250',
        FOLDER_DOWNLOAD_MAX_TOTAL_BYTES: '104857600',
      }),
    ).toStrictEqual({
      maxFiles: 250,
      maxTotalBytes: 104_857_600,
    });

    expect(() => loadFolderDownloadLimitsConfig({ FOLDER_DOWNLOAD_MAX_FILES: '0' })).toThrow(
      'Invalid folder download limits environment configuration',
    );
    expect(() => loadFolderDownloadLimitsConfig({ FOLDER_DOWNLOAD_MAX_TOTAL_BYTES: '-5' })).toThrow(
      'Invalid folder download limits environment configuration',
    );
  });

  it('loads upload limit defaults and custom values and rejects non-positive limits', () => {
    expect(loadUploadLimitsConfig({})).toStrictEqual({
      userStorageQuotaBytes: DEFAULT_USER_STORAGE_QUOTA_BYTES,
      maxPendingUploadIntentsPerUser: DEFAULT_MAX_PENDING_UPLOAD_INTENTS_PER_USER,
    });

    expect(
      loadUploadLimitsConfig({
        USER_STORAGE_QUOTA_BYTES: '524288000',
        MAX_PENDING_UPLOAD_INTENTS_PER_USER: '50',
      }),
    ).toStrictEqual({
      userStorageQuotaBytes: 524_288_000,
      maxPendingUploadIntentsPerUser: 50,
    });

    expect(() => loadUploadLimitsConfig({ USER_STORAGE_QUOTA_BYTES: '0' })).toThrow(
      'Invalid upload limits environment configuration',
    );
    expect(() => loadUploadLimitsConfig({ MAX_PENDING_UPLOAD_INTENTS_PER_USER: '-1' })).toThrow(
      'Invalid upload limits environment configuration',
    );
  });

  it('throws a scoped error when required variables are missing or invalid', () => {
    expect(() => loadDbConfig({})).toThrow('Invalid database environment configuration');
    expect(() => loadOidcConfig({ OIDC_ISSUER: 'not-a-url' })).toThrow(
      'Invalid OIDC environment configuration',
    );
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
