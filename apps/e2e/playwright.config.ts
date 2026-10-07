import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against real servers (docs/13-testing-strategy.md).
 *  - WEB_URL / API_URL point at running instances (local, CI or staging).
 *  - E2E_START_SERVERS=1 starts the built API and web app from this repo (used in CI).
 * Test data is synthetic only (D-05).
 */
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const startServers = process.env.E2E_START_SERVERS === '1';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Optional: use a pre-installed Chromium (e.g. restricted networks where browser downloads are blocked).
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
      : {}),
  },
  metadata: { apiUrl: API_URL },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: startServers
    ? [
        {
          command: 'pnpm --filter @smartcode/api start',
          url: `${API_URL}/health/live`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: 'pnpm --filter @smartcode/web start',
          url: WEB_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ]
    : undefined,
});
