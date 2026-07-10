import { HttpErrorResponse } from '@angular/common/http';

export type ApiError = {
  status: number;
  code: string;
};

export function toApiError(error: unknown): ApiError {
  if (!(error instanceof HttpErrorResponse)) {
    return { status: -1, code: 'unexpected_error' };
  }

  const body = error.error;

  return {
    status: error.status,
    code:
      typeof body === 'object' && body !== null && typeof body.code === 'string'
        ? body.code
        : 'http_error',
  };
}

export function apiErrorMessage(
  error: ApiError,
  fallback = 'Dogodila se neočekivana greška.',
): string {
  switch (error.code) {
    case 'duplicate_entry_name':
      return 'Direktorij s tim nazivom već postoji.';
    case 'invalid_request_body':
      return 'Poslani podaci nisu ispravni.';
    case 'authentication_required':
    case 'invalid_access_token':
      return 'Sesija je istekla. Prijavi se ponovno.';
  }

  switch (error.status) {
    case 0:
      return 'Backend trenutno nije dostupan.';
    case 403:
      return 'Nemaš dopuštenje za ovu radnju.';
    case 404:
      return 'Traženi sadržaj ne postoji.';
    default:
      return fallback;
  }
}
