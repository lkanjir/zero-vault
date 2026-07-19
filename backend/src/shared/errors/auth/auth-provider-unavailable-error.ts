export class AuthProviderUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('OICD provider nije dostupan', options);
    this.name = new.target.name;
  }
}
