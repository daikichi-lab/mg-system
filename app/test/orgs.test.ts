// 研修（組織）のマイグレーションと編集の検証。
//
// ここは本番データが入ったDBに対して走る処理なので、
//   ・旧スキーマ（name 列なし）のDBに列が追加されること
//   ・既存の組織・参加者データが消えないこと
//   ・名前が空の組織に「組織1」「組織2」が作成順で入ること
// を実際の SQLite ファイルで確認する。
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dbPath = join(mkdtempSync(join(tmpdir(), 'mg-orgs-')), 'old.db')

// 旧スキーマ（orgs に name が無い）でDBを作り、組織を2件入れておく
{
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE orgs (code TEXT PRIMARY KEY, created_at INTEGER DEFAULT 0);')
  db.prepare('INSERT INTO orgs (code, created_at) VALUES (?, ?)').run('MG-OLD-A', 1000)
  db.prepare('INSERT INTO orgs (code, created_at) VALUES (?, ?)').run('MG-OLD-B', 2000)
  db.close()
}
process.env.MG_DB = dbPath

const { initDb, listOrgs, updateOrg, registerOrg, joinCompany, listOrg, orgExists } = await import('../server/db.js')

before(async () => {
  await initDb()
})

test('migrate：旧スキーマに name 列が追加され、既存の組織は消えない', async () => {
  const orgs = await listOrgs()
  const codes = orgs.map((o) => o.code)
  assert.ok(codes.includes('MG-OLD-A'))
  assert.ok(codes.includes('MG-OLD-B'))
})

test('backfill：名前が空の組織に作成順で 組織1 / 組織2 が入る', async () => {
  const orgs = await listOrgs()
  const byCode = Object.fromEntries(orgs.map((o) => [o.code, o.name]))
  assert.equal(byCode['MG-OLD-A'], '組織1') // created_at が古い方
  assert.equal(byCode['MG-OLD-B'], '組織2')
})

test('backfill：すでに名前がある組織は上書きしない', async () => {
  await registerOrg('MG-NAMED', '第12期 経営研修')
  await initDb() // migrate をもう一度通す
  const orgs = await listOrgs()
  assert.equal(orgs.find((o) => o.code === 'MG-NAMED')?.name, '第12期 経営研修')
})

test('研修名は重複してよい', async () => {
  await registerOrg('MG-DUP-1', '同じ名前')
  await registerOrg('MG-DUP-2', '同じ名前')
  const orgs = await listOrgs()
  assert.equal(orgs.filter((o) => o.name === '同じ名前').length, 2)
})

test('改名：研修名だけを変える', async () => {
  const r = await updateOrg('MG-OLD-A', { name: '第1期 ケーキ店経営' })
  assert.equal(r.ok, true)
  assert.equal(r.org.code, 'MG-OLD-A')
  assert.equal(r.org.name, '第1期 ケーキ店経営')
})

test('研修URLの変更：参加者データも新しいコードへ移る', async () => {
  await registerOrg('MG-MOVE-FROM', '移動前')
  await joinCompany('MG-MOVE-FROM', 'ケーキ屋', '塩尻')
  assert.equal((await listOrg('MG-MOVE-FROM')).length, 1)

  const r = await updateOrg('MG-MOVE-FROM', { newCode: 'MG-MOVE-TO' })
  assert.equal(r.ok, true)
  assert.equal(r.org.code, 'MG-MOVE-TO')

  // 旧コードでは参加できず、新コードでデータが読める
  assert.equal(await orgExists('MG-MOVE-FROM'), false)
  assert.equal(await orgExists('MG-MOVE-TO'), true)
  assert.equal((await listOrg('MG-MOVE-FROM')).length, 0)
  const moved = await listOrg('MG-MOVE-TO')
  assert.equal(moved.length, 1)
  assert.equal(moved[0].name, 'ケーキ屋')
})

test('研修URLの変更：すでに使われているコードには変更できない', async () => {
  const r = await updateOrg('MG-OLD-B', { newCode: 'MG-OLD-A' })
  assert.equal(r.error, 'duplicate')
  // 失敗しても元のコードは残る
  assert.equal(await orgExists('MG-OLD-B'), true)
})

test('研修URLの変更：存在しない研修は not_found', async () => {
  const r = await updateOrg('MG-NOPE', { name: 'x' })
  assert.equal(r.error, 'not_found')
})
