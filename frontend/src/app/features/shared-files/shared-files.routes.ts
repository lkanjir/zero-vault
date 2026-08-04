import { Routes } from '@angular/router';
import { SharedWithMeFiles } from './shared-with-me-files';
import { SharedWithMeStore } from './state/shared-with-me-store';

export const SharedFilesRoutes: Routes = [
  { path: '', component: SharedWithMeFiles, providers: [SharedWithMeStore] },
];
