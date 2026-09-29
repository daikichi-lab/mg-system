// 在庫整合性ガードのリグレッションテスト：
//  ① 販売 apply の会計側クランプ（幽霊販売で期末在庫がマイナスにならない）
//  ② 行の削除・編集・期首処理変更後の台帳再検証（矛盾する操作は取り消される）
//  ③ 決算前チェック settleBlockReason（破損データでは決算をブロック）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as calc from '../src/lib/calc.ts'
import * as game from '../src/lib/game.ts'
import type { St, Result } from '../src/lib/calc.ts'

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

test('期末返済：期中に借りた分も含めて (期首残高＋当期借入) × 返済率。残高が上限', () => {
  const st = calc.newState()
  st.period = 2
  st.openingLoan = 100
  st.repayRate = 10
  st.tx.push({ id: st.seq++, label: '資本金', col: 0, amount: 300, isCapital: true })
  st.tx.push({ id: st.seq++, key: 'kariire', fvals: { a: 200 }, col: 1, amount: 200 })
  calc.recompute(st)
  assert.equal(calc.borrowedThisPeriod(st), 200)
  assert.equal(calc.closingRepay(st), 30) // (100 ＋ 200) × 10%
  calc.doClosingPrep(st)
  const row = st.tx.find((t) => t.isAutoRepay)!
  assert.equal(row.amount, 30)
  assert.equal(row.note, '(期首残高100＋当期借入200)×10%')
  // 期中に借りていなければ従来どおり期首残高だけ
  const st2 = calc.newState()
  st2.period = 2
  st2.openingLoan = 100
  st2.repayRate = 10
  st2.tx.push({ id: st2.seq++, label: '資本金', col: 0, amount: 300, isCapital: true })
  calc.recompute(st2)
  assert.equal(calc.closingRepay(st2), 10)
})

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

test('独占販売：販売と同じく複数行で記帳でき、上限（販売スタッフ1人につき2個）は合計で判定。以前の1組の形も同じ結果', () => {
  const st = newGame()
  setupProduced(st, 4) // 機械1・製造2/販売2・材料4 → 製品4
  // 販売2人 → 4個まで。2行で合計4個
  assert.deepEqual(game.recordAction(st, 'dokusen', { items: [{ qty: 2, unit: 45 }, { qty: 2, unit: 40 }] }), [])
  const row = st.tx[st.tx.length - 1]
  assert.equal(row.amount, 2 * 45 + 2 * 40)
  assert.equal(st.salesQty, 4)
  assert.equal(st.products, 0)
  // 合計が上限を超えると記帳できない
  const st2 = newGame()
  setupProduced(st2, 4)
  const errs = game.recordAction(st2, 'dokusen', { items: [{ qty: 3, unit: 45 }, { qty: 2, unit: 40 }] })
  assert.ok(errs.some((e) => e.includes('販売スタッフ1人につき2個')))
  // 以前の1組の形（qty・unit を直接持つ）も1行として同じ金額・売上になる
  const def = calc.ACTIONS.dokusen
  assert.equal(def.amount({ qty: 2, unit: 45 }), 90)
  assert.equal(def.amount({ items: [{ qty: 2, unit: 45 }] }), 90)
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

// ---- ④ ルールBの回数制限（第2期以降の1週目のみ2回） ----

// 第1期を決算して第2期の期首まで進める
function toPeriod2(st: St): void {
  const history: Result[] = []
  setupProduced(st, 4)
  assert.deepEqual(game.recordAction(st, 'hanbai', { qty: 4, unit: 30 }), [])
  calc.doClosingPrep(st)
  game.doSettle(st, history)
  game.goNext(st)
  assert.equal(st.period, 2)
}

const B_LIMIT_1 = 'ルールBは1ターンに1度までです（ルールA/イベントを挟んでください）。'
const B_LIMIT_2 = 'ルールBは1週目でも2回までです（ルールA/イベントを挟んでください）。'

test('④ 第1期の1週目：ルールBは1回まで（2回目は拒否）', () => {
  const st = newGame()
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [])
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [B_LIMIT_1])
})

test('④ 第2期の1週目：ルールBは2回まで記帳でき、3回目は拒否される', () => {
  const st = newGame()
  toPeriod2(st)
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [])
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [], '1週目の2回目は通る')
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [B_LIMIT_2])
})

