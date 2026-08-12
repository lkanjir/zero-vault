import { createAuthenticatedRateLimiter } from './authenticated-rate-limiter.js';

const ONE_MINUTE_MS = 60_000;
const TEN_MINUTES_MS = 10 * ONE_MINUTE_MS;

export const uploadIntentRateLimiter = createAuthenticatedRateLimiter({
  identifier: 'upload-intent',
  windowMs: ONE_MINUTE_MS,
  limit: 120,
});

export const uploadCompletionRateLimiter = createAuthenticatedRateLimiter({
  identifier: 'upload-completion',
  windowMs: ONE_MINUTE_MS,
  limit: 120,
});

export const fileDownloadRateLimiter = createAuthenticatedRateLimiter({
  identifier: 'file-download',
  windowMs: ONE_MINUTE_MS,
  limit: 60,
});

export const folderDownloadRateLimiter = createAuthenticatedRateLimiter({
  identifier: 'folder-download',
  windowMs: TEN_MINUTES_MS,
  limit: 10,
});

export const sharingMutationRateLimiter = createAuthenticatedRateLimiter({
  identifier: 'sharing-mutation',
  windowMs: ONE_MINUTE_MS,
  limit: 30,
});
