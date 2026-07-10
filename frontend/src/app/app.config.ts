import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import {
  LucideCloud,
  LucideFileText,
  LucidePanelLeft,
  LucidePanelLeftClose,
  LucidePlus,
  LucideSearch,
  LucideShare2,
  LucideUser,
  provideLucideIcons,
} from '@lucide/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideLucideIcons(
      LucideSearch,
      LucidePlus,
      LucideUser,
      LucideCloud,
      LucideShare2,
      LucidePanelLeft,
      LucidePanelLeftClose,
      LucideFileText,
    ),
  ],
};
