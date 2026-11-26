import { describe, expect, it } from 'vitest';
import { formatFileSize } from './format-file-size';

describe('formatFileSize', () => {
  it('formats zero bytes, small files, and up to 512 GiB cleanly', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(16 * 1024 * 1024)).toBe('16 MB');
    expect(formatFileSize(512 * 1024 * 1024 * 1024)).toBe('512 GB');
    expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe('1 TB');
  });

  it('returns a placeholder for invalid or negative values', () => {
    expect(formatFileSize(-1)).toBe('-');
    expect(formatFileSize(Number.NaN)).toBe('-');
  });
});
