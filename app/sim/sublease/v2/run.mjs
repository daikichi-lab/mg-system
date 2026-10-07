// サブリース経営MG シミュレーション v2 の実行と集計（人駒の市場・入居者の入札）。
// 使い方（app/ で）：
//   node sim/sublease/v2/run.mjs                                  # 既定の数値で 4・5・6人 × 各100ゲーム
//   node sim/sublease/v2/run.mjs --set '{"corpCancel":"half"}'    # 数値を一時的に上書き
//   node sim/sublease/v2/run.mjs --players 5 --games 200 --seed 3
//   node sim/sublease/v2/run.mjs --dist 1                         # 期ごとの最小・下位10%・中央値・上位10%・最大
import { paramsV2 } from './params.mjs'
import { playGame, PERSONA_KEYS } from './game.mjs'
import { rng } from '../game.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []))
const counts = (args.players || '4,5,6').split(',').map(Number)
const games = Number(args.games || 100)
const seed = Number(args.seed || 1)
const P = paramsV2(args.set ? JSON.parse(args.set) : {})

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN)
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.round(p * (s.length - 1))] }
const f0 = (v) => (Number.isFinite(v) ? Math.round(v).toString() : '-')
const pct = (v) => (Number.isFinite(v) ? Math.round(v * 100) + '%' : '-')

for (const n of counts) {
  const rand = rng(seed * 1000 + n)
  const H = []
  const wins = {}
  const winOpen = { focus: 0, spread: 0 }
  let cancelled = 0
  for (let g = 0; g < games; g++) {
    const G = playGame(P, Array.from({ length: n }, () => PERSONA_KEYS[Math.floor(rand() * PERSONA_KEYS.length)]), Math.floor(rand() * 2 ** 31))
    for (const p of G.players) H.push(p)
    const best = G.players.reduce((a, b) => (b.hist.at(-1).equity > a.hist.at(-1).equity ? b : a))
    wins[best.persona] = (wins[best.persona] || 0) + 1
    winOpen[best.opening]++
    cancelled += G.cancelled
  }
  const med = (k) => f0(q(H.map((p) => p.hist[k].G), 0.5))
  const h3 = H.map((p) => p.hist[2])
  const c3 = h3.map((x) => x.contracts)
  const allOcc = (k) => mean(H.map((p) => p.hist[k].occRate))
  if (args.dist) {
    // 期ごとの経常利益の分布：最小・下位10%・中央値・上位10%・最大（全社）
    console.log(`\n${n}人卓（${games}ゲーム・${H.length}社）`)
    console.log('| 期 | 最小 | 下位10% | 中央値 | 上位10% | 最大 | 黒字の会社 |')
    console.log('|---|---|---|---|---|---|---|')
    for (let k = 0; k < 5; k++) {
      const g = H.map((p) => p.hist[k].G)
      console.log(`| ${k + 1} | ${f0(Math.min(...g))} | ${f0(q(g, 0.1))} | ${f0(q(g, 0.5))} | ${f0(q(g, 0.9))} | ${f0(Math.max(...g))} | ${pct(mean(g.map((v) => (v > 0 ? 1 : 0))))} |`)
    }
    const eq = H.map((p) => p.hist[4].equity)
    console.log(`| 第5期末の純資産 | ${f0(Math.min(...eq))} | ${f0(q(eq, 0.1))} | ${f0(q(eq, 0.5))} | ${f0(q(eq, 0.9))} | ${f0(Math.max(...eq))} | 資本金400超え ${pct(mean(eq.map((v) => (v > 400 ? 1 : 0))))} |`)
    continue
  }
  console.log(
    `${n}人 G中央値 ${[0, 1, 2, 3, 4].map(med).join(' / ')} ｜3期 黒字${pct(mean(h3.map((x) => (x.G > 0 ? 1 : 0))))} 入居${pct(allOcc(2))} 分岐${pct(q(h3.map((x) => x.bepRate).filter((v) => v != null), 0.5))} 棟${mean(h3.map((x) => x.bldgs)).toFixed(1)} ` +
      `｜3期末の法人比率${pct(mean(h3.map((x) => x.corpShare)))} 5期末${pct(mean(H.map((p) => p.hist[4].corpShare)))} ｜3期の入居契約 法人${mean(c3.map((c) => c.corp)).toFixed(1)}・個人${mean(c3.map((c) => c.indiv)).toFixed(1)}・学生${mean(c3.map((c) => c.stud)).toFixed(1)} ` +
      `｜法人解約 ${(cancelled / games).toFixed(1)}室/ゲーム ｜ショート30以上 ${pct(mean(H.map((p) => (p.hist.some((h) => h.shortBig) ? 1 : 0))))} ｜最終純資産${f0(q(H.map((p) => p.hist.at(-1).equity), 0.5))} ` +
      `｜1位 ${PERSONA_KEYS.map((k) => k.slice(0, 3) + pct((wins[k] || 0) / games)).join(' ')} ｜3期の棟 都市${mean(H.map((p) => p.hist[2].areas.city)).toFixed(1)}・郊外${mean(H.map((p) => p.hist[2].areas.suburb)).toFixed(1)}・地方${mean(H.map((p) => p.hist[2].areas.rural)).toFixed(1)}`,
  )
}
