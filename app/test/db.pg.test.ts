// Postgres 方言（本番DBパス）の検証：pglite（WASM版Postgres）に対して db 層を実行し、
// DDL・ON CONFLICT・$ プレースホルダ・FK CASCADE・round-trip が正しいことを確認する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import {
  initDb,
  makePgliteDriver,
  getOrgRules,
  joinCompany,
  saveState,
  fullState,
  listOrg,
  listOrgs,
  deleteCompany,
  getCompanyRow,
} from '../server/db.js'

test('Postgres(pglite) 方式で DB round-trip が成立する', async () => {
  const pg = new PGlite() // インメモリ Postgres
  await initDb(await makePgliteDriver(pg))

  // 参加（新規作成）
  const s1: any = await joinCompany('PGORG', 'A社', '社長A')
  assert.equal(s1.company.org, 'PGORG')
  assert.equal(s1.company.name, 'A社')
  assert.equal(s1.company.started, false)
  const id = s1.company.id
  assert.ok(Number.isInteger(id))

  // 状態保存（記帳2件＋成績1期）
  await saveState(id, {
    president: '社長A',
    period: 1,
    started: true,
    settled: false,
    opening: { openingCash: 0, openingCapital: 300 },
    seq: 3,
    entries: [
      { txId: 1, label: '資本金', col: 0, amount: 300, isCapital: true },
      { txId: 2, key: 'shiire', fvals: { items: [{ qty: 4, unit: 11 }] }, col: 5, amount: 44, note: '材料' },
    ],
    results: [
      { period: 1, PQ: 360, mPQ: 220, F: 150, G: 70, net: 49, capEnd: 300, retEnd: 69, cashEnd: 300, turns: 12, decisions: 10 },
    ],
  })

  // 取得（reload相当）
  const s2: any = await fullState(id)
  assert.equal(s2.company.started, true)
  assert.equal(s2.company.opening.openingCapital, 300)
  assert.equal(s2.entries.length, 2)
  assert.equal(s2.entries[0].label, '資本金')
  assert.equal(s2.entries[1].key, 'shiire')
  assert.deepEqual(s2.entries[1].fvals, { items: [{ qty: 4, unit: 11 }] })
  assert.equal(s2.entries[1].isCapital, undefined)
  assert.equal(s2.results.length, 1)
  assert.equal(s2.results[0].G, 70)

  // ON CONFLICT（同一 company_id,period）で成績が重複せず更新される
  await saveState(id, {
    president: '社長A',
    period: 1,
    started: true,
    settled: true,
    opening: { openingCapital: 300 },
    seq: 5,
    entries: [{ txId: 1, label: '資本金', col: 0, amount: 300, isCapital: true }],
    results: [{ period: 1, PQ: 400, mPQ: 240, F: 150, G: 90, net: 63, capEnd: 300, retEnd: 90, cashEnd: 320, turns: 14, decisions: 11 }],
  })
  const s3: any = await fullState(id)
  assert.equal(s3.results.length, 1, '同一期は重複せず1件')
  assert.equal(s3.results[0].G, 90, '値が更新される')
  assert.equal(s3.entries.length, 1, '当期の記帳は入れ替わる')

  // 組織比較
  const org = await listOrg('PGORG')
  assert.equal(org.length, 1)
  assert.equal(org[0].results[0].G, 90)
  const orgs = await listOrgs()
  assert.ok(orgs.some((o: any) => o.code === 'PGORG'))
  // Postgres 側でも migrate() が通り name 列が使えること（名前が空なら code で代替される）
  assert.equal(typeof orgs.find((o: any) => o.code === 'PGORG')?.name, 'string')

  // 2社目→組織に2社
  await joinCompany('PGORG', 'B社', '社長B')
  assert.equal((await listOrg('PGORG')).length, 2)

  // 削除（FK CASCADE で entries/results も消える）
  await deleteCompany(id)
  assert.equal(await fullState(id), null)
  assert.equal(await getCompanyRow('PGORG', 'A社'), undefined)
  assert.equal((await listOrg('PGORG')).length, 1) // B社のみ残る

  await pg.close()
})


// 本番（Render Postgres）は列が増える前のスキーマで動いている。
// デプロイ時に migrate() が ALTER TABLE を流して既存データを壊さないことを、
// **一番古い形**（orgs に name も無い）から確認する。#18 と #19 をまとめて出しても通る。
test('Postgres：旧スキーマの orgs に列が追加され、既存の研修・参加者データが壊れない', async () => {
  const pg = new PGlite()
  await pg.exec(`
    CREATE TABLE companies (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      org TEXT NOT NULL, name TEXT NOT NULL, president TEXT DEFAULT '',
      period INTEGER DEFAULT 1, started INTEGER DEFAULT 0, settled INTEGER DEFAULT 0,
      opening_json TEXT DEFAULT '{}', seq INTEGER DEFAULT 1, updated_at BIGINT DEFAULT 0,
      UNIQUE(org, name)
    );
    CREATE TABLE orgs (code TEXT PRIMARY KEY, created_at BIGINT DEFAULT 0);
    INSERT INTO orgs (code, created_at) VALUES ('PG-OLD-A', 1000), ('PG-OLD-B', 2000);
    INSERT INTO companies (org, name, president, period, started, opening_json, seq, updated_at)
      VALUES ('PG-OLD-A', 'あ社', '社長あ', 3, 1, '{"openingCapital":300}', 7, 5000);
  `)

  await initDb(await makePgliteDriver(pg))

  const orgs: any[] = await listOrgs()
  assert.equal(orgs.length, 2, '既存の研修が残る')
  const a = orgs.find((o: any) => o.code === 'PG-OLD-A')
  assert.equal(a.name, '組織1', 'name 列が追加され backfill される')
  assert.equal(a.status, 'preparing', 'status 列の既定は準備中')
  assert.equal(a.rulesetName, '')

  // 既存の研修は「入門編 標準」で動く（rules_json は空）
  assert.deepEqual((await getOrgRules('PG-OLD-A')).rules, {})

  // 参加者データが無傷
  const co = (await pg.query<any>(`SELECT name, period, seq FROM companies WHERE org='PG-OLD-A'`)).rows[0]
  assert.equal(co.name, 'あ社')
  assert.equal(co.period, 3)
  assert.equal(Number(co.seq), 7)

  // 再起動しても増えない・振り直されない
  await initDb(await makePgliteDriver(pg))
  assert.equal((await listOrgs()).length, 2)
  assert.equal((await listOrgs()).find((o: any) => o.code === 'PG-OLD-A').name, '組織1')

  await pg.close()
})
