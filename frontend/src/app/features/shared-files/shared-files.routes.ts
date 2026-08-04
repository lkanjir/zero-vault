import { Routes } from '@angular/router';
import { SharedWithMeFiles } from './shared-with-me-files';
import { SharedWithMeStore } from './state/shared-with-me-store';
import { SharedByMeFiles } from './shared-by-me-files';
import { SharedByMeStore } from './state/shared-by-me-store';

export const SharedFilesRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'with-me' },
  {
    path: 'with-me',
    component: SharedWithMeFiles,
    providers: [SharedWithMeStore],
  },
  { path: 'by-me', component: SharedByMeFiles, providers: [SharedByMeStore] },
];
