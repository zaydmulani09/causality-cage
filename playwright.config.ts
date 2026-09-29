import { defineConfig } from '@playwright/test';

// Browser integration tests. They start the example shop themselves.
export default defineConfig({
  testDir: 'tests/integration',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
});
