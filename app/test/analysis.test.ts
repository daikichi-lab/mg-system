// 第4表 MG経営戦略分析表と S〜DD の評価（lib/analysis.ts）の検証。issue #109
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newState, type Result } from '../src/lib/calc.ts'
import { analysisTable, bepRatio, gradeOf, orgQOf, shareOf, GRADES } from '../src/lib/analysis.ts'

// 最小限の決算結果（plan.test.ts の res() と同じ形）
function res(period: number, over: Partial<Result> = {}): Result {
  return {
    period,
    Q: 0, PQ: 0, vPQ: 0, mPQ: 0, F: 0, G: 0, net: 0, tax: 0,
    capStart: 0, capEnd: 0, retEnd: 0, cashEnd: 0, endInvQty: 0, endInvVal: 0, prodEnd: 0,
    equipEnd: 0, machines: 0, staffMfg: 0, staffSales: 0, loanEnd: 0, dev: 0, ads: 0,
    loanMult: 2, repayRate: 10, openInterest: 0, laborF: 0, sellF: 0, adminF: 0, depF: 0,
    loanRepay: 0, name: '', president: '', colTot: [], rows: [],
    ...over,
  } as unknown as Result
}

test('評価：様式の区分の境目どおりに S〜DD を決める', () => {
  const at = (ratio: number) => gradeOf(ratio, 100)
  assert.equal(at(0), 'S')
  assert.equal(at(59), 'S')
  assert.equal(at(60), 'A')
  assert.equal(at(79), 'A')
  assert.equal(at(80), 'B')
  assert.equal(at(89), 'B')
  assert.equal(at(90), 'C')
  assert.equal(at(99), 'C')
  assert.equal(at(100), 'D')
  assert.equal(at(199), 'D')
  assert.equal(at(200), 'DD')
  assert.equal(at(350), 'DD')
  // 表の並びは良い順
  assert.deepEqual(GRADES.map((g) => g.grade), ['S', 'A', 'B', 'C', 'D', 'DD'])
})

test('損益分岐点比率：F÷MQ×100 を整数に丸める。粗利が 0 以下なら比率は出さず、固定費があれば DD', () => {
  assert.equal(bepRatio(252, 164), 65) // 65.07…
  assert.equal(bepRatio(200, 179), 90) // 89.5 → 90（C）
  assert.equal(bepRatio(0, 100), null)
  assert.equal(bepRatio(-20, 100), null)
  assert.equal(gradeOf(null, 100), 'DD')
  assert.equal(gradeOf(null, 0), null) // 売上も固定費も無い期は評価しない
})

test('シェア：自社の売上個数 ÷ その期の全社の合計（小数1桁）。他社のデータが無ければ出さない', () => {
  const orgQ = orgQOf([
    { name: 'A社', results: [{ period: 1, Q: 10 }, { period: 2, Q: 20 }] },
    { name: 'B社', results: [{ period: 1, Q: 20 }] },
    { name: 'C社', results: [{ period: 1, Q: 'x' }] }, // 壊れた値は数えない
  ])
  assert.equal(shareOf(1, 'A社', 10, orgQ), 33.3) // 10 ÷ 30
  // 自社の値は手元の決算で上書きする（組織 API にまだ載っていない／古い場合）
  assert.equal(shareOf(1, 'A社', 20, orgQ), 50)
  // 組織 API に載っていない自社も分母に足す
  assert.equal(shareOf(1, 'D社', 30, orgQ), 50) // 30 ÷ 60
  // その期に決算したのが自社だけ・組織データが無いときは null
  assert.equal(shareOf(2, 'A社', 20, orgQ), null)
  assert.equal(shareOf(1, 'A社', 10, null), null)
  // 全社が 0 個なら出さない
  assert.equal(shareOf(1, 'A社', 0, orgQOf([{ name: 'B社', results: [{ period: 1, Q: 0 }] }])), null)
})

test('第4表：実績は決算から、計画はその期の経営計画書から。計画書に無い項目は null', () => {
  const st = newState()
  st.period = 4
  st.name = 'A社'
  // 第2期の決算（＝第3期の期首）：製造2・販売2・機械1・借入100
  const r2 = res(2, {
    Q: 8, PQ: 256, vPQ: 96, mPQ: 160, F: 200, G: -40, tax: 5, loanEnd: 100, capEnd: 300, retEnd: -45,
    staffMfg: 2, staffSales: 2, machines: 1, cashEnd: 252, equipEnd: 100,
  } as Partial<Result>)
  const r3 = res(3, { Q: 12, PQ: 396, vPQ: 144, mPQ: 252, F: 306, G: -54, tax: 5, loanEnd: 90, capEnd: 300, retEnd: -104 } as Partial<Result>)
  const plans = { '3': { g: 34, p: 32, v: 12 } }
  const rows = analysisTable([r2, r3], plans, st, orgQOf([{ name: 'B社', results: [{ period: 3, Q: 36 }] }]))

  // 第1期〜今の期（第4期）まで並ぶ。決算の無い期は実績 null
  assert.deepEqual(rows.map((r) => r.period), [1, 2, 3, 4])
  assert.equal(rows[0].actual, null)
  assert.equal(rows[3].actual, null)

  const a = rows[2].actual!
  // 単価は合計から割り戻す（396÷12＝33、144÷12＝12）
  assert.deepEqual([a.P, a.V, a.M, a.Q], [33, 12, 21, 12])
  assert.deepEqual([a.PQ, a.VQ, a.MQ, a.F, a.G], [396, 144, 252, 306, -54])
  // 負債＝未払法人税＋借入金、純資産＝資本金＋利益剰余金
  assert.equal(a.debt, 95)
  assert.equal(a.equity, 196)
  // 306÷252＝121% → D
  assert.equal(a.ratio, 121)
  assert.equal(a.grade, 'D')
  // シェア 12 ÷ (12＋36)
  assert.equal(a.share, 25)

  // 計画：F は第3期の期首の盤面から 164（plan.test.ts の「計画と実績の差」と同じ条件）、Q＝⌈198÷20⌉＝10
  const p = rows[2].plan!
  assert.deepEqual([p.P, p.V, p.M, p.Q], [32, 12, 20, 10])
  assert.deepEqual([p.PQ, p.VQ, p.MQ, p.F, p.G], [320, 120, 200, 164, 36])
  assert.equal(p.ratio, 82)
  assert.equal(p.grade, 'B')
  // 経営計画書に無い項目は出さない
  assert.deepEqual([p.share, p.debt, p.equity], [null, null, null])
  // 計画を書いていない期は null
  assert.equal(rows[1].plan, null)
})
