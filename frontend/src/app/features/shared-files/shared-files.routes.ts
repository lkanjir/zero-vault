import { Routes } from '@angular/router';
import { SharedFiles } from './shared-files';
import { SharedWithMeStore } from './state/shared-with-me-store';

export const SharedFilesRoutes: Routes = [
  { path: '', component: SharedFiles, providers: [SharedWithMeStore] },
];
