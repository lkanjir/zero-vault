import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { FileGrantRepository } from '../../src/sharing/file-grant-repository.js';
import { FileGrantMaintenanceService } from '../../src/sharing/file-grant-maintenance-service.js';

const NOW = new Date('2026-08-02T10:00:00.000Z');

describe('FileGrantMaintenanceService', () => {
  let repository: MockProxy<FileGrantRepository>;
  let service: FileGrantMaintenanceService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    repository = mock<FileGrantRepository>();
    repository.maintainPending.mockResolvedValue({
      activatedCount: 2,
      deletedCount: 3,
    });
    service = new FileGrantMaintenanceService(repository);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['minimum', 0, 1],
    ['unchanged', 100, 100],
    ['maximum', 10_000, 1_000],
  ] as const)('uses the %s maintenance batch limit', async (_case, requested, expected) => {
    await expect(service.maintainPendingGrants(requested)).resolves.toStrictEqual({
      activatedCount: 2,
      deletedCount: 3,
    });

    expect(repository.maintainPending).toHaveBeenCalledExactlyOnceWith({
      processedAt: NOW,
      limit: expected,
    });
  });
});
