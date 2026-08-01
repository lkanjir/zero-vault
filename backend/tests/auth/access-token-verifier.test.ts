import * as jose from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyAccessToken } from '../../src/auth/access-token-verifier.js';
import {
  JOSEError,
  JWKInvalid,
  JWKSInvalid,
  JWKSNoMatchingKey,
  JWKSTimeout,
  JWTExpired,
  JWTInvalid,
  JWSSignatureVerificationFailed,
} from 'jose/errors';
import { AuthProviderUnavailableError } from '../../src/shared/errors/auth/auth-provider-unavailable-error.js';

vi.mock('jose', () => ({
  customFetch: Symbol('customFetch'),
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

const jwtVerifyMock = vi.mocked(jose.jwtVerify);

const validToken = {
  protectedHeader: { alg: 'RS256' },
  payload: {
    iss: process.env['OIDC_ISSUER']!,
    sub: 'user-123',
    iat: 100,
    exp: 200,
    email: ' Test@Example.COM ',
    email_verified: true,
    preferred_username: 'test',
  },
  key: new Uint8Array(),
};

describe('verifyAccessToken', () => {
  beforeEach(() => jwtVerifyMock.mockReset());

  it('maps a verified payload to principal', async () => {
    jwtVerifyMock.mockResolvedValueOnce(validToken);

    const principal = await verifyAccessToken('valid-token');

    expect(principal).toStrictEqual({
      issuer: process.env['OIDC_ISSUER']!,
      subject: 'user-123',
      email: 'test@example.com',
      username: 'test',
    });
  });

  it('token passed to jwtVerify with correct verification rules', async () => {
    jwtVerifyMock.mockResolvedValueOnce(validToken);

    await verifyAccessToken('valid-token');
    expect(jwtVerifyMock).toHaveBeenCalledExactlyOnceWith(
      'valid-token',
      expect.any(Function),
      expect.objectContaining({
        issuer: process.env['OIDC_ISSUER'],
        audience: process.env['OIDC_AUDIENCE'],
        algorithms: ['RS256'],
        clockTolerance: 1,
        requiredClaims: ['sub', 'iat', 'exp'],
      }),
    );
  });

  it('valid token without username returns principal without username', async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      protectedHeader: { alg: 'RS256' },
      payload: {
        iss: 'http://localhost:8080/realms/zero-vault',
        sub: 'user-123',
        iat: 100,
        exp: 200,
        email: 'test@example.com',
        email_verified: true,
      },
      key: new Uint8Array(),
    });

    const principal = await verifyAccessToken('valid-token');

    expect(jwtVerifyMock).toHaveBeenCalledOnce();
    expect(principal.username).toBeUndefined();
    expect(principal).toStrictEqual({
      issuer: 'http://localhost:8080/realms/zero-vault',
      subject: 'user-123',
      email: 'test@example.com',
    });
  });

  it.each([
    [
      'missing email',
      {
        iss: 'http://localhost:8080/realms/zero-vault',
        sub: 'user-123',
        iat: 100,
        exp: 200,
        email_verified: true,
      },
    ],
    [
      'unverified email',
      {
        iss: 'http://localhost:8080/realms/zero-vault',
        sub: 'user-123',
        iat: 100,
        exp: 200,
        email: 'test@example.com',
        email_verified: false,
      },
    ],
    [
      'missing email verification',
      {
        iss: 'http://localhost:8080/realms/zero-vault',
        sub: 'user-123',
        iat: 100,
        exp: 200,
        email: 'test@example.com',
      },
    ],
    [
      'invalid email',
      {
        iss: 'http://localhost:8080/realms/zero-vault',
        sub: 'user-123',
        iat: 100,
        exp: 200,
        email: 'not-an-email',
        email_verified: true,
      },
    ],
  ])('payload with %s requires a verified email', async (_case, payload) => {
    jwtVerifyMock.mockResolvedValueOnce({
      protectedHeader: { alg: 'RS256' },
      payload,
      key: new Uint8Array(),
    });

    await expect(verifyAccessToken('valid-token')).rejects.toMatchObject({
      code: 'verified_email_required',
    });
  });

  it.each([
    [
      'missing issuer',
      {
        sub: 'user-123',
        iat: 100,
        exp: 200,
        email: 'test@example.com',
        email_verified: true,
      },
    ],
    [
      'missing subject',
      {
        iat: 100,
        exp: 200,
        iss: 'http://localhost:8080/realms/zero-vault',
        email: 'test@example.com',
        email_verified: true,
      },
    ],
  ])('payload with %s fails validation', async (_case, payload) => {
    jwtVerifyMock.mockResolvedValueOnce({
      protectedHeader: { alg: 'RS256' },
      payload: payload,
      key: new Uint8Array(),
    });

    await expect(verifyAccessToken('random-token')).rejects.toMatchObject({
      code: 'invalid_access_token',
      options: {
        context: {
          hasIssuer: 'iss' in payload && typeof payload.iss === 'string',
          hasSubject: 'sub' in payload && typeof payload.sub === 'string',
        },
      },
    });
  });

  it.each([
    new JWTExpired('Token expired', {}, 'exp', 'check_failed'),
    new JWTInvalid('Invalid token'),
    new JWSSignatureVerificationFailed(),
    new JWKSNoMatchingKey(),
  ])('maps token verification error $code to invalid_access_token', async (error) => {
    jwtVerifyMock.mockRejectedValueOnce(error);

    await expect(verifyAccessToken('invalid-token')).rejects.toMatchObject({
      code: 'invalid_access_token',
      options: {
        cause: error,
        context: {
          joseCode: error.code,
        },
      },
    });
  });

  it.each([
    new JWKSTimeout(),
    new JWKInvalid('Invalid provider key'),
    new JWKSInvalid('Invalid provider key set'),
    new JOSEError('Invalid JWKS response'),
  ])('maps provider error $code to authentication_service_unavailable', async (error) => {
    jwtVerifyMock.mockRejectedValueOnce(error);

    await expect(verifyAccessToken('token')).rejects.toMatchObject({
      code: 'authentication_service_unavailable',
      options: {
        cause: error,
        context: {
          providerOperation: 'fetch_jwks',
          joseCode: error.code,
        },
      },
    });
  });

  it('maps a JWKS transport failure to authentication_service_unavailable', async () => {
    const error = new AuthProviderUnavailableError({ cause: new Error('Network failure') });
    jwtVerifyMock.mockRejectedValueOnce(error);

    await expect(verifyAccessToken('token')).rejects.toMatchObject({
      code: 'authentication_service_unavailable',
      options: {
        cause: error,
        context: {
          providerOperation: 'fetch_jwks',
        },
      },
    });
  });

  it('preserves an unexpected verifier error for the global 500 handler', async () => {
    const error = new Error('Unexpected verifier failure');
    jwtVerifyMock.mockRejectedValueOnce(error);

    await expect(verifyAccessToken('token')).rejects.toBe(error);
  });
});
