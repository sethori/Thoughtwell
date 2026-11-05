import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the real app in a browser. Start the stack first
 * (`pnpm dev`, or `docker compose up`), then run `pnpm test:e2e`.
 * E2E_BASE_URL, E2E_USERNAME and E2E_PASSWORD point it at your instance.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
});
