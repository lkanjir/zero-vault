import type { AuthorizationAction, EffectivePermission } from './authorization.js';

type PermissionMatrix = Readonly<
  Record<EffectivePermission, Readonly<Record<AuthorizationAction, boolean>>>
>;

export const permissionMatrix = {
  owner: {
    'entry:list': true,
    'entry:read': true,
    'entry:create': true,
    'entry:rename': true,
    'entry:move': true,
    'entry:delete': true,
    'file:download': true,
    'file:replace': true,
    'folder:download': true,
    'share:read': true,
    'share:manage': true,
    'audit:read': true,
  },

  editor: {
    'entry:list': false,
    'entry:read': true,
    'entry:create': false,
    'entry:rename': true,
    'entry:move': false,
    'entry:delete': false,
    'file:download': true,
    'file:replace': true,
    'folder:download': false,
    'share:read': false,
    'share:manage': false,
    'audit:read': true,
  },

  viewer: {
    'entry:list': false,
    'entry:read': true,
    'entry:create': false,
    'entry:rename': false,
    'entry:move': false,
    'entry:delete': false,
    'file:download': true,
    'file:replace': false,
    'folder:download': false,
    'share:read': false,
    'share:manage': false,
    'audit:read': true,
  },
} as const satisfies PermissionMatrix;
