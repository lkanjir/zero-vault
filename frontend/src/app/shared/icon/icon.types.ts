export const appIconNames = [
  'search',
  'plus',
  'cloud',
  'user',
  'share-2',
  'panel-left',
  'panel-left-close',
] as const;

export type AppIconName = (typeof appIconNames)[number];
