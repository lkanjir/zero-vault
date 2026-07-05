import { AppError } from './app-error.js';

export class AuthenticationUnavailableError extends AppError {
  constructor() {
    super('Authentication service unavailable', 503, 'authentication_service_unavailable');
  }
}
