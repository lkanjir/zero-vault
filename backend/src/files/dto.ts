export type DownloadResponse = {
  fileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
  expiresInSeconds: number;
};
