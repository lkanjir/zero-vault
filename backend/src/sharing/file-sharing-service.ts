import type { AuthorizationService } from '../authorization/authorization-service.js';
import type { User } from '../user/user.js';
import type { FileGrantRepository, SharedFileRecord } from './file-grant-repository.js';
import type { FileGrantPermission } from './file-grant.js';
import { AppError } from '../shared/errors/api/app-error.js';
import type {
  ListFileSharesRequest,
  ListSharedByMeFilesRequest,
  ListSharedFilesRequest,
  UpdateFileShareRequest,
} from '../files/validation-schemas.js';
import type {
  FileShareListResponse,
  FileShareResponse,
  SharedByMeFileListResponse,
  SharedFileListResponse,
  SharedFileResponse,
} from '../files/dto.js';
import { decodeFileGrantListCursor, encodeFileGrantListCursor } from './file-grant-list-cursor.js';
import type { EntryAccessMapper } from '../authorization/entry-access-mapper.js';
import {
  decodeSharedFileListCursor,
  encodeSharedFileListCursor,
} from './shared-file-list-cursor.js';

const PENDING_ACTIVATION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export type ShareFileCommand = {
  recipientEmail: string;
  permission: FileGrantPermission;
  expiresAt: Date | null;
};

export class FileSharingService {
  constructor(
    private readonly authzService: AuthorizationService,
    private readonly grantRepository: FileGrantRepository,
    private readonly accessMapper: EntryAccessMapper,
  ) {}

  async shareFile(user: User, filePublicId: string, command: ShareFileCommand): Promise<void> {
    const submittedAt = new Date();

    if (command.expiresAt !== null && command.expiresAt.getTime() <= submittedAt.getTime()) {
      throw new AppError('invalid_grant_expiry');
    }

    await this.authzService.authorizeEntryByPublicId({
      actorUserId: user.id,
      entryPublicId: filePublicId,
      action: 'share:manage',
    });

    if (command.recipientEmail === user.email) {
      return;
    }

    const maximumActivationDeadline = new Date(
      submittedAt.getTime() + PENDING_ACTIVATION_WINDOW_MS,
    );
    const pendingActivationDeadline =
      command.expiresAt !== null &&
      command.expiresAt.getTime() < maximumActivationDeadline.getTime()
        ? command.expiresAt
        : maximumActivationDeadline;

    await this.grantRepository.save({
      actorUserId: user.id,
      filePublicId,
      recipientEmail: command.recipientEmail,
      permission: command.permission,
      expiresAt: command.expiresAt,
      submittedAt,
      pendingActivationDeadline,
    });
  }

  async listFileShares(
    user: User,
    filePublicId: string,
    request: ListFileSharesRequest,
  ): Promise<FileShareListResponse> {
    const cursor = request.cursor === null ? null : decodeFileGrantListCursor(request.cursor);

    if (cursor !== null && cursor.filePublicId !== filePublicId) {
      throw new AppError('invalid_cursor', {
        context: {
          reason: 'file_mismatch',
          cursorFileId: cursor.filePublicId,
          requestedFileId: filePublicId,
        },
      });
    }

    const authorization = await this.authzService.authorizeEntryByPublicId({
      actorUserId: user.id,
      entryPublicId: filePublicId,
      action: 'share:read',
    });

    const grants = await this.grantRepository.listByFileId({
      fileId: authorization.context.resource.id,
      cursor:
        cursor === null
          ? null
          : { recipientEmail: cursor.recipientEmail, grantDbId: cursor.grantDbId },
      limit: request.limit + 1,
    });

    const pageGrants = grants.slice(0, request.limit);
    const hasMore = grants.length > request.limit;
    const lastGrant = pageGrants.at(-1);

    const nextCursor =
      hasMore && lastGrant
        ? encodeFileGrantListCursor({
            v: 1,
            filePublicId,
            recipientEmail: lastGrant.recipientEmail,
            grantDbId: lastGrant.id,
          })
        : null;

    return {
      items: pageGrants.map((grant) => ({
        shareId: grant.publicId,
        recipientEmail: grant.recipientEmail,
        permission: grant.permission,
        expiresAt: grant.expiresAt?.toISOString() ?? null,
      })),
      page: {
        limit: request.limit,
        hasMore,
        nextCursor,
      },
    };
  }

