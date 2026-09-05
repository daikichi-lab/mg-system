import { defineConfig } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 3021
const E2E_DB = join(process.cwd(), 'server', 'data', 'e2e.db')

// Chromium の実行ファイルを探す。
// バージョン付きディレクトリ（chromium-1234 など）は Playwright の更新で変わり、古いものは消されるため、
// 直書きせずキャッシュにある chromium-* のうち番号が最新のものを使う。
// 置き場所は PLAYWRIGHT_BROWSERS_PATH があればそこ、無ければ ~/.cache/ms-playwright。
function findChrome(): string {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.HOME || '', '.cache/ms-playwright')
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)) : []
  dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) // 番号の大きい（新しい）順
  for (const d of dirs) {
    // 配置は版によって chrome-linux64／chrome-linux の2種類がある
    for (const sub of ['chrome-linux64', 'chrome-linux']) {
      const exe = join(root, d, sub, 'chrome')
      if (existsSync(exe)) return exe
    }
  }
  throw new Error(
    `Chromium が見つかりません（${root}）。次を実行してください: PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright npx playwright install chromium`,
  )
}
const CHROME = findChrome()

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
