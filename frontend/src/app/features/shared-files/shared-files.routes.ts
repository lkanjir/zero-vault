import { Routes } from '@angular/router';
import { SharedWithMeFiles } from './shared-with-me-files';
import { SharedWithMeStore } from './state/shared-with-me-store';
import { SharedByMeFiles } from './shared-by-me-files';
import { SharedByMeStore } from './state/shared-by-me-store';
import { SharedFilesLayout } from './shared-files-layout';

export const SharedFilesRoutes: Routes = [
  {
    path: '',
    component: SharedFilesLayout,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'with-me' },
      {
        path: 'with-me',
        component: SharedWithMeFiles,
        providers: [SharedWithMeStore],
      },
      { path: 'by-me', component: SharedByMeFiles, providers: [SharedByMeStore] },
    ],
  },
];
