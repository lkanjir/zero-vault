import * as jose from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAccessTokenVerifier,
  fetchJwks,
  JWKS_FETCH_TIMEOUT_MS,
} from '../../src/auth/access-token-verifier.js';
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

const createRemoteJWKSetMock = vi.mocked(jose.createRemoteJWKSet);
const jwtVerifyMock = vi.mocked(jose.jwtVerify);
const verifyAccessToken = createAccessTokenVerifier({
  issuer: process.env['OIDC_ISSUER']!,
  audience: process.env['OIDC_AUDIENCE']!,
});

const validToken = {
  protectedHeader: { alg: 'RS256' },
  payload: {
    iss: process.env['OIDC_ISSUER']!,
    sub: 'user-123',
    iat: 100,
    exp: 200,
    typ: 'Bearer',
    email: ' Test@Example.COM ',
    email_verified: true,
    given_name: ' Test ',
    family_name: ' User ',
  },
  key: new Uint8Array(),
};

describe('verifyAccessToken', () => {
  beforeEach(() => jwtVerifyMock.mockReset());

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('configures remote JWKS with bounded timeout and custom fetch', () => {
    createAccessTokenVerifier({
      issuer: process.env['OIDC_ISSUER']!,
      audience: process.env['OIDC_AUDIENCE']!,
    });

    expect(createRemoteJWKSetMock).toHaveBeenCalledWith(
      new URL(`${process.env['OIDC_ISSUER']!}/protocol/openid-connect/certs`),
      {
        timeoutDuration: JWKS_FETCH_TIMEOUT_MS,
        [jose.customFetch]: fetchJwks,
      },
    );
  });

  it('maps a verified payload to principal', async () => {
    jwtVerifyMock.mockResolvedValueOnce(validToken);

    const principal = await verifyAccessToken('valid-token');

    expect(principal).toStrictEqual({
      issuer: process.env['OIDC_ISSUER']!,
      subject: 'user-123',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
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
        requiredClaims: ['sub', 'iat', 'exp', 'typ'],
      }),
    );
  });

  it.each([
    ['missing typ', undefined],
    ['ID token typ', 'ID'],
    ['Refresh token typ', 'Refresh'],
    ['lowercase bearer typ', 'bearer'],
    ['non-string typ', 123],
  ])('rejects token with %s', async (_case, typ) => {
    jwtVerifyMock.mockResolvedValueOnce({
      protectedHeader: { alg: 'RS256' },
      payload: {
        iss: process.env['OIDC_ISSUER']!,
        sub: 'user-123',
        iat: 100,
        exp: 200,
        ...(typ !== undefined ? { typ } : {}),
        email: 'test@example.com',
        email_verified: true,
        given_name: 'Test',
        family_name: 'User',
      },
      key: new Uint8Array(),
    });

    await expect(verifyAccessToken('wrong-typ-token')).rejects.toMatchObject({
      code: 'invalid_access_token',
      options: {
        context: {
          invalidTokenType: true,
        },
      },
    });
  });

  it.each([
    ['missing given name', undefined, 'User', false, true],
    ['missing family name', 'Test', undefined, true, false],
    ['blank given name', '   ', 'User', false, true],
    ['blank family name', 'Test', '   ', true, false],
    ['overlong given name', 'a'.repeat(256), 'User', false, true],
    ['overlong family name', 'Test', 'a'.repeat(256), true, false],
  ])(
    'token with %s is rejected',
    async (_case, givenName, familyName, validGivenName, validFamilyName) => {
      jwtVerifyMock.mockResolvedValueOnce({
        protectedHeader: { alg: 'RS256' },
        payload: {
          iss: 'http://localhost:8080/realms/zero-vault',
          sub: 'user-123',
          iat: 100,
          exp: 200,
          typ: 'Bearer',
          email: 'test@example.com',
          email_verified: true,
          given_name: givenName,
          family_name: familyName,
        },
        key: new Uint8Array(),
      });

      await expect(verifyAccessToken('valid-token')).rejects.toMatchObject({
        code: 'invalid_access_token',
        options: {
          context: {
            validGivenName,
            validFamilyName,
          },
        },
      });
    },
  );

  it.each([
    [
      'missing email',
      {
        iss: 'http://localhost:8080/realms/zero-vault',
        sub: 'user-123',
        iat: 100,
        exp: 200,
        typ: 'Bearer',
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
        typ: 'Bearer',
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
        typ: 'Bearer',
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
        typ: 'Bearer',
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
        typ: 'Bearer',
        email: 'test@example.com',
        email_verified: true,
      },
    ],
    [
      'missing subject',
      {
        iat: 100,
        exp: 200,
        typ: 'Bearer',
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

  it('attaches a timeout AbortSignal to JWKS fetch requests and wraps failures', async () => {
    const response = new Response(JSON.stringify({ keys: [] }), { status: 200 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
    vi.stubGlobal('fetch', fetchMock);

    const url = 'http://localhost:8080/realms/zero-vault/protocol/openid-connect/certs';
    const initialController = new AbortController();
    await expect(
      fetchJwks(url, {
        method: 'GET',
        headers: new Headers(),
        redirect: 'manual',
        signal: initialController.signal,
      }),
    ).resolves.toBe(response);

    const [, init] = fetchMock.mock.lastCall!;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);

    const externalController = new AbortController();
    fetchMock.mockImplementationOnce((_u, options) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      externalController.abort(new Error('caller aborted'));
      expect(options?.signal?.aborted).toBe(true);
      return Promise.reject(new DOMException('Timeout', 'TimeoutError'));
    });

    await expect(
      fetchJwks(url, {
        method: 'GET',
        headers: new Headers(),
        redirect: 'manual',
        signal: externalController.signal,
      }),
    ).rejects.toBeInstanceOf(AuthProviderUnavailableError);
  });
});
