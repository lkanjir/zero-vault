import { describe, expect, it, vi } from 'vitest';
import { loadRuntimeConfig } from './runtime-config';

describe('loadRuntimeConfig', () => {
  it('loads and normalizes auth runtime config from /api/config', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          auth: {
            url: ' https://auth.example.com ',
            realm: ' zero-vault ',
            clientId: ' zero-vault-web ',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(loadRuntimeConfig(fetchMock)).resolves.toStrictEqual({
      auth: {
        url: 'https://auth.example.com',
        realm: 'zero-vault',
        clientId: 'zero-vault-web',
      },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/config', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  });

  it('rejects non-2xx responses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(loadRuntimeConfig(fetchMock)).rejects.toThrow(
      'Učitavanje konfiguracije aplikacije nije uspjelo (503).',
    );
  });

  it('rejects malformed payloads missing auth fields', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ auth: { url: 'http://localhost:8080', realm: '' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(loadRuntimeConfig(fetchMock)).rejects.toThrow(
      'Konfiguracija autentikacije nije potpuna.',
    );
  });
});
