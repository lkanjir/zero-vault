export class AuthProviderUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('OIDC provider is unavailable', options);
    this.name = new.target.name;
  }
}
