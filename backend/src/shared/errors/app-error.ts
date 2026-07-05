export type AppErrorHeaders = Readonly<Record<string, string>>;

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly headers: AppErrorHeaders = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}
