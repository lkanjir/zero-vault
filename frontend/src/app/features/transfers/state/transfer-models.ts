import { ApiError } from '../../../shared/api-error';

export type TransferPhase = 'preparing' | 'uploading' | 'finalizing' | 'completed' | 'failed';

export type TransferFailure = ApiError & {
  message: string;
};

export type UploadTransfer = {
  id: string;
  uploadId: string | null;
  targetParentId: string | null;
  fileName: string;
  sizeBytes: number;
  phase: TransferPhase;
  progress: number | null;
  bytesPerSecond: number | null;
  error: TransferFailure | null;
};
