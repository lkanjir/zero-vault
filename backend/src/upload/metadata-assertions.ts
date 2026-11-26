import { AppError } from '../shared/errors/api/app-error.js';
import type {
  ObjectChecksum,
  ObjectMetadata,
  ObjectMetadataWithChecksum,
} from '../storage/object-storage.js';
import type { UploadIntent } from './upload-intent.js';

export function assertObjectKeyMatches(intent: UploadIntent, object: ObjectMetadata) {
  if (object.objectKey !== intent.objectKey) {
    throw new AppError('internal_server_error', {
      context: {
        uploadId: intent.uploadId,
        expectedObjectKey: intent.objectKey,
        actualObjectKey: object.objectKey,
      },
    });
  }
}

export function assertChecksumExists(
  intent: UploadIntent,
  object: ObjectMetadata,
): asserts object is ObjectMetadataWithChecksum {
  if (!object.checksum) {
    throw new AppError('upload_checksum_missing', {
      context: {
        uploadId: intent.uploadId,
        objectKey: intent.objectKey,
      },
    });
  }
}

export function assertChecksumMatches(
  intent: UploadIntent,
  object: ObjectMetadataWithChecksum,
  expectedChecksum: ObjectChecksum,
) {
  if (
    object.checksum.type !== expectedChecksum.type ||
    object.checksum.value !== expectedChecksum.value
  ) {
    throw new AppError('upload_checksum_mismatch', {
      context: {
        uploadId: intent.uploadId,
        objectKey: intent.objectKey,
        objectChecksumType: object.checksum.type,
        objectHash: object.checksum.value,
        intentChecksumType: expectedChecksum.type,
        intentHash: expectedChecksum.value,
      },
    });
  }
}

export function assertSizeMatches(intent: UploadIntent, object: ObjectMetadata) {
  if (object.sizeBytes !== intent.expectedSizeBytes) {
    throw new AppError('upload_size_mismatch', {
      context: {
        uploadId: intent.uploadId,
        objectKey: intent.objectKey,
        objectSize: object.sizeBytes,
        intentSize: intent.expectedSizeBytes,
      },
    });
  }
}

export function assertContentTypeMatches(intent: UploadIntent, object: ObjectMetadata) {
  if (object.contentType !== intent.contentType) {
    throw new AppError('upload_content_type_mismatch', {
      context: {
        uploadId: intent.uploadId,
        objectKey: intent.objectKey,
        objectContentType: object.contentType,
        intentContentType: intent.contentType,
      },
    });
  }
}
