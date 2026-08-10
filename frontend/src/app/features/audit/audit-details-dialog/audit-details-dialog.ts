import { Component, inject } from '@angular/core';
import { AuditEvent } from '../../../data-access/audit/audit-model';
import { DatePipe } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { AUDIT_ACTION_LABELS } from '../audit-action-labels';
import { createAuditDetailRows } from './audit-detail-rows';
import { Icon } from '../../../shared/icon/icon';

export type AuditDetailsDialogData = {
  event: AuditEvent;
};

@Component({
  selector: 'app-audit-details-dialog',
  imports: [DatePipe, Icon],
  templateUrl: './audit-details-dialog.html',
})
export class AuditDetailsDialog {
  private readonly dialogRef = inject(DialogRef);

  readonly data = inject<AuditDetailsDialogData>(DIALOG_DATA);
  readonly actionLabel = AUDIT_ACTION_LABELS[this.data.event.action];
  readonly detailRows = createAuditDetailRows(this.data.event);

  closeDialog(): void {
    this.dialogRef.close();
  }
}
