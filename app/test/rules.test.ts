// 数値ルール（rules.ts）の差し替えが計算に効くことの検証。
// 「既定値のままなら今までと同じ」は golden-master（calc.test.ts）が担保するので、
// ここでは setRules() で差し替えたときに計算が追従することだけを見る。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RULES, normalizeRules } from '../src/lib/rules.ts'
import { ACTIONS, doClosingPrep, newState, setRules, getRules } from '../src/lib/calc.ts'

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
