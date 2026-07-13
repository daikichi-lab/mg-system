// 在庫整合性ガードのリグレッションテスト：
//  ① 販売 apply の会計側クランプ（幽霊販売で期末在庫がマイナスにならない）
//  ② 行の削除・編集・期首処理変更後の台帳再検証（矛盾する操作は取り消される）
//  ③ 決算前チェック settleBlockReason（破損データでは決算をブロック）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as calc from '../src/lib/calc.ts'
import * as game from '../src/lib/game.ts'
import type { St } from '../src/lib/calc.ts'

function newGame(): St {
  const st = calc.newState()
  st.name = 'X'
  st.president = 'P'
  st.org = 'O'
  st.started = true
  st.tx.push({ id: st.seq++, label: '資本金', col: 0, amount: 300, isCapital: true })
  calc.recompute(st)
  return st
}

// 機械1台・製造2/販売1を用意し、材料 qty 個を仕入れて全量製造・販売できる状態を作る
function setupProduced(st: St, qty: number, unit = 12) {
  assert.deepEqual(game.recordAction(st, 'kikai', { n: 1 }), [])
  assert.deepEqual(game.recordAction(st, 'saiyo', { mfg: 2, sales: 2, fail: 0 }), [])
  assert.deepEqual(game.recordAction(st, 'shiire', { qty, unit }), [])
  assert.deepEqual(game.recordAction(st, 'seizo', { qty: Math.min(qty, 4) }), [])
}

test('① 幽霊販売クランプ：入力数が在庫を超えても salesQty は実売数まで', () => {
  const st = newGame()
  // バリデーションを迂回して直接 tx を積む（破損データ・旧データの再現）
  const push = (key: string, fvals: Record<string, unknown>) => {
    const def = calc.ACTIONS[key]
    st.tx.push({ id: st.seq++, key, fvals, col: def.col, amount: def.amount(fvals) || 0 })
  }
  push('kikai', { n: 1 })
  push('saiyo', { mfg: 2, sales: 2, fail: 0 })
  push('shiire', { qty: 5, unit: 10 })
  push('seizo', { qty: 4 })
  push('hanbai', { qty: 6, unit: 30 }) // 製品4個しかないのに6個販売
  calc.recompute(st)
  assert.equal(st.salesQty, 4, '実売数でクランプされる')
  assert.equal(st.products, 0)
  const endQty = st.matQty - st.salesQty - st.scrapQty
  assert.equal(endQty, 1, '期末在庫個数はマイナスにならない（材料1個が残る）')
  assert.equal(endQty, st.rawCubes + st.products, '帳簿と盤面の個数が一致する')
})

test('② 行削除：後続の販売が成立しなくなる仕入行の削除は取り消される', () => {
  const st = newGame()
  setupProduced(st, 4)
  assert.deepEqual(game.recordAction(st, 'hanbai', { qty: 4, unit: 30 }), [])
  const shiireRow = st.tx.find((t) => t.key === 'shiire')!
  const before = st.tx.length
  const err = game.deleteRow(st, shiireRow.id)
  assert.ok(err, '削除はエラーで拒否される: ' + err)
  assert.equal(st.tx.length, before, '台帳は変わらない')
  assert.equal(calc.settleBlockReason(st), null, '整合状態が保たれ決算可能')
})

test('② 行削除：影響のない行の削除は成功する', () => {
  const st = newGame()
  setupProduced(st, 4)
  assert.deepEqual(game.recordAction(st, 'koukoku', { n: 1 }), [])
  assert.deepEqual(game.recordAction(st, 'hanbai', { qty: 2, unit: 30 }), [])
  const ad = st.tx.find((t) => t.key === 'koukoku')!
  // 広告を消すと販売能力が 2×2=4 → 販売2個は能力内なので成立
  assert.equal(game.deleteRow(st, ad.id), null)
  assert.ok(!st.tx.some((t) => t.key === 'koukoku'))
})

test('② 行編集：製造数を売却済み数より減らす編集は拒否される', () => {
  const st = newGame()
  setupProduced(st, 4)
  assert.deepEqual(game.recordAction(st, 'hanbai', { qty: 4, unit: 30 }), [])
  const seizoRow = st.tx.find((t) => t.key === 'seizo')!
  const errs = game.editActionRow(st, seizoRow.id, { qty: 2 })
  assert.ok(errs.length > 0, '編集はエラーで拒否される: ' + errs.join(' / '))
  assert.equal((st.tx.find((t) => t.key === 'seizo')!.fvals as any).qty, 4, '元の数量のまま')
  assert.equal(st.salesQty, 4)
})

test('② 行編集：成立する範囲の編集は通る', () => {
  const st = newGame()
  setupProduced(st, 4)
  assert.deepEqual(game.recordAction(st, 'hanbai', { qty: 2, unit: 30 }), [])
  const seizoRow = st.tx.find((t) => t.key === 'seizo')!
  assert.deepEqual(game.editActionRow(st, seizoRow.id, { qty: 3 }), [])
  assert.equal((st.tx.find((t) => t.key === 'seizo')!.fvals as any).qty, 3)
})

