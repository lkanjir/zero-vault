import { randomUUID } from 'node:crypto';
import type { User } from '../../user/user.js';
import type { CreateFolderDownloadResponse } from './dto.js';
import type { FolderDownloadRepository } from './folder-download-repository.js';

export class FolderDownloadService {
  constructor(private readonly repository: FolderDownloadRepository) {}

  async createDownload(user: User, folderPublicId: string): Promise<CreateFolderDownloadResponse> {
    const downloadId = randomUUID();
    const createdAt = new Date();
    const archiveObjectKey = `folder-downloads/${user.publicId}/${downloadId}`;

    const download = await this.repository.create({
      downloadId,
      ownerId: user.id,
      folderPublicId,
      archiveObjectKey,
      createdAt,
    });

    return {
      downloadId: download.downloadId,
      fileName: `${download.folderName}.zip`,
      status: 'queued',
    };
  }
}
