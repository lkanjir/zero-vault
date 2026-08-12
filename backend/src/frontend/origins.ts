import { config } from '../config.js';

export const oidcOrigin = new URL(config.oidc.issuer).origin;
export const storageOrigin = new URL(config.s3.endpoint).origin;
