import { StorageError, type StorageErrorContext } from './storage-error.js';

export class StorageObjectNotFoundError extends StorageError {
  constructor(context: StorageErrorContext, options?: ErrorOptions) {
    super('Object storage object was not found', context, options);
  }
}