test('④ 第2期でもルールAを挟んだ後は1回まで（1週目の緩和は最初の手番だけ）', () => {
  const st = newGame()
  toPeriod2(st)
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [])
  assert.deepEqual(game.recordAction(st, 'kikai', { n: 1 }), [], 'ルールAで手番が進む')
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [])
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [B_LIMIT_1], '2週目以降は1回まで')
})

test('④ 期首の自動行（法人税納付・支払金利）は手番に数えず、1週目の判定を壊さない', () => {
  const st = newGame()
  // 借入を作って第1期を利益ありで終える → 第2期の期首に自動行が積まれる
  setupProduced(st, 4)
  assert.deepEqual(game.recordAction(st, 'hanbai', { qty: 4, unit: 60 }), [])
  const history: Result[] = []
  calc.doClosingPrep(st)
  game.doSettle(st, history)
  game.goNext(st)
  assert.equal(st.period, 2)
  assert.ok(
    st.tx.some((t) => t.isOpeningTax || t.isOpeningInterest),
    '期首の自動行が積まれている',
  )
  // 自動行が先頭にあっても 1週目として2回まで通る
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [])
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [])
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [B_LIMIT_2])
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

// ---- 什器売却（ルールB・「いつ買った機械か」を選んで1台・簿価の半値）----
test('⑤ 什器売却：選んだ什器の簿価の半値が入金され、盤面の台数と簿価が減り、差額は特別損失になる', () => {
  const st = newGame()
  assert.deepEqual(game.recordAction(st, 'kikai', { n: 2 }), []) // 2台・簿価200（第1期に購入）
  assert.deepEqual(st.lots, [{ period: 1, book: 100 }, { period: 1, book: 100 }])
  assert.deepEqual(game.recordAction(st, 'baikyaku', { period: 1 }), [])
  const row = st.tx.find((t) => t.key === 'baikyaku')!
  assert.equal(row.col, 3, '入金の A 列')
  assert.equal(row.amount, 50, '簿価100の半値')
  assert.equal(row.note, '第1期に購入・簿価の半値')
  assert.equal(st.machines, 1)
  assert.equal(st.equipVal, 100)
  assert.equal(st.equipSold, 100)
  assert.equal(st.lots.length, 1, '1台ずつの記録も1台減る')
  assert.equal(calc.cashNow(st), 300 - 200 + 50)
  const r = calc.settle(st)!
  assert.equal(r.special, 50 - 100, '特別損益 ＝ 売却代金 − 簿価（売却損）')
  assert.equal(r.dep, 10, '減価償却は期末に残った1台分')
  assert.equal(r.equipEnd, 90)
  assert.deepEqual(r.lotsEnd, [{ period: 1, book: 90 }], '期末の1台ずつ（減価償却後）の合計 ＝ 次期繰越')
  assert.equal(r.equipSold, 100)
  assert.equal(r.equipSaleCash, 50)
  assert.ok(Math.abs(r.diff) < 1e-9, 'B/S 貸借一致')
  const cf = calc.cashflow(r)
  assert.equal(cf.invCF, -200 + 50, '売却代金は投資CF')
  assert.equal(cf.opCF, r.PQ - r.laborF - r.sellF - r.adminF, '営業CFには入らない')
})

test('⑤ 什器売却：什器なし・未選択・その期の什器が無い場合は拒否される', () => {
  const st = newGame()
  assert.ok(game.recordAction(st, 'baikyaku', { period: 1 }).length, '什器がないので不可')
  assert.deepEqual(game.recordAction(st, 'kikai', { n: 1 }), [])
  assert.ok(game.recordAction(st, 'baikyaku', {}).length, '未選択は不可')
  assert.ok(game.recordAction(st, 'baikyaku', { period: 3 }).length, '第3期に買った什器は無いので不可')
  assert.deepEqual(game.recordAction(st, 'baikyaku', { period: 1 }), [])
  assert.equal(st.machines, 0)
  assert.ok(game.recordAction(st, 'kikai', { n: 1 }).length === 0)
  assert.ok(game.recordAction(st, 'baikyaku', { period: 1 }).length === 0, '買い直せばまた売れる')
})

test('⑤ 什器売却はルールB：同じ手番でもう1つルールBを記帳すると拒否される', () => {
  const st = newGame()
  assert.deepEqual(game.recordAction(st, 'kikai', { n: 1 }), [])
  assert.deepEqual(game.recordAction(st, 'baikyaku', { period: 1 }), [])
  assert.ok(game.recordAction(st, 'hoken', { n: 1 }).length, '1ターンに1度まで')
})

