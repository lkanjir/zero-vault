import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import {
  LucideArrowUpDown,
  LucideChevronDown,
  LucideChevronRight,
  LucideCloud,
  LucideDownload,
  LucideFileText,
  LucideFolder,
  LucideFolderOpen,
  LucideFolderUp,
  LucideLogOut,
  LucideMove,
  LucidePanelLeft,
  LucidePanelLeftClose,
  LucidePencil,
  LucidePlus,
  LucideSearch,
  LucideShare2,
  LucideSquarePen,
  LucideTrash,
  LucideTrash2,
  LucideUser,
  LucideX,
  provideLucideIcons,
} from '@lucide/angular';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { AuthService } from './auth/auth-service';
import { authInterceptor } from './auth/auth-interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppInitializer(() => inject(AuthService).initialize()),
    provideRouter(routes),
    provideHttpClient(withXhr(), withInterceptors([authInterceptor])),
    provideLucideIcons(
      LucideSearch,
      LucidePlus,
      LucideUser,
      LucideCloud,
      LucideShare2,
      LucidePanelLeft,
      LucidePanelLeftClose,
      LucideFileText,
      LucideDownload,
      LucideSquarePen,
      LucideMove,
      LucideTrash,
      LucideFolderUp,
      LucideFolderOpen,
      LucideArrowUpDown,
      LucideX,
      LucideFolder,
      LucideChevronRight,
      LucidePencil,
      LucideTrash2,
      LucideLogOut,
      LucideChevronDown,
    ),
  ],
};
