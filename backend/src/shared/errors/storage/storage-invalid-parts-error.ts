import { StorageError, type StorageErrorContext } from './storage-error.js';

export class StorageInvalidPartsError extends StorageError {
  constructor(context: StorageErrorContext, options?: ErrorOptions) {
    super('Multipart upload parts are invalid or do not match object storage', context, options);
  }
}