test('⑤ 什器売却：第1期と第3期に買った機械のどちらを売るかで売却額が変わる', () => {
  const st = newGame()
  st.period = 3
  st.openingMachines = 1
  st.openingEquipVal = 80 // 第1期に買った1台（100 − 減価償却10×2期）
  st.openingLots = [{ period: 1, book: 80 }]
  st.retained = 80 // 期首の B/S を釣り合わせる（什器80 ＝ 利益剰余金80）
  calc.recompute(st)
  assert.deepEqual(game.recordAction(st, 'kikai', { n: 1 }), []) // 第3期に1台・簿価100
  assert.deepEqual(calc.machineOptions(st), [
    { period: 1, book: 80, seq: 1, count: 1 },
    { period: 3, book: 100, seq: 1, count: 1 },
  ])
  // 古い方（第1期）を売る：簿価80の半値 40。残るのは第3期の1台（簿価100）
  assert.deepEqual(game.recordAction(st, 'baikyaku', { period: 1 }), [])
  const sale = st.tx.find((t) => t.key === 'baikyaku')!
  assert.equal(sale.amount, 40)
  assert.deepEqual(st.lots, [{ period: 3, book: 100 }])
  assert.equal(st.equipVal, 100)
  // 編集で新しい方（第3期）に変えると 50 になり、残るのは第1期の1台（簿価80）
  assert.deepEqual(game.editActionRow(st, sale.id, { period: 3 }), [])
  assert.equal(st.tx.find((t) => t.key === 'baikyaku')!.amount, 50)
  assert.deepEqual(st.lots, [{ period: 1, book: 80 }])
  assert.equal(st.equipVal, 80)
  const r = calc.settle(st)!
  assert.ok(Math.abs(r.diff) < 1e-9, 'B/S 貸借一致')
  assert.deepEqual(r.lotsEnd, [{ period: 1, book: 70 }])
})

test('⑤ 什器売却：売った機械の購入行を消すと拒否される。別の機械の購入行なら消せて売却額は変わらない', () => {
  const st = newGame()
  st.period = 2
  st.openingMachines = 1
  st.openingEquipVal = 90
  st.openingLots = [{ period: 1, book: 90 }]
  st.retained = 90
  calc.recompute(st)
  assert.deepEqual(game.recordAction(st, 'kikai', { n: 1 }), []) // 第2期に1台
  assert.deepEqual(game.recordAction(st, 'baikyaku', { period: 2 }), []) // 第2期の機械を売る（50）
  const buy = st.tx.find((t) => t.key === 'kikai')!
  assert.ok(game.deleteRow(st, buy.id), '売った機械の購入行は消せない')
  assert.equal(st.tx.find((t) => t.key === 'baikyaku')!.amount, 50, '台帳は変わらない')
  // 売る機械を第1期の方に変えれば、第2期の購入行は消せる。売却額（90の半値＝45）は変わらない
  const sale = st.tx.find((t) => t.key === 'baikyaku')!
  assert.deepEqual(game.editActionRow(st, sale.id, { period: 1 }), [])
  assert.equal(st.tx.find((t) => t.key === 'baikyaku')!.amount, 45)
  assert.equal(game.deleteRow(st, buy.id), null)
  assert.equal(st.tx.find((t) => t.key === 'baikyaku')!.amount, 45)
  assert.equal(st.machines, 0)
  assert.equal(st.equipVal, 0)
  const before = game.stateBeforeRow(st, sale.id)
  assert.deepEqual(before.lots, [{ period: 1, book: 90 }], 'stateBeforeRow は売却前の盤面を返す')
})

test('⑤ 什器：期首の1台ずつの記録が無い古いデータは、合計簿価を台数で按分し、購入期は簿価から逆算する', () => {
  const st = newGame()
  st.period = 3
  st.openingMachines = 1
  st.openingEquipVal = 80 // 記録なし。100 − 10×2期 ＝ 第1期に購入
  st.retained = 80
  calc.recompute(st)
  assert.deepEqual(st.lots, [{ period: 1, book: 80 }], '簿価80 → 第1期に購入')
  assert.deepEqual(calc.machineOptions(st), [{ period: 1, book: 80, seq: 1, count: 1 }])
  assert.equal(calc.lotOptionLabel(calc.machineOptions(st)[0]), '第1期に購入（簿価 80）')
})

