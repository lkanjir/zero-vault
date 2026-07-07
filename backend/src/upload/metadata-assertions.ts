import { ConflictError } from '../shared/errors/conflict-error.js';
import type { ObjectMetadata, ObjectMetadataWithChecksum } from '../storage/object-storage.js';
import type { UploadIntent } from './upload-intent.js';

export function assertObjectKeyMatches(intent: UploadIntent, object: ObjectMetadata) {
  if (object.objectKey !== intent.objectKey) {
    throw new ConflictError('Uploaded object key does not match intent');
  }
}

export function assertChecksumExists(
  object: ObjectMetadata,
): asserts object is ObjectMetadataWithChecksum {
  if (!object.sha256Hex) {
    throw new ConflictError('Uploaded object has no SHA-256 checksum');
  }
}

export function assertChecksumMatches(intent: UploadIntent, object: ObjectMetadata) {
  if (object.sha256Hex !== intent.expectedSha256) {
    throw new ConflictError('Uploaded object checksum does not match intent');
  }
}

export function assertSizeMatches(intent: UploadIntent, object: ObjectMetadata) {
  if (object.size !== intent.expectedSizeBytes) {
    throw new ConflictError('Uploaded object size does not match intent');
  }
}

export function assertContentTypeMatches(intent: UploadIntent, object: ObjectMetadata) {
  if (object.contentType !== intent.contentType) {
    throw new ConflictError('Uploaded object content type does not match intent');
  }
}
