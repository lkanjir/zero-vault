const SHA256_BYTE_LENGTH = 32;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

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
