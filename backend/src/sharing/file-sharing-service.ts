import type { AuthorizationService } from '../authorization/authorization-service.js';
import type { User } from '../user/user.js';
import type { FileGrantRepository } from './file-grant-repository.js';
import type { FileGrantPermission } from './file-grant.js';
import { AppError } from '../shared/errors/api/app-error.js';

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
}
