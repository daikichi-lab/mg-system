import { defineConfig } from '@playwright/test'
import { join } from 'node:path'

const PORT = 3021
const E2E_DB = join(process.cwd(), 'server', 'data', 'e2e.db')
const CHROME = join(process.env.HOME || '', '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome')

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    launchOptions: {
      executablePath: CHROME,
      args: ['--no-sandbox', '--disable-gpu'],
    },
    trace: 'off',
  },
  webServer: {
    command: 'node server/index.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60000,
    env: { PORT: String(PORT), MG_DB: E2E_DB },
  },
})
