// 数値ルール（rules.ts）の差し替えが計算に効くことの検証。
// 「既定値のままなら今までと同じ」は golden-master（calc.test.ts）が担保するので、
// ここでは setRules() で差し替えたときに計算が追従することだけを見る。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RULES, normalizeRules } from '../src/lib/rules.ts'
import { ACTIONS, doClosingPrep, newState, setRules, getRules } from '../src/lib/calc.ts'
import { getTags, getForms } from '../src/ui/actions.ts'

// 各テストの後に既定へ戻す（モジュールスコープの共有状態のため）
const reset = () => setRules(null)

test('normalizeRules：未指定・壊れた値は既定で埋める', () => {
  assert.deepEqual(normalizeRules(null), DEFAULT_RULES)
  assert.deepEqual(normalizeRules({}), DEFAULT_RULES)

  const partial = normalizeRules({ rent: 30 })
  assert.equal(partial.rent, 30)
  assert.equal(partial.machinePrice, DEFAULT_RULES.machinePrice)

  // 型が壊れている値は既定に落とす
  assert.equal(normalizeRules({ rent: 'x' as unknown as number }).rent, DEFAULT_RULES.rent)
  assert.equal(normalizeRules({ loanRate: NaN }).loanRate, DEFAULT_RULES.loanRate)
  assert.deepEqual(normalizeRules({ materialPrices: [] }).materialPrices, DEFAULT_RULES.materialPrices)
})

test('normalizeRules：planFromPeriod は1以上の整数だけ受け付け、既定は 3', () => {
  assert.equal(DEFAULT_RULES.planFromPeriod, 3)
  assert.equal(normalizeRules({ planFromPeriod: 1 }).planFromPeriod, 1)
  assert.equal(normalizeRules({ planFromPeriod: 6 }).planFromPeriod, 6) // 6 以上＝一度も出さない、も許す
  assert.equal(normalizeRules({ planFromPeriod: 0 }).planFromPeriod, 3)
  assert.equal(normalizeRules({ planFromPeriod: 2.5 }).planFromPeriod, 3)
  assert.equal(normalizeRules({ planFromPeriod: '3' as unknown as number }).planFromPeriod, 3)
})

test('normalizeRules：配列は複製する（既定値を書き換えない）', () => {
  const a = normalizeRules(null)
  a.materialPrices.push(99)
  a.salaryTable.push(99)
  assert.deepEqual(normalizeRules(null).materialPrices, DEFAULT_RULES.materialPrices)
  assert.deepEqual(normalizeRules(null).salaryTable, DEFAULT_RULES.salaryTable)
})

test('機械価格：金額も什器の帳簿価額も差し替えた値になる', () => {
  setRules({ machinePrice: 200 })
  try {
    assert.equal(ACTIONS.kikai.amount({ n: 2 }), 400)
    const st = newState()
    ACTIONS.kikai.apply!(st, { n: 2 })
    assert.equal(st.machines, 2)
    assert.equal(st.equipVal, 400)
  } finally {
    reset()
  }
  assert.equal(ACTIONS.kikai.amount({ n: 2 }), 200) // 既定100に戻る
})

test('給料表：期末給料が差し替えた値になる（表にない期は28）', () => {
  setRules({ salaryTable: [10, 20] })
  try {
    const st = newState()
    st.openingStaffMfg = 2 // 盤面は recompute で期首値から組み直されるため opening 側に置く
    st.period = 1
    doClosingPrep(st)
    const sal = st.tx.find((t) => t.isClosing && t.col === 6)
    assert.equal(sal?.amount, 20) // 2人 × 10

    const st3 = newState()
    st3.openingStaffMfg = 1
    st3.period = 3 // 表の範囲外
    doClosingPrep(st3)
    assert.equal(st3.tx.find((t) => t.isClosing && t.col === 6)?.amount, 28)
  } finally {
    reset()
  }
})

test('家賃：期末の家賃行が差し替えた値になる', () => {
  setRules({ rent: 40 })
  try {
    const st = newState()
    doClosingPrep(st)
    assert.equal(st.tx.find((t) => t.isClosing && t.col === 8)?.amount, 40)
  } finally {
    reset()
  }
})

test('setRules(null) で既定に戻る', () => {
  setRules({ rent: 99, matCap: 3 })
  assert.equal(getRules().rent, 99)
  reset()
  assert.deepEqual(getRules(), DEFAULT_RULES)
})


// ---- 記帳ボタンのヒント（issue #23）----
// 実際の記帳額は getRules() を見ていたのに、ボタンの表示だけ静的な文言のままで
// ずれていた。表示と記帳額が食い違わないことをここで担保する。

test('ヒント：既定ルールでは現行の文言（−100 / −10〜16）のまま', () => {
  reset()
  const t = getTags()
  assert.equal(t.kikai, '−100')
  assert.equal(t.shiire, '−10〜16')
})

test('ヒント：機械価格を差し替えると表示も追従し、実際の記帳額と一致する', () => {
  setRules({ machinePrice: 200 })
  try {
    assert.equal(getTags().kikai, '−200')
    // 表示（−200）と実際の記帳額（200）が一致していること
    assert.equal(ACTIONS.kikai.amount({ n: 1 }), 200)
  } finally {
    reset()
  }
})

test('ヒント：仕入単価の選択肢に追従する（最小〜最大）', () => {
  setRules({ materialPrices: [20, 21, 22] })
  try {
    assert.equal(getTags().shiire, '−20〜22')
    // モーダルの単価プルダウンと同じ選択肢を指していること
    const unit = getForms().shiire.rowFields!.find((f) => f.name === 'unit')!
    assert.deepEqual(
      unit.options!.map((o) => Number(o.value)),
      [20, 21, 22],
    )
  } finally {
    reset()
  }
})

test('ヒント：仕入単価が1種類なら範囲にしない', () => {
  setRules({ materialPrices: [12] })
  try {
    assert.equal(getTags().shiire, '−12')
  } finally {
    reset()
  }
})

test('ヒント：Rules に無い直書き定数はそのまま', () => {
  setRules({ machinePrice: 200, materialPrices: [20] })
  try {
    const t = getTags()
    assert.equal(t.saiyo, '−5')
    assert.equal(t.koukoku, '−10')
    assert.equal(t.kaihatsu, '−20')
    assert.equal(t.hanbai, '＋ 売上')
  } finally {
    reset()
  }
})

test('ヒント：setRules() のたびに作り直され、古い文言を掴み続けない', () => {
  reset()
  assert.equal(getTags().kikai, '−100')
  setRules({ machinePrice: 150 })
  assert.equal(getTags().kikai, '−150', '差し替え後は新しい値')
  setRules({ machinePrice: 180 })
  assert.equal(getTags().kikai, '−180', '続けて差し替えても追従する')
  reset()
  assert.equal(getTags().kikai, '−100', '既定へ戻せば元の文言')
})
