export const appIconNames = [
    'search',
    'plus',    
] as const;

export type AppIconName = (typeof appIconNames)[number];