import { Routes } from '@angular/router';
import { AppShell } from './layout/app-shell/app-shell';
import { DriveRoutes } from './features/drive/drive.routes';

export const routes: Routes = [
  {
    path: '',
    component: AppShell,
    children: [
      {
        path: 'drive',
        children: DriveRoutes,
      },
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'drive',
      },
      {
        path: '**',
        redirectTo: 'drive',
      },
    ],
  },
];
