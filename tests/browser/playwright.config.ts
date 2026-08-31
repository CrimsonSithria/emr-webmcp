import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['specs/**/*.spec.ts', 'scenarios/**/*.spec.ts'],
  reporter: [['list'], ['./reporters/evaluation-reporter.ts']],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4177',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'yarn vite --config vite.config.ts --host 127.0.0.1 --port 4177 --strictPort',
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: !process.env.CI,
  },
});
