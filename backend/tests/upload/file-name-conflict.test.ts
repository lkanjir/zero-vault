import { describe, expect, it } from 'vitest';
import {
  buildAutoRenamedFileName,
  getAutoRenameSearchPrefix,
  MAX_ENTRY_NAME_LENGTH,
  pickAvailableFileName,
  splitFileName,
} from '../../src/upload/file-name-conflict.js';

describe('file-name-conflict', () => {
  it('splits standard, multi-dot, extensionless, dotfile, and trailing-dot file names', () => {
    expect(splitFileName('report.pdf')).toStrictEqual({ base: 'report', extension: '.pdf' });
    expect(splitFileName('archive.tar.gz')).toStrictEqual({
      base: 'archive.tar',
      extension: '.gz',
    });
    expect(splitFileName('README')).toStrictEqual({ base: 'README', extension: '' });
    expect(splitFileName('.gitignore')).toStrictEqual({ base: '.gitignore', extension: '' });
    expect(splitFileName('.env.local')).toStrictEqual({ base: '.env', extension: '.local' });
    expect(splitFileName('file.')).toStrictEqual({ base: 'file.', extension: '' });
  });

  it('builds numbered candidates matching <name> (n).<ext> and <name> (n)', () => {
    expect(buildAutoRenamedFileName('report.pdf', 1)).toBe('report (1).pdf');
    expect(buildAutoRenamedFileName('archive.tar.gz', 2)).toBe('archive.tar (2).gz');
    expect(buildAutoRenamedFileName('Makefile', 1)).toBe('Makefile (1)');
    expect(buildAutoRenamedFileName('.gitignore', 1)).toBe('.gitignore (1)');
    expect(buildAutoRenamedFileName('.env.local', 3)).toBe('.env (3).local');
  });

  it('keeps auto-renamed file names within the 500-character database limit', () => {
    const longBase = 'a'.repeat(496);
    const longName = `${longBase}.txt`; // 500 chars
    const renamed = buildAutoRenamedFileName(longName, 1);

    expect(renamed.length).toBeLessThanOrEqual(MAX_ENTRY_NAME_LENGTH);
    expect(renamed.endsWith(' (1).txt')).toBe(true);
    expect(
      renamed.toLowerCase().startsWith(getAutoRenameSearchPrefix(longName).toLowerCase()),
    ).toBe(true);
  });

  it('handles pathological very long extensions without exceeding 500 characters and keeps search prefix consistent', () => {
    const weirdName = `x.${'e'.repeat(498)}`; // 500 chars
    const renamed = buildAutoRenamedFileName(weirdName, 12);

    expect(renamed.length).toBeLessThanOrEqual(MAX_ENTRY_NAME_LENGTH);
    expect(renamed.endsWith(' (12)')).toBe(true);
    expect(
      renamed.toLowerCase().startsWith(getAutoRenameSearchPrefix(weirdName).toLowerCase()),
    ).toBe(true);

    // Extension of 491 chars: counter=1 still inserts " (1)" before the dot,
    // while extension.length + 12 >= 500 — search prefix must still match every candidate.
    const longExtName = `abcdef.${'b'.repeat(490)}`;
    const prefix = getAutoRenameSearchPrefix(longExtName).toLowerCase();
    for (const counter of [1, 2, 10, 999, 10_000, 100_000]) {
      const candidate = buildAutoRenamedFileName(longExtName, counter);
      expect(candidate.length).toBeLessThanOrEqual(MAX_ENTRY_NAME_LENGTH);
      expect(candidate.toLowerCase().startsWith(prefix)).toBe(true);
    }
  });

  it('picks the original name when free and skips case-insensitive taken candidates', () => {
    expect(pickAvailableFileName('photo.jpg', new Set(['other.jpg']))).toBe('photo.jpg');
    expect(
      pickAvailableFileName('Photo.JPG', new Set(['photo.jpg', 'photo (1).jpg', 'photo (2).jpg'])),
    ).toBe('Photo (3).JPG');
    expect(pickAvailableFileName('README', new Set(['readme', 'readme (1)']))).toBe('README (2)');
  });
});
