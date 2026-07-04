export const appIconNames = ['search', 'plus', 'cloud', 'user', 'share-2', 'panel-left'] as const;

export type AppIconName = (typeof appIconNames)[number];
