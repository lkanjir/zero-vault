import type { Store } from 'express-rate-limit';

export type RateLimitStoreFactory = (identifier: string) => Store;
