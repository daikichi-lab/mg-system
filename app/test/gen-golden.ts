// golden.json（golden-master の期待値スナップショット）を TS 計算エンジンから生成する。
//
// 使いどころ：ルールや計算式を「意図して」変えた PR で、変わった期待値を取り込むとき。
//   cd app && npm run gen:golden && npm run test:calc
// 数値を変えない変更で実行してはいけない（差分が出たらそれは回帰なので、golden.json ではなく calc.ts を直す）。
//
// 出力形式：[{ name, results: [各期の Result（rows を除く）] }]。
// rows（決算書の明細行）は表示用で数値検証の対象外なので落とす。
import { writeFileSync } from 'node:fs'
import { scenarios } from './scenarios.mjs'
import { runScenario, type Sc } from './run-scenario.ts'

const golden = (scenarios as Sc[]).map((sc) => ({
  name: sc.name,
  results: runScenario(sc).map((res) => {
    const { rows: _rows, ...rest } = res as unknown as Record<string, unknown> & { rows?: unknown }
    return rest
  }),
}))

// --out <path> を付けると別ファイルへ書く（既存 golden.json と比較したいとき用）。既定は test/golden.json を上書き
const outIdx = process.argv.indexOf('--out')
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : new URL('./golden.json', import.meta.url).pathname
writeFileSync(outPath, JSON.stringify(golden, null, 2))

const periods = golden.reduce((s, g) => s + g.results.length, 0)
console.log(`golden written: ${outPath} (${golden.length} scenarios, ${periods} period-results)`)
for (const g of golden) {
  console.log('  -', g.name, g.results.map((r) => `P${r.period}:G=${r.G},diff=${r.diff}`).join('  '))
}
