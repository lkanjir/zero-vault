import { Routes } from '@angular/router';
import { Audit } from './audit';
import { AuditStore } from './state/audit-store';

export const AuditRoutes: Routes = [{ path: '', component: Audit, providers: [AuditStore] }];
