import { AppError } from './app-error.js';

export class AuthenticationRequiredError extends AppError {
  constructor() {
    super('Unauthorized', 401, 'authentication_required', {
      'WWW-Authenticate': 'Bearer',
    });
  }
}
