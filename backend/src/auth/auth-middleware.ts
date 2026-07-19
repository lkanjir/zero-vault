import type { RequestHandler } from 'express';
import { verifyAccessToken } from './access-token-verifier.js';
import { AppError } from '../shared/errors/api/app-error.js';

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = extractJWT(req.get('Authorization'));

  if (!token) {
    throw new AppError('authentication_required');
  }

  req.principal = await verifyAccessToken(token);
  next();
};

function extractJWT(bearer: string | undefined) {
  if (!bearer) return null;

  const [scheme, token, ...rest] = bearer.split(/[ \t]+/);
  if (rest.length > 0 || scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}
