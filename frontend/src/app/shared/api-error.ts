import { HttpErrorResponse } from '@angular/common/http';

export type ApiError = {
  status: number;
  code: string;
  message?: string;
  requestId?: string;
};

export function toApiError(error: unknown): ApiError {
  if (!(error instanceof HttpErrorResponse)) {
    return { status: -1, code: 'unexpected_error' };
  }

  const body = isRecord(error.error) ? error.error : null;
  const code = body?.['code'];
  const message = body?.['message'];
  const requestId = body?.['requestId'];

  return {
    status: error.status,
    code: typeof code === 'string' ? code : 'http_error',
    message: typeof message === 'string' ? message : undefined,
    requestId: typeof requestId === 'string' ? requestId : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function apiErrorMessage(
  error: ApiError,
  fallback = 'Dogodila se neočekivana greška.',
): string {
  if (error.status === 0) {
    return 'Poslužitelj trenutno nije dostupan.';
  }

  if (error.message) {
    if (error.status >= 500 && error.requestId) {
      return `${error.message} ID zahtjeva: ${error.requestId}`;
    }

    return error.message;
  }

  switch (error.status) {
    case 403:
      return 'Nemaš dopuštenje za ovu radnju.';
    case 404:
      return 'Traženi sadržaj ne postoji.';
    default:
      return fallback;
  }
}
