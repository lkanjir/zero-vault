export type ErrorDefinition = {
  readonly status: number;
  readonly message: string;
  readonly headers?: Readonly<Record<string, string>>;
};

export const errorCatalog = {
  invalid_json: {
    status: 400,
    message: 'JSON sadržaj nije ispravan.',
  },

  request_body_too_large: {
    status: 413,
    message: 'Tijelo zahtjeva je preveliko.',
  },

  invalid_request_body: {
    status: 400,
    message: 'Podaci zahtjeva nisu ispravni.',
  },

  invalid_request_params: {
    status: 400,
    message: 'Parametri putanje nisu ispravni.',
  },

  invalid_request_query: {
    status: 400,
    message: 'Parametri upita nisu ispravni.',
  },

  authentication_required: {
    status: 401,
    message: 'Potrebna je prijava.',
    headers: {
      'WWW-Authenticate': 'Bearer',
    },
  },

  invalid_access_token: {
    status: 401,
    message: 'Prijavite se ponovno.',
    headers: {
      'WWW-Authenticate': 'Bearer error="invalid_token"',
    },
  },

  authorization_denied: {
    status: 403,
    message: 'Nemate dopuštenje za ovu randju',
  },

  authentication_service_unavailable: {
    status: 503,
    message: 'Usluga za prijavu nije dostupna.',
  },

  entry_not_found: {
    status: 404,
    message: 'Datoteka ili direktorij nisu pronađeni.',
  },

  folder_not_found: {
    status: 404,
    message: 'Direktorij nije pronađen.',
  },

  folder_not_empty: {
    status: 409,
    message: 'Direktorij nije moguće obrisati jer nije prazan.',
  },

  folder_download_not_found: {
    status: 404,
    message: 'Za dani direktorij nije traženo preuzimanje.',
  },

  file_not_found: {
    status: 404,
    message: 'Datoteka nije pronađena.',
  },

  move_would_create_cycle: {
    status: 409,
    message: 'Direktorij nije moguće premjestiti u samog sebe ili neki od njegovih poddirektorija.',
  },

  duplicate_entry_name: {
    status: 409,
    message: 'Stavka s tim nazivom već postoji u ovom direktoriju.',
  },

  invalid_cursor: {
    status: 400,
    message: 'Kursor za nastavak popisa nije ispravan.',
  },

  cursor_parent_mismatch: {
    status: 400,
    message: 'Kursor ne pripada traženom direktoriju.',
  },

  upload_not_found: {
    status: 404,
    message: 'Prijenos nije pronađen.',
  },

  upload_object_missing: {
    status: 409,
    message: 'Prenesena datoteka nije pronađena u spremištu.',
  },

  upload_expired: {
    status: 409,
    message: 'Vrijeme za dovršavanje prijenosa je isteklo.',
  },

  upload_checksum_missing: {
    status: 409,
    message: 'Spremište nije vratilo podatke za provjeru integriteta datoteke.',
  },

  upload_checksum_mismatch: {
    status: 409,
    message: 'Provjera integriteta datoteke nije uspjela.',
  },

  upload_size_mismatch: {
    status: 409,
    message: 'Veličina prenesene datoteke ne odgovara očekivanoj veličini.',
  },

  upload_content_type_mismatch: {
    status: 409,
    message: 'Tip prenesene datoteke ne odgovara očekivanom.',
  },

  storage_unavailable: {
    status: 503,
    message: 'Spremište datoteka nije dostupno.',
  },

  route_not_found: {
    status: 404,
    message: 'Tražena ruta ne postoji.',
  },

  internal_server_error: {
    status: 500,
    message: 'Dogodila se neočekivana pogreška.',
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof errorCatalog;

export function getErrorDefinition(code: ErrorCode): ErrorDefinition {
  return errorCatalog[code];
}
