export class RateLimitStoreUnavailableError extends Error {
  constructor(
    readonly limiterIdentifier: string,
    options?: ErrorOptions,
  ) {
    super(`Rate limit store is unavailable for limiter "${limiterIdentifier}"`, options);
    this.name = new.target.name;
  }
}
