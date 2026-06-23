export const normalizedContentType = (value: string): string =>
  value.split(';', 1)[0]!.trim().toLowerCase();
