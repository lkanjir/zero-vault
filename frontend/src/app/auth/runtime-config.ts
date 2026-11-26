export type AuthRuntimeConfig = {
  readonly url: string;
  readonly realm: string;
  readonly clientId: string;
};

export type RuntimeConfig = {
  readonly auth: AuthRuntimeConfig;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseRuntimeConfig(payload: unknown): RuntimeConfig {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Neispravna konfiguracija aplikacije.');
  }

  const auth = (payload as Record<string, unknown>)['auth'];
  if (typeof auth !== 'object' || auth === null) {
    throw new Error('Nedostaje konfiguracija autentikacije.');
  }

  const { url, realm, clientId } = auth as Record<string, unknown>;
  if (!isNonEmptyString(url) || !isNonEmptyString(realm) || !isNonEmptyString(clientId)) {
    throw new Error('Konfiguracija autentikacije nije potpuna.');
  }

  return {
    auth: {
      url: url.trim(),
      realm: realm.trim(),
      clientId: clientId.trim(),
    },
  };
}

export async function loadRuntimeConfig(fetchFn: typeof fetch = fetch): Promise<RuntimeConfig> {
  const response = await fetchFn('/api/config', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Učitavanje konfiguracije aplikacije nije uspjelo (${response.status}).`);
  }

  return parseRuntimeConfig(await response.json());
}
