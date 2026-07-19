import * as jose from 'jose';
import { config } from '../config.js';
import type { AuthenticatedPrincipal } from './authenticated-principal.js';
import { JOSEError, JWKSTimeout } from 'jose/errors';
import type { JWTPayload } from 'jose';
import { AppError } from '../shared/errors/api/app-error.js';

const jwks = jose.createRemoteJWKSet(
  new URL(`${config.oidc.issuer}/protocol/openid-connect/certs`),
);

export async function verifyAccessToken(token: string): Promise<AuthenticatedPrincipal> {
  const payload = await verifyJwt(token);

  if (typeof payload.iss !== 'string' || typeof payload.sub !== 'string') {
    throw new AppError('invalid_access_token');
  }

  const username = payload['preferred_username'];

  const principal: AuthenticatedPrincipal = {
    issuer: payload.iss,
    subject: payload.sub,
  };

  if (typeof username === 'string') {
    principal.username = username;
  }

  return principal;
}

async function verifyJwt(token: string): Promise<JWTPayload> {
  try {
    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer: config.oidc.issuer,
      audience: config.oidc.audience,
      algorithms: ['RS256'],
      clockTolerance: 1,
      requiredClaims: ['sub', 'iat', 'exp'],
    });

    return payload;
  } catch (error) {
    throw mapToError(error);
  }
}

function mapToError(error: unknown): Error {
  if (error instanceof JWKSTimeout) {
    return new AppError('authentication_service_unavailable');
  }
  if (error instanceof JOSEError) {
    return new AppError('authentication_service_unavailable');
  }

  return error instanceof Error ? error : new Error('Unknown token verification error');
}
