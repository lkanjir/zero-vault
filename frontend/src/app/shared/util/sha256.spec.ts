import { describe, expect, it } from 'vitest';
import { calculateBufferSha256, calculateSha256 } from './sha256';

describe('sha256', () => {
  it('computes the standard SHA-256 hex digest for empty buffers and empty files', async () => {
    const expectedEmptyDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    await expect(calculateBufferSha256(new ArrayBuffer(0))).resolves.toBe(expectedEmptyDigest);
    await expect(calculateSha256(new Blob([]))).resolves.toBe(expectedEmptyDigest);
  });

  it('computes the standard SHA-256 hex digest for non-empty blobs and buffers', async () => {
    const bytes = new TextEncoder().encode('hello');
    const expectedHelloDigest = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

    await expect(calculateBufferSha256(bytes.buffer)).resolves.toBe(expectedHelloDigest);
    await expect(calculateSha256(new Blob([bytes]))).resolves.toBe(expectedHelloDigest);
  });
});
