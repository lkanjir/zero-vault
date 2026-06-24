import { Routes } from '@angular/router';
import { Shell } from './core/layout/shell/shell';
import { FilesPage } from './features/files/files-page/files-page';
import { SharedPage } from './features/share/shared-page/shared-page';
import { AccountPage } from './features/account/account-page/account-page';

export const routes: Routes = [{
    path: '',
    component: Shell,
    children: [
        { path: '', pathMatch: 'full', redirectTo: 'files'},
        {path: 'files', component: FilesPage},
        {path: 'shared', component: SharedPage},
        {path: 'account', component: AccountPage}
    ]
}];