test('⑤ 什器：按分で簿価が半端になり逆算できない台は「購入期不明」になり、それでも売れる', () => {
  const st = newGame()
  st.period = 2
  st.openingMachines = 3
  st.openingEquipVal = 250 // 記録なし（openingLots は空）
  st.retained = 250
  calc.recompute(st)
  assert.deepEqual(st.lots, [{ period: 0, book: 84 }, { period: 0, book: 83 }, { period: 0, book: 83 }], '端数は先頭から')
  assert.equal(st.lots.reduce((a, l) => a + l.book, 0), st.equipVal, '合計は equipVal と一致')
  assert.deepEqual(calc.machineOptions(st).map((o) => calc.lotOptionLabel(o)), [
    '購入期不明 1台目（簿価 84）',
    '購入期不明 2台目（簿価 83）',
    '購入期不明 3台目（簿価 83）',
  ])
  assert.deepEqual(game.recordAction(st, 'baikyaku', { lot: '0:2' }), [])
  assert.equal(st.tx.find((t) => t.key === 'baikyaku')!.amount, 42, '2台目（簿価83）の半値')
  assert.equal(st.equipVal, 167)
  const r = calc.settle(st)!
  assert.ok(Math.abs(r.diff) < 1e-9, 'B/S 貸借一致')
})

test('⑤ 什器：同じ期に複数台あれば「1台目」「2台目」と1台ずつ並び、何台目かを指定して売れる', () => {
  const st = newGame()
  st.period = 3
  st.openingMachines = 2
  st.openingEquipVal = 170 // 第1期の1台（80）＋第2期の1台（90）
  st.openingLots = [{ period: 1, book: 80 }, { period: 2, book: 90 }]
  st.retained = 170
  calc.recompute(st)
  assert.deepEqual(game.recordAction(st, 'kikai', { n: 2 }), []) // 第3期に2台
  assert.deepEqual(calc.machineOptions(st).map((o) => [calc.lotKey(o.period, o.seq), calc.lotOptionLabel(o)]), [
    ['1:1', '第1期に購入（簿価 80）'],
    ['2:1', '第2期に購入（簿価 90）'],
    ['3:1', '第3期に購入 1台目（簿価 100）'],
    ['3:2', '第3期に購入 2台目（簿価 100）'],
  ])
  assert.deepEqual(game.recordAction(st, 'baikyaku', { lot: '3:2' }), [])
  const sale = st.tx.find((t) => t.key === 'baikyaku')!
  assert.equal(sale.amount, 50)
  assert.equal(sale.note, '第3期に購入・簿価の半値')
  assert.equal(st.lots.filter((l) => l.period === 3).length, 1, '第3期の什器が1台減る')
  assert.ok(game.recordAction(st, 'kikai', { n: 1 }).length === 0)
  assert.ok(game.recordAction(st, 'baikyaku', { lot: '3:3' }).length, '第3期の3台目は無いので不可')
  assert.deepEqual(calc.machineOptions(st).filter((o) => o.period === 3).map((o) => o.seq), [1, 2], '売った後は番号が詰まる')
})

test('⑤ 什器：記録が無い古いデータでも、過去の決算結果から購入した期を復元する', () => {
  // 第1期に1台・第2期に1台買って第3期の期首（80 ＋ 90 ＝ 170）。当時の決算結果には lotsEnd が無い
  const mk = (period: number, equipBought: number, machines: number, equipEnd: number) =>
    ({ period, equipBought, machines, equipEnd }) as unknown as Result
  const results = [mk(1, 100, 1, 90), mk(2, 100, 2, 170)]
  assert.deepEqual(calc.lotsFromHistory(results, 3), [{ period: 1, book: 80 }, { period: 2, book: 90 }])
  // 読み込み時に復元される
  const st = calc.newState()
  game.applyApiState(st, {
    company: { org: 'O', name: 'X', president: 'P', period: 3, started: true, settled: false, opening: { openingMachines: 2, openingEquipVal: 170, retained: 170 }, seq: 5 } as any,
    entries: [{ id: 1, label: '資本金', col: 0, amount: 300, isCapital: true }] as any,
    results,
  })
  assert.deepEqual(st.openingLots, [{ period: 1, book: 80 }, { period: 2, book: 90 }])
  assert.deepEqual(st.lots, [{ period: 1, book: 80 }, { period: 2, book: 90 }])
  // 講師が盤面で台数を変えて合わなくなった期は、台数を合わせて差額を吸収する
  const odd = [mk(1, 100, 1, 90), mk(2, 0, 3, 250)] // 第2期に買っていないのに3台・期末簿価250
  const lots = calc.lotsFromHistory(odd, 3)
  assert.equal(lots.length, 3)
  assert.equal(lots.reduce((a, l) => a + l.book, 0), 250)
})

