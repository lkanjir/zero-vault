import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeCompositeSha256,
  isValidCompositeSha256,
  sha256Base64ToHex,
  sha256HexToBase64,
} from '../../src/shared/utils/sha256-convert.js';

describe('sha256-convert', () => {
  it('converts between hex and base64 digests', () => {
    const emptyHex = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
    const emptyBase64 = createHash('sha256').update(Buffer.alloc(0)).digest('base64');

    expect(sha256HexToBase64(emptyHex)).toBe(emptyBase64);
    expect(sha256Base64ToHex(emptyBase64)).toBe(emptyHex);
  });

  it('computes S3-compatible composite SHA-256 checksums across part digests', () => {
    const part1 = createHash('sha256').update(Buffer.from('part-one')).digest();
    const part2 = createHash('sha256').update(Buffer.from('part-two')).digest();
    const expected = `${createHash('sha256')
      .update(Buffer.concat([part1, part2]))
      .digest('base64')}-2`;

    const actual = computeCompositeSha256([part1.toString('hex'), part2.toString('hex')]);

    expect(actual).toBe(expected);
    expect(isValidCompositeSha256(actual)).toBe(true);
  });

  it('rejects empty part lists and invalid hex digests when computing composite checksums', () => {
    expect(() => computeCompositeSha256([])).toThrow(
      'Composite SHA-256 requires at least one part digest',
    );
    expect(() => computeCompositeSha256(['not-hex'])).toThrow('Invalid SHA-256 hex digest');
  });

  it('validates composite SHA-256 format strictly', () => {
    const validBase64 = Buffer.alloc(32, 0x11).toString('base64');

    expect(isValidCompositeSha256(`${validBase64}-1`)).toBe(true);
    expect(isValidCompositeSha256(`${validBase64}-10000`)).toBe(true);
    expect(isValidCompositeSha256(validBase64)).toBe(false);
    expect(isValidCompositeSha256(`${validBase64}-0`)).toBe(false);
    expect(isValidCompositeSha256(`${validBase64}-01`)).toBe(false);
    expect(isValidCompositeSha256('a'.repeat(64))).toBe(false);
  });
});
