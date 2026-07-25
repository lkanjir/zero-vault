export type FileDownloadResponse = {
  fileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
  expiresInSeconds: number;
};
