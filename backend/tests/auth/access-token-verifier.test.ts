import * as jose from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyAccessToken } from '../../src/auth/access-token-verifier.js';
import { InvalidAccessTokenError } from '../../src/shared/errors/invalid-access-token-error.js';

vi.mock('jose', () => ({
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
      },
      key: new Uint8Array(),
    });

    const principal = await verifyAccessToken('valid-token');

    expect(jwtVerifyMock).toHaveBeenCalledOnce();
    expect(principal.username).toBeUndefined();
    expect(principal).toStrictEqual({
      issuer: 'http://localhost:8080/realms/zero-vault',
      subject: 'user-123',
    });
  });

  it.each([
    ['missing issuer', { sub: 'user-123', iat: 100, exp: 200 }],
    ['missing subject', { iat: 100, exp: 200, iss: 'http://localhost:8080/realms/zero-vault' }],
  ])('payload with %s fails validation', async (_case, payload) => {
    jwtVerifyMock.mockResolvedValueOnce({
      protectedHeader: { alg: 'RS256' },
      payload: payload,
      key: new Uint8Array(),
    });

    await expect(verifyAccessToken('random-token')).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });
});