test('⑤ 什器：期をまたぐと購入した期と減価償却後の簿価が引き継がれる（保存→復元も含む）', () => {
  const st = newGame()
  assert.deepEqual(game.recordAction(st, 'kikai', { n: 1 }), [])
  const history: Result[] = []
  game.doSettle(st, history)
  game.goNext(st)
  assert.equal(st.period, 2)
  assert.deepEqual(st.openingLots, [{ period: 1, book: 90 }])
  assert.deepEqual(st.lots, [{ period: 1, book: 90 }])
  // 保存して復元しても同じ
  const payload = game.payloadFromState(st, history)
  assert.deepEqual((payload.opening as any).openingLots, [{ period: 1, book: 90 }])
  const st2 = calc.newState()
  game.applyApiState(st2, { company: { org: 'O', name: 'X', president: 'P', period: 2, started: true, settled: false, opening: payload.opening, seq: st.seq } as any, entries: payload.entries as any, results: history })
  assert.deepEqual(st2.lots, [{ period: 1, book: 90 }])
  assert.deepEqual(game.recordAction(st2, 'kikai', { n: 1 }), [])
  assert.deepEqual(calc.machineOptions(st2), [
    { period: 1, book: 90, seq: 1, count: 1 },
    { period: 2, book: 100, seq: 1, count: 1 },
  ])
})

test('⑥ 特別損益の内訳：保険金 − 廃棄損 − 什器売却損 ＝ 特別損益', () => {
  const st = newGame()
  assert.deepEqual(game.recordAction(st, 'kikai', { n: 2 }), [])
  assert.deepEqual(game.recordAction(st, 'saiyo', { mfg: 2, sales: 2, fail: 0 }), [])
  assert.deepEqual(game.recordAction(st, 'shiire', { qty: 4, unit: 10 }), [])
  assert.deepEqual(game.recordAction(st, 'hoken', { n: 1 }), [])
  assert.deepEqual(game.recordAction(st, 'seizo', { qty: 4 }), [])
  assert.deepEqual(game.recordAction(st, 'baikyaku', { period: 1 }), []) // 簿価100 → 代金50・売却損50
  assert.deepEqual(game.recordAction(st, 'hanbai', { qty: 2, unit: 30 }), [])
  assert.deepEqual(game.recordAction(st, 'ibutsu', game.eventFvals(st, 'ibutsu')), []) // 製品2個廃棄（単価10）・保険金20
  const r = calc.settle(st)!
  const b = calc.specialBreakdown(r)
  assert.equal(b.insurance, 20)
  assert.equal(b.scrapLoss, 20)
  assert.equal(b.saleLoss, 50)
  assert.equal(b.insurance - b.scrapLoss - b.saleLoss, r.special)
  assert.ok(Math.abs(r.diff) < 1e-9, 'B/S 貸借一致')
})

test('⑥ 特別損益の内訳：什器売却の値が無い古い決算結果でも保険金と廃棄損だけで計算できる', () => {
  const r = { colTot: [0, 0, 0, 30, 0, 0, 0, 0, 0, 0, 0], scrap: 1, avg: 12 } as unknown as Result
  assert.deepEqual(calc.specialBreakdown(r), { insurance: 30, scrapLoss: 12, saleLoss: 0 })
})

test('会社を始めると期末返済率の初期値は 5%（計算エンジンの既定 0 は変えない）', () => {
  assert.equal(calc.newState().repayRate, 0) // golden-master の前提
  const st = calc.newState()
  game.startCompany(st, { name: 'X', president: 'P', org: 'O', capital: 300 })
  assert.equal(st.repayRate, game.DEFAULT_REPAY_RATE)
  assert.equal(game.DEFAULT_REPAY_RATE, 5)
})
