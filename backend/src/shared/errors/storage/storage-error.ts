export type StorageOperation =
  | 'create_upload_url'
  | 'create_download_url'
  | 'head_object'
  | 'delete_object'
  | 'delete_objects';

export type StorageErrorContext = Readonly<{
  operation: StorageOperation;
  objectKey?: string;
  objectsCount?: number;
}>;

export abstract class StorageError extends Error {
  protected constructor(
    message: string,
    readonly context: StorageErrorContext,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}
