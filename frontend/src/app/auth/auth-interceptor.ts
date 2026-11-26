import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth-service';
import { from, switchMap } from 'rxjs';

function isProtectedApiRequest(url: string): boolean {
  if (url === '/api/config' || url.startsWith('/api/config?')) {
    return false;
  }

  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isProtectedApiRequest(request.url)) {
    return next(request);
  }

  const auth = inject(AuthService);
  return from(auth.getAccessToken()).pipe(
    switchMap((token) =>
      next(
        request.clone({
          headers: request.headers.set('Authorization', `Bearer ${token}`),
        }),
      ),
    ),
  );
};
