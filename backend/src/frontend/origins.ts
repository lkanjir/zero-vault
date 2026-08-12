import { config } from '../config.js';

export const oidcOrigin = new URL(config.oidc.issuer).origin;
export const storageOrigin = config.s3.publicOrigin;
