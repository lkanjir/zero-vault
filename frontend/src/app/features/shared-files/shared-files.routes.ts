import { Routes } from '@angular/router';
import { SharedFiles } from './shared-files';
import { SharedFileStore } from './state/shared-files-store';

export const SharedFilesRoutes: Routes = [
  { path: '', component: SharedFiles, providers: [SharedFileStore] },
];
