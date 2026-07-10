export const appIconNames = [
  'search',
  'plus',
  'cloud',
  'user',
  'share-2',
  'panel-left',
  'panel-left-close',
  'file-text',
  'download',
  'square-pen',
  'move',
  'trash',
  'folder-up',
  'folder-open',
] as const;

export type AppIconName = (typeof appIconNames)[number];
