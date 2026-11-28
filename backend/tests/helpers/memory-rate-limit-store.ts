import { MemoryStore } from 'express-rate-limit';
import type { RateLimitStoreFactory } from '../../src/shared/http/rate-limit/rate-limit-store.js';

export function createMemoryRateLimitStoreFactory(): RateLimitStoreFactory {
  return () => new MemoryStore();
}
