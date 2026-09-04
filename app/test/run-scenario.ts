// golden-master 用のシナリオ実行ヘルパ。
// scenarios.mjs の 1 シナリオ（資本金＋各期の記帳行）を TS 計算エンジンで最初から最後まで走らせ、
// 各期の決算結果（Result）を配列で返す。calc.test.ts（検証）と gen-golden.ts（期待値の生成）が共有する。
import * as calc from '../src/lib/calc.ts'
import type { Result, St } from '../src/lib/calc.ts'

// scenarios.mjs の 1 件の形。periods[i] が第 i+1 期に記帳する行の並び。
export type Sc = {
  name: string
  capital: number
  loanMult?: number
  repayRate?: number
  periods: { key: string; fvals?: Record<string, unknown> }[][]
}

// シナリオを実行して各期の Result を返す。
// - 会社名などは固定値（数値に影響しない）
// - loanMult / repayRate はシナリオに指定があるときだけ上書きする（未指定なら newState() の既定値）
// - 各期は「記帳行を積む → recompute → 期末処理 → 決算」の順で、最終期以外は nextPeriod で次期へ引き継ぐ
export function runScenario(sc: Sc): Result[] {
  const st: St = calc.newState()
  st.name = 'X'
  st.president = 'P'
  st.org = 'O'
  st.started = true
  if (sc.loanMult != null) st.loanMult = sc.loanMult
  if (sc.repayRate != null) st.repayRate = sc.repayRate
  // 資本金は記帳行として先頭に積む（入金列 0・isCapital）
  st.tx.push({ id: st.seq++, label: '資本金', col: 0, amount: sc.capital, isCapital: true })
  const results: Result[] = []
  sc.periods.forEach((acts, pi) => {
    acts.forEach((a) => {
      // 記帳行の列と金額はアクション定義（ACTIONS）から決まる。amount が undefined のアクションは 0 扱い
      const def = calc.ACTIONS[a.key]
      st.tx.push({
        id: st.seq++,
        key: a.key,
        fvals: a.fvals || {},
        col: def.col,
        amount: def.amount(a.fvals || {}) || 0,
      })
    })
    calc.recompute(st)
    calc.doClosingPrep(st)
    // settle() は決算できないとき null を返すが、golden シナリオは必ず決算できる前提なので非 null を要求する
    const res = calc.settle(st)!
    results.push(JSON.parse(JSON.stringify(res)))
    if (pi < sc.periods.length - 1) calc.nextPeriod(st)
  })
  return results
}
