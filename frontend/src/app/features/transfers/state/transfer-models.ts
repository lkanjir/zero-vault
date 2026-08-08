import { ApiError } from '../../../shared/api-error';

export type TransferPhase = 'preparing' | 'uploading' | 'finalizing' | 'completed' | 'failed';

export type TransferFailure = ApiError & {
  message: string;
};

export type TransferOperation = 'create' | 'replace';

export type UploadTransfer = {
  id: string;
  uploadId: string | null;
  operation: TransferOperation;
  fileName: string;
  sizeBytes: number;
  phase: TransferPhase;
  progress: number | null;
  bytesPerSecond: number | null;
  error: TransferFailure | null;
};
