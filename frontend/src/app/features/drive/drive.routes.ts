import { Routes } from '@angular/router';
import { Drive } from './drive';

export const DriveRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    component: Drive,
  },
  {
    path: ':folderId',
    component: Drive,
  },
];
