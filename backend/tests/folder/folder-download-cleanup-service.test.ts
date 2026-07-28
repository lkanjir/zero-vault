import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { FolderDownloadCleanupService } from '../../src/folder/download/folder-download-cleanup-service.js';
import type { FolderDownloadRepository } from '../../src/folder/download/folder-download-repository.js';

const NOW = new Date('2026-07-28T10:00:00.000Z');

describe('FolderDownloadCleanupService', () => {
  let repository: MockProxy<FolderDownloadRepository>;
  let service: FolderDownloadCleanupService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    repository = mock<FolderDownloadRepository>();
    repository.expireReadyFolderDownloads.mockResolvedValue(2);
    service = new FolderDownloadCleanupService(repository);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['minimum', 0, 1],
    ['unchanged', 100, 100],
    ['maximum', 10_000, 1_000],
  ] as const)('uses the %s cleanup batch limit', async (_case, requested, expected) => {
    await expect(service.cleanExpiredDownloads(requested)).resolves.toBe(2);

    expect(repository.expireReadyFolderDownloads).toHaveBeenCalledExactlyOnceWith({
      expiredAt: NOW,
      limit: expected,
    });
  });
});
