import type { FolderResponse } from './dto.js';
import type { User } from '../user/user.js';
import type { EntryRepository } from '../entry/entry-repository.js';
import type { Folder } from './folder.js';
import type { CreateFolderRequestBody } from './validation-schemas.js';

export class FolderService {
  constructor(private readonly repo: EntryRepository) {}

  async createFolder(user: User, request: CreateFolderRequestBody): Promise<FolderResponse> {
    const folder = await this.repo.createFolder({
      name: request.name,
      actorUserId: user.id,
      parentId: request.parentId,
    });

    return this.toResponse(folder);
  }

  private toResponse(folder: Folder): FolderResponse {
    return {
      id: folder.publicId,
      kind: folder.kind,
      name: folder.name,
      updatedAt: folder.updatedAt.toISOString(),
    };
  }
}
