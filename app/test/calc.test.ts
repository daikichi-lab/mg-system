// golden-master：TS 計算エンジンの出力が golden.json（期待値スナップショット）と厳密一致することを検証。
// golden.json は元々プロトタイプ（mock、2026-09 に削除）から生成した値で、今は現行エンジンのスナップショットとして扱う。
// 意図して数値を変えるときは gen-golden.ts で作り直す（CLAUDE.md「計算エンジンを変更したとき」参照）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scenarios } from './scenarios.mjs'
import { runScenario, type Sc } from './run-scenario.ts'

type Golden = { name: string; results: Record<string, unknown>[] }[]
const golden: Golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'))

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
            `${sc.name} P${res.period} .${k}: TS=${mv} vs golden=${gv}`,
          )
        } else if (Array.isArray(gv)) {
          const ma = mv as number[]
          gv.forEach((gx, j) =>
            assert.ok(
              typeof gx !== 'number' || near(ma[j], gx),
              `${sc.name} P${res.period} .${k}[${j}]: TS=${ma[j]} vs golden=${gx}`,
            ),
          )
        } else if (typeof gv === 'string') {
          assert.equal(mv, gv, `${sc.name} P${res.period} .${k}`)
        }
      }
    })
  })
}
