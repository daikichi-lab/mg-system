// サブリース経営MG シミュレーション v2 の実行と集計（人駒の市場・入居者の入札）。
// 使い方（app/ で）：
//   node sim/sublease/v2/run.mjs                                  # 既定の数値で 4・5・6人 × 各100ゲーム
//   node sim/sublease/v2/run.mjs --set '{"corpCancel":"half"}'    # 数値を一時的に上書き
//   node sim/sublease/v2/run.mjs --players 5 --games 200 --seed 3
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
  console.log(
    `${n}人 G中央値 ${[0, 1, 2, 3, 4].map(med).join(' / ')} ｜3期 黒字${pct(mean(h3.map((x) => (x.G > 0 ? 1 : 0))))} 入居${pct(allOcc(2))} 分岐${pct(q(h3.map((x) => x.bepRate).filter((v) => v != null), 0.5))} 棟${mean(h3.map((x) => x.bldgs)).toFixed(1)} ` +
      `｜3期末の法人比率${pct(mean(h3.map((x) => x.corpShare)))} 5期末${pct(mean(H.map((p) => p.hist[4].corpShare)))} ｜3期の入居契約 法人${mean(c3.map((c) => c.corp)).toFixed(1)}・個人${mean(c3.map((c) => c.indiv)).toFixed(1)}・学生${mean(c3.map((c) => c.stud)).toFixed(1)} ` +
      `｜法人解約 ${(cancelled / games).toFixed(1)}室/ゲーム ｜ショート30以上 ${pct(mean(H.map((p) => (p.hist.some((h) => h.shortBig) ? 1 : 0))))} ｜最終純資産${f0(q(H.map((p) => p.hist.at(-1).equity), 0.5))} ` +
      `｜1位 ${PERSONA_KEYS.map((k) => k.slice(0, 3) + pct((wins[k] || 0) / games)).join(' ')} ｜方針 1棟${pct(winOpen.focus / games)} 増やす${pct(winOpen.spread / games)}`,
  )
}
