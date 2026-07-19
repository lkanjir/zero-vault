import { StorageError, type StorageErrorContext } from './storage-error.js';

export class StorageUnavailableError extends StorageError {
  constructor(context: StorageErrorContext, options?: ErrorOptions) {
    super('Object storage operation failed', context, options);
  }
}
