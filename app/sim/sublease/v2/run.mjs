// サブリース経営MG シミュレーション v2 の実行と集計（人駒の市場・入居者の入札）。
// 使い方（app/ で）：
//   node sim/sublease/v2/run.mjs                                  # 既定の数値で 4・5・6人 × 各100ゲーム
//   node sim/sublease/v2/run.mjs --set '{"corpCancel":"half"}'    # 数値を一時的に上書き
//   node sim/sublease/v2/run.mjs --players 5 --games 200 --seed 3
//   node sim/sublease/v2/run.mjs --dist 1                         # 期ごとの最小・下位10%・中央値・上位10%・最大
import { paramsV2 } from './params.mjs'
import { playGame, PERSONA_KEYS as DEFAULT_KEYS, STYLE_KEYS } from './game.mjs'
import { rng } from '../game.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []))
const counts = (args.players || '4,5,6').split(',').map(Number)
const games = Number(args.games || 100)
const seed = Number(args.seed || 1)
const P = paramsV2(args.set ? JSON.parse(args.set) : {})
// --personas corpFocus,indivFocus,... で卓に座る性格の候補を変える（席ごとにランダム）
// smart のときは、会社ごとの戦い方を「絞る／広げる × 高く貸す／安く貸す」の4つに分けて集計する
const PERSONA_KEYS = args.personas ? args.personas.split(',') : P.bot === 'smart' ? STYLE_KEYS : DEFAULT_KEYS

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
    const G = playGame(P, Array.from({ length: n }, () => (P.bot === 'smart' ? DEFAULT_KEYS[0] : PERSONA_KEYS[Math.floor(rand() * PERSONA_KEYS.length)])), Math.floor(rand() * 2 ** 31))
    for (const p of G.players) { p.game = g; H.push(p) }
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
    // 性格ごと：第3期・第5期の G 中央値、最終純資産の中央値と最小・最大、1位になった率
    console.log('\n| 性格 | 社数 | 第3期 G 中央値 | 第5期 G 中央値 | 最終純資産 中央値 | 最小 | 最大 | 1位になった率 | 第5期末の法人／個人／学生 |')
    console.log('|---|---|---|---|---|---|---|---|---|')
    for (const k of PERSONA_KEYS) {
      const A = H.filter((p) => p.persona === k)
      if (!A.length) continue
      const appear = new Set(A.map((p) => p.game)).size // その戦い方の会社がいたゲームの数
      const eqk = A.map((p) => p.hist[4].equity)
      const mix = A.map((p) => p.hist[4].mix)
      console.log(`| ${k} | ${A.length} | ${f0(q(A.map((p) => p.hist[2].G), 0.5))} | ${f0(q(A.map((p) => p.hist[4].G), 0.5))} | ${f0(q(eqk, 0.5))} | ${f0(Math.min(...eqk))} | ${f0(Math.max(...eqk))} | ${pct((wins[k] || 0) / appear)} | ${mean(mix.map((m) => m.corp)).toFixed(1)}／${mean(mix.map((m) => m.indiv)).toFixed(1)}／${mean(mix.map((m) => m.stud)).toFixed(1)} |`)
    }
    // smart：戦い方の数値ごとに、最終純資産の中央値を比べる（どんな戦い方が勝つか）
    if (P.bot === 'smart') {
      console.log('\n| 戦い方の数値 | 低い | 中 | 高い |')
      console.log('|---|---|---|---|')
      const rows = [['値引きの基本（disc）', (s) => s.disc, [0, 2, 4, 6]], ['棟の上限', (s) => s.maxBldg, [2, 3, 4, 6]], ['1期に借りる棟', (s) => s.leasePerPeriod, [1, 1, 2, 2]], ['営業チップの好み', (s) => s.chipW, [0.5, 0.83, 1.17, 1.5]], ['採用の好み', (s) => s.hireW, [0.6, 0.87, 1.13, 1.4]], ['借りる好み', (s) => s.leaseW, [0.6, 0.87, 1.13, 1.4]], ['現金の余裕', (s) => s.buffer, [0, 20, 40, 60]]]
      for (const [name, f, [a, b, c, d]] of rows) {
        const cell = (lo, hi) => { const v = H.filter((p) => f(p.strat) >= lo && f(p.strat) <= hi).map((p) => p.hist[4].equity); return v.length ? `${f0(q(v, 0.5))}（${v.length}社）` : '-' }
        console.log(`| ${name} | ${a}〜${b}：${cell(a, b - 1e-9 + (b === c ? 1e-9 : 0))} | ${b === c ? '-' : `${b}〜${c}：${cell(b, c - 1e-9)}`} | ${c}〜${d}：${cell(c, d)} |`)
      }
      console.log('（数値は第5期末の純資産の中央値）')
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