test('③ settleBlockReason：正常な台帳では null、期首在庫が負の破損データではブロック', () => {
  const st = newGame()
  setupProduced(st, 4)
  assert.deepEqual(game.recordAction(st, 'hanbai', { qty: 4, unit: 30 }), [])
  assert.equal(calc.settleBlockReason(st), null)
  // 旧バージョンで保存された「マイナス在庫の繰越」を再現
  const st2 = newGame()
  st2.openingMatQty = -1
  st2.openingMatVal = -11
  calc.recompute(st2)
  const reason = calc.settleBlockReason(st2)
  assert.ok(reason && reason.includes('決算できません'), 'ブロック理由が返る: ' + reason)
})

test('② イベント：水害の根拠だった仕入行の削除は拒否される（幽霊保険金の防止）', () => {
  const st = newGame()
  assert.deepEqual(game.recordAction(st, 'shiire', { qty: 10, unit: 10 }), [])
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [])
  const ev = game.eventFvals(st, 'suigai') // 材料10全破棄・保険金100
  assert.equal(ev.payout, 100)
  assert.deepEqual(game.recordAction(st, 'suigai', ev), [])
  const shiireRow = st.tx.find((t) => t.key === 'shiire')!
  const err = game.deleteRow(st, shiireRow.id)
  assert.ok(err && err.includes('破棄数'), '削除はブロックされる: ' + err)
  assert.equal(st.scrapQty, 10, '水害の破棄はそのまま有効')
})

test('② イベント：水害で保険金を受け取った後の保険加入行の削除は拒否される', () => {
  const st = newGame()
  assert.deepEqual(game.recordAction(st, 'shiire', { qty: 6, unit: 10 }), [])
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [])
  assert.deepEqual(game.recordAction(st, 'suigai', game.eventFvals(st, 'suigai')), [])
  const hokenRow = st.tx.find((t) => t.key === 'hoken')!
  const err = game.deleteRow(st, hokenRow.id)
  assert.ok(err && err.includes('保険'), '削除はブロックされる: ' + err)
})

test('② イベント：開発チップの根拠行を消すと商品開発成功イベントが不成立になり拒否される', () => {
  const st = newGame()
  setupProduced(st, 4)
  assert.deepEqual(game.recordAction(st, 'kaihatsu', { n: 1, result: '成功' }), [])
  assert.deepEqual(game.recordAction(st, 'kaihatsu_win', { qty: 2 }), [])
  const devRow = st.tx.find((t) => t.key === 'kaihatsu')!
  const err = game.deleteRow(st, devRow.id)
  assert.ok(err && err.includes('商品開発チップ'), '削除はブロックされる: ' + err)
})

test('決算取り消し：結果と履歴を破棄し、記帳→再決算で新しい結果になる', () => {
  const st = newGame()
  const history: any[] = []
  setupProduced(st, 4)
  assert.deepEqual(game.recordAction(st, 'hanbai', { qty: 2, unit: 30 }), [])
  calc.doClosingPrep(st)
  game.doSettle(st, history)
  assert.equal(st.settled, true)
  assert.equal(history.length, 1)
  const pq1 = history[0].PQ

  // 取り消し → 記帳可能な状態に戻る（期末自動行も消える）
  assert.equal(game.undoSettle(st, history), null)
  assert.equal(st.settled, false)
  assert.equal(st.result, null)
  assert.equal(history.length, 0)
  assert.ok(!st.tx.some((t) => t.isClosing), '給料・家賃・返済の自動行が外れる')
  assert.equal(st.closingPrep, false)

  // 追加の販売を記帳して再決算 → 売上が増えた結果に置き換わる
  assert.deepEqual(game.recordAction(st, 'hanbai', { qty: 2, unit: 40 }), [])
  calc.doClosingPrep(st)
  const r2 = game.doSettle(st, history)!
  assert.equal(history.length, 1)
  assert.equal(r2.PQ, pq1 + 80)
  assert.ok(Math.abs(r2.diff) < 1e-9, 'B/S 貸借一致')
})

test('決算取り消し：未決算では拒否される', () => {
  const st = newGame()
  assert.ok(game.undoSettle(st, []))
})

test('②+③ 通し：削除ガードにより決算後もB/Sの在庫がマイナスにならない', () => {
  const st = newGame()
  setupProduced(st, 4)
  assert.deepEqual(game.recordAction(st, 'hanbai', { qty: 4, unit: 30 }), [])
  // 仕入行の削除を試みる（拒否される）→ そのまま決算
  const shiireRow = st.tx.find((t) => t.key === 'shiire')!
  game.deleteRow(st, shiireRow.id)
  calc.doClosingPrep(st)
  const r = calc.settle(st)!
  assert.ok(r.endInvQty >= 0, `期末在庫個数 ${r.endInvQty} >= 0`)
  assert.ok(r.endInvVal >= 0, `期末在庫額 ${r.endInvVal} >= 0`)
  assert.ok(Math.abs(r.diff) < 1e-9, 'B/S 貸借一致')
  assert.equal(r.diffQty, 0, '盤面と帳簿の在庫個数が一致')
})
