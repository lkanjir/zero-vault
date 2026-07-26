export type StorageOperation =
  | 'create_upload_url'
  | 'create_download_url'
  | 'head_object'
  | 'get_object_stream'
  | 'upload_object_stream'
  | 'delete_object';

export type StorageErrorContext = Readonly<{
  operation: StorageOperation;
  objectKey?: string;
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
