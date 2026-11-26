import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authInterceptor } from './auth-interceptor';
import { AuthService } from './auth-service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;
  let getAccessToken: ReturnType<typeof vi.fn<() => Promise<string>>>;

  beforeEach(() => {
    getAccessToken = vi.fn<() => Promise<string>>().mockResolvedValue('test-access-token');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { getAccessToken } },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it.each(['/api', '/api?foo=1', '/api/entries', '/api/files/123'])(
    'attaches Bearer token to protected API URL %s',
    async (url) => {
      http.get(url).subscribe();

      await Promise.resolve();
      const request = httpTesting.expectOne(url);
      expect(request.request.headers.get('Authorization')).toBe('Bearer test-access-token');
      request.flush({});
    },
  );

  it.each([
    '/api/config',
    '/api/config?v=1',
    '/apiv2/entries',
    '/api-docs',
    'https://storage.example.com/api/upload',
  ])('does not attach Authorization header to non-protected URL %s', (url) => {
    http.get(url).subscribe();

    const request = httpTesting.expectOne(url);
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(getAccessToken).not.toHaveBeenCalled();
    request.flush({});
  });
});
