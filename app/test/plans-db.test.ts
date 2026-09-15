// 経営計画書の保存（companies.plans_json）の検証。
// 本番DBは列が増える前のスキーマなので、migrate() で列が追加されて既存の会社が残ることと、
// 「plans を送らない保存（古い画面）で計画が消えない」ことを実際の SQLite ファイルで確認する。
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dbPath = join(mkdtempSync(join(tmpdir(), 'mg-plans-')), 'old.db')

// 旧スキーマ（companies に plans_json が無い）で DB を作り、会社を1件入れておく
{
  const db = new DatabaseSync(dbPath)
  db.exec(`CREATE TABLE companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org TEXT NOT NULL, name TEXT NOT NULL, president TEXT DEFAULT '',
    period INTEGER DEFAULT 1, started INTEGER DEFAULT 0, settled INTEGER DEFAULT 0,
    opening_json TEXT DEFAULT '{}', seq INTEGER DEFAULT 1, updated_at INTEGER DEFAULT 0,
    UNIQUE(org, name)
  );`)
  db.prepare('INSERT INTO companies (org, name, president, period, started) VALUES (?, ?, ?, 2, 1)').run('OLD', '旧社', '社長')
  db.close()
}
process.env.MG_DB = dbPath

const { initDb, getCompanyRow, fullState, saveState } = await import('../server/db.js')

before(async () => {
  await initDb()
})

test('migrate：旧スキーマの companies に plans_json が追加され、既存の会社は残って plans は {}', async () => {
  const row = await getCompanyRow('OLD', '旧社')
  assert.ok(row, '既存の会社が消えていない')
  const s = await fullState(Number(row.id))
  assert.equal(s.company.name, '旧社')
  assert.deepEqual(s.company.plans, {})
})

test('saveState：plans は期ごとに保存され、plans を送らない保存では消えない', async () => {
  const row = await getCompanyRow('OLD', '旧社')
  const id = Number(row.id)
  const base = { president: '社長', period: 3, started: true, settled: false, opening: {}, seq: 5, entries: [], results: [] }
  await saveState(id, { ...base, plans: { 3: { g: 100, p: 32, v: 12, actions: [{ text: '仕入', amount: -50 }] } } })
  let s = await fullState(id)
  assert.equal(s.company.plans['3'].g, 100)
  assert.deepEqual(s.company.plans['3'].actions, [{ text: '仕入', amount: -50 }])

  // plans を知らない古い画面からの保存（キー無し）→ 計画は残る
  await saveState(id, base)
  s = await fullState(id)
  assert.equal(s.company.plans['3'].g, 100, 'plans 無しの保存で消えない')

  // 次の期の計画を足す（クライアントは全期分を送る）→ 前の期も残る
  await saveState(id, { ...base, period: 4, plans: { 3: { g: 100 }, 4: { g: 200 } } })
  s = await fullState(id)
  assert.equal(Object.keys(s.company.plans).length, 2)
  assert.equal(s.company.plans['4'].g, 200)
})
