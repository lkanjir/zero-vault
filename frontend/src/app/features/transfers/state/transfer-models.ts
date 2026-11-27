import { ApiError } from '../../../shared/api-error';

export type TransferPhase =
  'preparing' | 'uploading' | 'finalizing' | 'completed' | 'failed' | 'cancelled';

export type TransferFailure = ApiError & {
  message: string;
};

export type TransferOperation = 'create' | 'replace';

export type FileUploadTransfer = {
  kind: 'file';
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

export type FolderTransferFileError = {
  relativePath: string;
  fileName: string;
  code: string;
  message: string;
};

export type FolderUploadTransfer = {
  kind: 'folder';
  id: string;
  folderName: string;
  totalSizeBytes: number;
  uploadedBytes: number;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  totalFolders: number;
  phase: TransferPhase;
  progress: number | null;
  bytesPerSecond: number | null;
  error: TransferFailure | null;
  fileErrors: readonly FolderTransferFileError[];
};

export type UploadTransfer = FileUploadTransfer | FolderUploadTransfer;

export type FolderUploadResult = {
  ok: boolean;
  createdFolders: boolean;
  completedFiles: number;
  failedFiles: number;
  cancelled: boolean;
  error: TransferFailure | null;
};
