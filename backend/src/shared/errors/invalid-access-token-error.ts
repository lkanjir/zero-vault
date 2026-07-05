import { AppError } from './app-error.js';

export class InvalidAccessTokenError extends AppError {
  constructor() {
    super('Unauthorized', 401, 'invalid_access_token', {
      'WWW-Authenticate': 'Bearer error="invalid_token"',
    });
  }
}
