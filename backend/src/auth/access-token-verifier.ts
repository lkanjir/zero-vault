import * as jose from 'jose';
import { config } from '../config.js';
import type { AuthenticatedPrincipal } from './authenticated-principal.js';
import { JOSEError, JWKInvalid, JWKSInvalid, JWKSTimeout } from 'jose/errors';
import type { JWTPayload } from 'jose';
import { AppError } from '../shared/errors/api/app-error.js';
import { AuthProviderUnavailableError } from '../shared/errors/auth/auth-provider-unavailable-error.js';
import { normalizedEmailSchema } from '../shared/validation/normalized-email-schema.js';
import z from 'zod';

const fetchJwks: jose.FetchImplementation = async (url, options) => {
  try {
    return await fetch(url, options);
  } catch (error) {
    throw new AuthProviderUnavailableError({
      cause: error,
    });
  }
};

const jwks = jose.createRemoteJWKSet(
  new URL(`${config.oidc.issuer}/protocol/openid-connect/certs`),
  { [jose.customFetch]: fetchJwks },
);

export async function verifyAccessToken(token: string): Promise<AuthenticatedPrincipal> {
  const payload = await verifyJwt(token);

  if (typeof payload.iss !== 'string' || typeof payload.sub !== 'string') {
    throw new AppError('invalid_access_token', {
      context: {
        hasIssuer: typeof payload.iss === 'string',
        hasSubject: typeof payload.sub === 'string',
      },
    });
  }

  const emailVerified = payload['email_verified'];
  const emailParseResult = normalizedEmailSchema.safeParse(payload['email']);

  if (emailVerified !== true || !emailParseResult.success) {
    throw new AppError('verified_email_required');
  }

  const profileNameSchema = z.string().trim().min(1).max(255);
  const firstNameParseResult = profileNameSchema.safeParse(payload['given_name']);
  const lastNameParseResult = profileNameSchema.safeParse(payload['family_name']);

  if (!firstNameParseResult.success || !lastNameParseResult.success) {
    throw new AppError('invalid_access_token', {
      context: {
        validGivenName: firstNameParseResult.success,
        validFamilyName: lastNameParseResult.success,
      },
    });
  }

  const principal: AuthenticatedPrincipal = {
    issuer: payload.iss,
    subject: payload.sub,
    email: emailParseResult.data,
    firstName: firstNameParseResult.data,
    lastName: lastNameParseResult.data,
  };

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
  if (isAuthenticationProviderFailure(error)) {
    return new AppError('authentication_service_unavailable', {
      cause: error,
      context: authenticationErrorContext(error),
    });
  }

  if (error instanceof JOSEError) {
    return new AppError('invalid_access_token', {
      cause: error,
      context: {
        joseCode: error.code,
      },
    });
  }

  return error instanceof Error
    ? error
    : new Error('Unexpected token verification error', { cause: error });
}

function isAuthenticationProviderFailure(error: unknown): boolean {
  return (
    error instanceof AuthProviderUnavailableError ||
    error instanceof JWKSTimeout ||
    error instanceof JWKInvalid ||
    error instanceof JWKSInvalid ||
    (error instanceof JOSEError && error.constructor === JOSEError)
  );
}

function authenticationErrorContext(error: unknown): Record<string, string> {
  if (error instanceof JOSEError) {
    return {
      providerOperation: 'fetch_jwks',
      joseCode: error.code,
    };
  }

  return {
    providerOperation: 'fetch_jwks',
  };
}
