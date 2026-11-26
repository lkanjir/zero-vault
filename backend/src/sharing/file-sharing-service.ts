import type { AuditRepository } from '../audit/audit-repository.js';
import type { AuthorizationService } from '../authorization/authorization-service.js';
import type { EntryAuthorizer } from '../authorization/entry-authorizer.js';
import type { UnitOfWork } from '../db/unit-of-work.js';
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
    private readonly unitOfWork: UnitOfWork,
    private readonly authzService: AuthorizationService,
    private readonly entryAuthorizer: EntryAuthorizer,
    private readonly grantRepository: FileGrantRepository,
    private readonly auditRepository: AuditRepository,
    private readonly accessMapper: EntryAccessMapper,
  ) {}

  async shareFile(user: User, filePublicId: string, command: ShareFileCommand): Promise<void> {
    const submittedAt = new Date();

    if (command.expiresAt !== null && command.expiresAt.getTime() <= submittedAt.getTime()) {
      throw new AppError('invalid_grant_expiry');
    }

    const maximumActivationDeadline = new Date(
      submittedAt.getTime() + PENDING_ACTIVATION_WINDOW_MS,
    );
    const pendingActivationDeadline =
      command.expiresAt !== null &&
      command.expiresAt.getTime() < maximumActivationDeadline.getTime()
        ? command.expiresAt
        : maximumActivationDeadline;

    await this.unitOfWork.run(async (tx) => {
      const { entry: file } = await this.entryAuthorizer.authorizeForUpdate(
        {
          actorUserId: user.id,
          entryPublicId: filePublicId,
          actions: ['share:manage'],
        },
        tx,
      );

      if (command.recipientEmail === user.email) {
        throw new AppError('cannot_share_with_self');
      }

      const savedGrant = await this.grantRepository.save(
        {
          fileId: file.id,
          createdByUserId: file.ownerId,
          recipientEmail: command.recipientEmail,
          permission: command.permission,
          expiresAt: command.expiresAt,
          submittedAt,
          pendingActivationDeadline,
        },
        tx,
      );

      await this.auditRepository.record(
        {
          ownerId: file.ownerId,
          actorUserId: user.id,
          entryId: file.id,
          entryNameSnapshot: file.name,
          action: 'file.share_submitted',
          details: {
            shareId: savedGrant.publicId,
            recipientEmail: savedGrant.recipientEmail,
            permission: savedGrant.permission,
            expiresAt: savedGrant.expiresAt?.toISOString() ?? null,
          },
          occurredAt: submittedAt,
        },
        tx,
      );
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
    const revokedAt = new Date();

    await this.unitOfWork.run(async (tx) => {
      const { entry: file } = await this.entryAuthorizer.authorizeForUpdate(
        {
          actorUserId: user.id,
          entryPublicId: filePublicId,
          actions: ['share:manage'],
        },
        tx,
      );

      const revokedGrant = await this.grantRepository.revoke(
        {
          fileId: file.id,
          grantPublicId: shareId,
        },
        tx,
      );

      if (!revokedGrant) {
        return;
      }

      await this.auditRepository.record(
        {
          ownerId: file.ownerId,
          actorUserId: user.id,
          entryId: file.id,
          entryNameSnapshot: file.name,
          action: 'file.share_revoked',
          details: {
            shareId: revokedGrant.publicId,
            recipientEmail: revokedGrant.recipientEmail,
            permission: revokedGrant.permission,
            expiresAt: revokedGrant.expiresAt?.toISOString() ?? null,
          },
          occurredAt: revokedAt,
        },
        tx,
      );
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

    const grant = await this.unitOfWork.run(async (tx) => {
      const { entry: file } = await this.entryAuthorizer.authorizeForUpdate(
        {
          actorUserId: user.id,
          entryPublicId: filePublicId,
          actions: ['share:manage'],
        },
        tx,
      );

      const result = await this.grantRepository.update(
        {
          fileId: file.id,
          grantPublicId: shareId,
          permission: request.permission,
          expiresAt: request.expiresAt,
          updatedAt,
        },
        tx,
      );

      if (result === null) {
        throw new AppError('file_share_not_found');
      }

      const permissionChanged = result.previous.permission !== result.updated.permission;
      const expiryChanged =
        result.previous.expiresAt?.getTime() !== result.updated.expiresAt?.getTime();

      if (permissionChanged || expiryChanged) {
        await this.auditRepository.record(
          {
            ownerId: file.ownerId,
            actorUserId: user.id,
            entryId: file.id,
            entryNameSnapshot: file.name,
            action: 'file.share_updated',
            details: {
              shareId: result.updated.publicId,
              recipientEmail: result.updated.recipientEmail,
              previousPermission: result.previous.permission,
              newPermission: result.updated.permission,
              previousExpiresAt: result.previous.expiresAt?.toISOString() ?? null,
              newExpiresAt: result.updated.expiresAt?.toISOString() ?? null,
            },
            occurredAt: updatedAt,
          },
          tx,
        );
      }

      return result.updated;
    });

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
