import { AppError } from '../shared/errors/api/app-error.js';
import type { ObjectMetadata, ObjectMetadataWithChecksum } from '../storage/object-storage.js';
import type { UploadIntent } from './upload-intent.js';

export function assertObjectKeyMatches(intent: UploadIntent, object: ObjectMetadata) {
  if (object.objectKey !== intent.objectKey) {
    throw new AppError('internal_server_error', {
      context: {
        expectedObjectKey: intent.objectKey,
        actualObjectKey: object.objectKey,
      },
    });
  }
}

export function assertChecksumExists(
  object: ObjectMetadata,
): asserts object is ObjectMetadataWithChecksum {
  if (!object.sha256Hex) {
    throw new AppError('upload_checksum_missing');
  }
}

export function assertChecksumMatches(intent: UploadIntent, object: ObjectMetadata) {
  if (object.sha256Hex !== intent.expectedSha256) {
    throw new AppError('upload_checksum_mismatch');
  }
}

export function assertSizeMatches(intent: UploadIntent, object: ObjectMetadata) {
  if (object.sizeBytes !== intent.expectedSizeBytes) {
    throw new AppError('upload_size_mismatch');
  }
}

export function assertContentTypeMatches(intent: UploadIntent, object: ObjectMetadata) {
  if (object.contentType !== intent.contentType) {
    throw new AppError('upload_content_type_mismatch');
  }
}
