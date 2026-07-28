import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    setupFiles: ['./tests/setup-env.ts'],
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
});
