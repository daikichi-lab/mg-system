// 数値ルールのマスタ（rulesets）の検証。
// 既定ルールが1回だけ入ること、既定は編集・削除できないこと、CRUD が成立することを見る。
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_RULES, normalizeRules } from '../src/lib/rules.ts'

process.env.MG_DB = join(mkdtempSync(join(tmpdir(), 'mg-rulesets-')), 'rs.db')

const { initDb, listRulesets, getRuleset, createRuleset, updateRuleset, deleteRuleset } = await import(
  '../server/db.js'
)

before(async () => {
  await initDb()
})

test('既定ルール「入門編 標準」が初期投入される', async () => {
  const all = await listRulesets()
  const builtin = all.filter((r: any) => r.isBuiltin)
  assert.equal(builtin.length, 1)
  assert.equal(builtin[0].name, '入門編 標準')
})

test('既定ルールは rules.ts の DEFAULT_RULES と一致する', async () => {
  // rules_json は空オブジェクト。normalizeRules を通すと既定値そのものになる（値を二重に持たない設計）
  const builtin = (await listRulesets()).find((r: any) => r.isBuiltin)!
  assert.deepEqual(normalizeRules(builtin.rules), DEFAULT_RULES)
})

test('初期投入は繰り返し起動しても増えない', async () => {
  await initDb()
  await initDb()
  assert.equal((await listRulesets()).filter((r: any) => r.isBuiltin).length, 1)
})

test('作成・取得：数値がそのまま保存される', async () => {
  const created = await createRuleset({
    name: '上級編（高金利）',
    description: '金利を上げた設定',
    rules: { ...DEFAULT_RULES, loanRate: 0.1, rent: 40 },
  })
  assert.ok(created.id > 0)
  assert.equal(created.isBuiltin, false)

  const got = await getRuleset(created.id)
  assert.ok(got)
  assert.equal(got.name, '上級編（高金利）')
  assert.equal((got.rules as any).loanRate, 0.1)
  assert.equal((got.rules as any).rent, 40)
})

test('ルール名は重複してよい', async () => {
  await createRuleset({ name: '同じ名前', rules: {} })
  await createRuleset({ name: '同じ名前', rules: {} })
  assert.equal((await listRulesets()).filter((r: any) => r.name === '同じ名前').length, 2)
})

test('更新：名前と数値が変わる', async () => {
  const c = await createRuleset({ name: '更新前', rules: { ...DEFAULT_RULES } })
  const r = await updateRuleset(c.id, { name: '更新後', description: 'メモ', rules: { ...DEFAULT_RULES, matCap: 20 } })
  assert.equal(r.ok, true)
  assert.equal(r.ruleset.name, '更新後')
  assert.equal((r.ruleset.rules as any).matCap, 20)
})

test('既定ルールは編集も削除もできない', async () => {
  const builtin = (await listRulesets()).find((r: any) => r.isBuiltin)!
  assert.equal((await updateRuleset(builtin.id, { name: 'x', rules: {} })).error, 'builtin')
  assert.equal((await deleteRuleset(builtin.id)).error, 'builtin')
  // 残っている
  assert.ok(await getRuleset(builtin.id))
})

test('削除：一覧から消える', async () => {
  const c = await createRuleset({ name: '消す用', rules: {} })
  assert.equal((await deleteRuleset(c.id)).ok, true)
  assert.equal(await getRuleset(c.id), null)
})

test('存在しないIDは not_found', async () => {
  assert.equal((await updateRuleset(999999, { name: 'x', rules: {} })).error, 'not_found')
  assert.equal((await deleteRuleset(999999)).error, 'not_found')
  assert.equal(await getRuleset(999999), null)
})

test('一覧は既定ルールが先頭に来る', async () => {
  const all = await listRulesets()
  assert.equal(all[0].isBuiltin, true)
})
