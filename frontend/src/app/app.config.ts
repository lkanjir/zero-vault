import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import {
  LucideCloud,
  LucideDownload,
  LucideFileText,
  LucideMove,
  LucidePanelLeft,
  LucidePanelLeftClose,
  LucidePlus,
  LucideSearch,
  LucideShare2,
  LucideSquarePen,
  LucideTrash,
  LucideUser,
  provideLucideIcons,
} from '@lucide/angular';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { AuthService } from './auth/auth-service';
import { authInterceptor } from './auth/auth-interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppInitializer(() => inject(AuthService).initialize()),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
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
    ),
  ],
};
