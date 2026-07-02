// golden-master parity: TS 計算エンジンが実 mock と同一の数値を出すことを検証。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scenarios } from './scenarios.mjs'
import * as calc from '../src/lib/calc.ts'
import type { Result, St } from '../src/lib/calc.ts'

type Golden = { name: string; results: Record<string, unknown>[] }[]
const golden: Golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'))

type Sc = {
  name: string
  capital: number
  loanMult?: number
  repayRate?: number
  periods: { key: string; fvals?: Record<string, unknown> }[][]
}

function runScenario(sc: Sc): Result[] {
  const st: St = calc.newState()
  st.name = 'X'
  st.president = 'P'
  st.org = 'O'
  st.started = true
  if (sc.loanMult != null) st.loanMult = sc.loanMult
  if (sc.repayRate != null) st.repayRate = sc.repayRate
  st.tx.push({ id: st.seq++, label: '資本金', col: 0, amount: sc.capital, isCapital: true })
  const results: Result[] = []
  sc.periods.forEach((acts, pi) => {
    acts.forEach((a) => {
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
    const res = calc.settle(st)!
    results.push(JSON.parse(JSON.stringify(res)))
    if (pi < sc.periods.length - 1) calc.nextPeriod(st)
  })
  return results
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

for (const sc of scenarios as Sc[]) {
  test(`parity: ${sc.name}`, () => {
    const g = golden.find((x) => x.name === sc.name)
    assert.ok(g, `golden missing for ${sc.name}`)
    const mine = runScenario(sc)
    assert.equal(mine.length, g!.results.length, '期数が一致')
    mine.forEach((res, i) => {
      const gold = g!.results[i] as Record<string, unknown>
      // 貸借一致（本番でも常に成立すべき不変条件）
      assert.ok(near(res.diff, 0), `${sc.name} P${res.period}: B/S diff=${res.diff} (期待0)`)
      for (const [k, gv] of Object.entries(gold)) {
        if (k === 'rows') continue
        const mv = (res as unknown as Record<string, unknown>)[k]
        if (typeof gv === 'number') {
          assert.ok(
            near(mv as number, gv),
            `${sc.name} P${res.period} .${k}: TS=${mv} vs mock=${gv}`,
          )
        } else if (Array.isArray(gv)) {
          const ma = mv as number[]
          gv.forEach((gx, j) =>
            assert.ok(
              typeof gx !== 'number' || near(ma[j], gx),
              `${sc.name} P${res.period} .${k}[${j}]: TS=${ma[j]} vs mock=${gx}`,
            ),
          )
        } else if (typeof gv === 'string') {
          assert.equal(mv, gv, `${sc.name} P${res.period} .${k}`)
        }
      }
    })
  })
}
