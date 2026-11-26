import { createHash } from 'node:crypto';

const SHA256_BYTE_LENGTH = 32;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const COMPOSITE_SHA256_PATTERN = /^[A-Za-z0-9+/]{43}=-[1-9][0-9]*$/;

export const sha256HexToBase64 = (hex: string): string => {
  const normalizedHex = hex.toLowerCase();

  if (!SHA256_HEX_PATTERN.test(normalizedHex)) {
    throw new Error('Invalid SHA-256 hex digest');
  }

  return Buffer.from(normalizedHex, 'hex').toString('base64');
};

export const sha256Base64ToHex = (base64: string): string => {
  const bytes = Buffer.from(base64, 'base64');

  if (bytes.length !== SHA256_BYTE_LENGTH) {
    throw new Error('Invalid SHA-256 base64 digest');
  }

  return bytes.toString('hex');
};

export const isValidCompositeSha256 = (value: string): boolean => {
  return COMPOSITE_SHA256_PATTERN.test(value);
};

export const computeCompositeSha256 = (partSha256HexList: readonly string[]): string => {
  if (partSha256HexList.length === 0) {
    throw new Error('Composite SHA-256 requires at least one part digest');
  }

  const hash = createHash('sha256');
  for (const hex of partSha256HexList) {
    const normalizedHex = hex.toLowerCase();
    if (!SHA256_HEX_PATTERN.test(normalizedHex)) {
      throw new Error('Invalid SHA-256 hex digest');
    }

    hash.update(Buffer.from(normalizedHex, 'hex'));
  }

  return `${hash.digest('base64')}-${partSha256HexList.length}`;
};
