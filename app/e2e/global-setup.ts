import { rmSync } from 'node:fs'
import { join } from 'node:path'

// E2E は毎回クリーンな DB で開始する
export default function globalSetup() {
  const base = join(process.cwd(), 'server', 'data')
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(join(base, 'e2e.db' + suffix), { force: true })
    } catch {
      /* ignore */
    }
  }
}
