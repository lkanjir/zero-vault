import { describe, expect, it } from 'vitest';
import {
  computeUploadPlan,
  getExpectedPartSizeBytes,
  MAX_MULTIPART_PARTS,
  MAX_UPLOAD_SIZE_BYTES,
  MULTIPART_LARGE_PART_SIZE_BYTES,
  MULTIPART_STANDARD_MAX_BYTES,
  MULTIPART_STANDARD_PART_SIZE_BYTES,
  SINGLE_PART_MAX_BYTES,
} from '../../src/upload/upload-sizing.js';

describe('upload-sizing', () => {
  it('selects single-part mode for 0 B through 16 MiB inclusive', () => {
    expect(computeUploadPlan(0)).toStrictEqual({
      uploadMode: 'single',
      partSizeBytes: null,
      partCount: null,
    });
    expect(computeUploadPlan(1)).toStrictEqual({
      uploadMode: 'single',
      partSizeBytes: null,
      partCount: null,
    });
    expect(computeUploadPlan(SINGLE_PART_MAX_BYTES)).toStrictEqual({
      uploadMode: 'single',
      partSizeBytes: null,
      partCount: null,
    });
  });

  it('selects 16 MiB parts from 16 MiB + 1 up to 10,000 parts (156.25 GiB)', () => {
    expect(computeUploadPlan(SINGLE_PART_MAX_BYTES + 1)).toStrictEqual({
      uploadMode: 'multipart',
      partSizeBytes: MULTIPART_STANDARD_PART_SIZE_BYTES,
      partCount: 2,
    });
    expect(computeUploadPlan(MULTIPART_STANDARD_MAX_BYTES)).toStrictEqual({
      uploadMode: 'multipart',
      partSizeBytes: MULTIPART_STANDARD_PART_SIZE_BYTES,
      partCount: MAX_MULTIPART_PARTS,
    });
  });

  it('switches to 64 MiB parts above 10,000 x 16 MiB up to 512 GiB without exceeding S3 part limit', () => {
    const justAboveStandard = computeUploadPlan(MULTIPART_STANDARD_MAX_BYTES + 1);
    expect(justAboveStandard).toStrictEqual({
      uploadMode: 'multipart',
      partSizeBytes: MULTIPART_LARGE_PART_SIZE_BYTES,
      partCount: 2_501,
    });
    expect(justAboveStandard.partCount).toBeLessThanOrEqual(MAX_MULTIPART_PARTS);

    const maxPlan = computeUploadPlan(MAX_UPLOAD_SIZE_BYTES);
    expect(maxPlan).toStrictEqual({
      uploadMode: 'multipart',
      partSizeBytes: MULTIPART_LARGE_PART_SIZE_BYTES,
      partCount: 8_192,
    });
    expect(maxPlan.partCount).toBeLessThanOrEqual(MAX_MULTIPART_PARTS);
  });

  it('rejects negative, non-integer, and > 512 GiB sizes', () => {
    expect(() => computeUploadPlan(-1)).toThrow('Invalid upload size');
    expect(() => computeUploadPlan(1.5)).toThrow('Invalid upload size');
    expect(() => computeUploadPlan(MAX_UPLOAD_SIZE_BYTES + 1)).toThrow('Invalid upload size');
  });

  it('computes exact expected byte length for non-final and final parts', () => {
    const totalSize = SINGLE_PART_MAX_BYTES + 123;
    expect(getExpectedPartSizeBytes(totalSize, MULTIPART_STANDARD_PART_SIZE_BYTES, 2, 1)).toBe(
      MULTIPART_STANDARD_PART_SIZE_BYTES,
    );
    expect(getExpectedPartSizeBytes(totalSize, MULTIPART_STANDARD_PART_SIZE_BYTES, 2, 2)).toBe(123);

    expect(
      getExpectedPartSizeBytes(
        MAX_UPLOAD_SIZE_BYTES,
        MULTIPART_LARGE_PART_SIZE_BYTES,
        8_192,
        8_192,
      ),
    ).toBe(MULTIPART_LARGE_PART_SIZE_BYTES);
  });

  it('rejects out-of-range part numbers', () => {
    expect(() =>
      getExpectedPartSizeBytes(32 * 1024 * 1024, MULTIPART_STANDARD_PART_SIZE_BYTES, 2, 0),
    ).toThrow('Invalid multipart part parameters');
    expect(() =>
      getExpectedPartSizeBytes(32 * 1024 * 1024, MULTIPART_STANDARD_PART_SIZE_BYTES, 2, 3),
    ).toThrow('Invalid multipart part parameters');
  });
});