  async revokeFileShare(user: User, filePublicId: string, shareId: string): Promise<void> {
    await this.grantRepository.revoke({
      actorUserId: user.id,
      filePublicId,
      grantPublicId: shareId,
    });
  }

  async updateFileShare(
    user: User,
    filePublicId: string,
    shareId: string,
    request: UpdateFileShareRequest,
  ): Promise<FileShareResponse> {
    const updatedAt = new Date();

    if (
      request.expiresAt !== undefined &&
      request.expiresAt !== null &&
      request.expiresAt.getTime() <= updatedAt.getTime()
    ) {
      throw new AppError('invalid_grant_expiry');
    }

    const grant = await this.grantRepository.update({
      actorUserId: user.id,
      filePublicId,
      grantPublicId: shareId,
      permission: request.permission,
      expiresAt: request.expiresAt,
      updatedAt,
    });

    if (grant === null) {
      throw new AppError('file_share_not_found');
    }

    return {
      shareId: grant.publicId,
      recipientEmail: grant.recipientEmail,
      permission: grant.permission,
      expiresAt: grant.expiresAt?.toISOString() ?? null,
    };
  }

  async listSharedFiles(
    user: User,
    request: ListSharedFilesRequest,
  ): Promise<SharedFileListResponse> {
    const cursor = request.cursor === null ? null : decodeSharedFileListCursor(request.cursor);
    const listedAt = new Date();

    const records = await this.grantRepository.listSharedFiles({
      recipientUserId: user.id,
      listedAt,
      cursor,
      limit: request.limit + 1,
    });

    const pageRecords = records.slice(0, request.limit);
    const hasMore = records.length > request.limit;
    const lastRecord = pageRecords.at(-1);

    const nextCursor =
      hasMore && lastRecord ? encodeSharedFileListCursor({ v: 1, ...lastRecord.cursor }) : null;

    return {
      items: pageRecords.map((record) => this.toSharedFileResponse(user.id, record, listedAt)),
      page: {
        limit: request.limit,
        hasMore,
        nextCursor,
      },
    };
  }

  async listSharedByMeFiles(
    user: User,
    request: ListSharedByMeFilesRequest,
  ): Promise<SharedByMeFileListResponse> {
    const cursor = request.cursor === null ? null : decodeSharedFileListCursor(request.cursor);

    const records = await this.grantRepository.listOwnedSharedFiles({
      ownerId: user.id,
      cursor: cursor,
      limit: request.limit + 1,
    });

    const pageRecords = records.slice(0, request.limit);
    const hasMore = records.length > request.limit;
    const lastRecord = pageRecords.at(-1);

    const nextCursor =
      hasMore && lastRecord ? encodeSharedFileListCursor({ v: 1, ...lastRecord.cursor }) : null;

    return {
      items: pageRecords.map((record) => ({
        kind: 'file',
        id: record.file.id,
        name: record.file.name,
        contentType: record.file.contentType,
        sizeBytes: record.file.sizeBytes,
        updatedAt: record.file.updatedAt.toISOString(),
        shareCount: record.shareCount,
      })),
      page: {
        limit: request.limit,
        hasMore,
        nextCursor,
      },
    };
  }

  private toSharedFileResponse(
    actorUserId: number,
    record: SharedFileRecord,
    now: Date,
  ): SharedFileResponse {
    const access = this.accessMapper.map({
      scope: 'entry',
      actor: { userId: actorUserId },
      resource: {
        id: record.cursor.entryId,
        ownerId: record.owner.id,
        kind: 'file',
        deletedAt: null,
      },
      relationship: {
        grant: record.grant,
      },
      environment: {
        now,
      },
    });

    return {
      kind: 'file',
      id: record.file.id,
      name: record.file.name,
      contentType: record.file.contentType,
      sizeBytes: record.file.sizeBytes,
      updatedAt: record.file.updatedAt.toISOString(),
      owner: {
        email: record.owner.email,
        firstName: record.owner.firstName,
        lastName: record.owner.lastName,
      },
      expiresAt: record.grant.expiresAt?.toISOString() ?? null,
      access,
    };
  }
}
