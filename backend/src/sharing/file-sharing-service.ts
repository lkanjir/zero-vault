import type { AuthorizationService } from '../authorization/authorization-service.js';
import type { User } from '../user/user.js';
import type { FileGrantRepository } from './file-grant-repository.js';
import type { FileGrantPermission } from './file-grant.js';
import { AppError } from '../shared/errors/api/app-error.js';
import type { ListFileSharesRequest } from '../files/validation-schemas.js';
import type { FileShareListResponse } from '../files/dto.js';
import { decodeFileGrantListCursor, encodeFileGrantListCursor } from './file-grant-list-cursor.js';

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
}
