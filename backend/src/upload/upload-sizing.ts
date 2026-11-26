export const MAX_UPLOAD_SIZE_BYTES = 512 * 1024 * 1024 * 1024; // 512 GiB
export const SINGLE_PART_MAX_BYTES = 16 * 1024 * 1024; // 16 MiB
export const MULTIPART_STANDARD_PART_SIZE_BYTES = 16 * 1024 * 1024; // 16 MiB
export const MULTIPART_LARGE_PART_SIZE_BYTES = 64 * 1024 * 1024; // 64 MiB
export const MAX_MULTIPART_PARTS = 10_000;
export const MULTIPART_STANDARD_MAX_BYTES =
  MULTIPART_STANDARD_PART_SIZE_BYTES * MAX_MULTIPART_PARTS; // 160,000 MiB (156.25 GiB)
export const MAX_PRESIGN_PARTS_BATCH = 50;

export type UploadPlan =
  | {
      uploadMode: 'single';
      partSizeBytes: null;
      partCount: null;
    }
  | {
      uploadMode: 'multipart';
      partSizeBytes: number;
      partCount: number;
    };

export function computeUploadPlan(sizeBytes: number): UploadPlan {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error('Invalid upload size');
  }

  if (sizeBytes <= SINGLE_PART_MAX_BYTES) {
    return {
      uploadMode: 'single',
      partSizeBytes: null,
      partCount: null,
    };
  }

  const partSizeBytes =
    sizeBytes <= MULTIPART_STANDARD_MAX_BYTES
      ? MULTIPART_STANDARD_PART_SIZE_BYTES
      : MULTIPART_LARGE_PART_SIZE_BYTES;
  const partCount = Math.ceil(sizeBytes / partSizeBytes);

  return {
    uploadMode: 'multipart',
    partSizeBytes,
    partCount,
  };
}

export function getExpectedPartSizeBytes(
  totalSizeBytes: number,
  partSizeBytes: number,
  partCount: number,
  partNumber: number,
): number {
  if (
    !Number.isSafeInteger(partNumber) ||
    !Number.isSafeInteger(partCount) ||
    !Number.isSafeInteger(partSizeBytes) ||
    !Number.isSafeInteger(totalSizeBytes) ||
    partSizeBytes <= 0 ||
    partCount < 2 ||
    partNumber < 1 ||
    partNumber > partCount
  ) {
    throw new Error('Invalid multipart part parameters');
  }

  if (partNumber < partCount) {
    return partSizeBytes;
  }

  return totalSizeBytes - (partCount - 1) * partSizeBytes;
}
