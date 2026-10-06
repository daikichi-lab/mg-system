// サブリース経営MG シミュレーションの実行と集計（issue #104）。
//
// 使い方（app/ で）：
//   node sim/sublease/run.mjs                       # 4・5・6人 × 各100ゲーム、既定の数値（設計案のまま）
//   node sim/sublease/run.mjs --params tuned        # 調整後の数値案
//   node sim/sublease/run.mjs --players 5 --games 300 --seed 7
//   node sim/sublease/run.mjs --set '{"hq":30}'     # 数値を一時的に上書きして試す
//   node sim/sublease/run.mjs --json out.json       # 集計を JSON でも書き出す
//   node sim/sublease/run.mjs --brief 1             # 人数ごとに1行の要約だけ出す
// 乱数の種（--seed）が同じなら結果も同じになる。

import { writeFileSync } from 'node:fs'
import { paramsOf } from './params.mjs'
import { playGame, rng } from './game.mjs'
import { PERSONA_KEYS } from './bots.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
)
const playerCounts = (args.players || '4,5,6').split(',').map(Number)
const games = Number(args.games || 100)
const seed = Number(args.seed || 1)
const P = paramsOf(args.params || 'base', args.set ? JSON.parse(args.set) : {})

// ---- 集計の道具 ----
const sum = (a) => a.reduce((s, v) => s + v, 0)
const mean = (a) => (a.length ? sum(a) / a.length : NaN)
const q = (a, p) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
}
const f0 = (v) => (Number.isFinite(v) ? Math.round(v).toString() : '-')
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-')
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '-')

function runFor(n) {
  const rand = rng(seed * 1000 + n)
  const players = [] // { persona, hist, game, shortCount }
  const gamesOut = []
  const auctions = []
  let deckOut = 0
  for (let g = 0; g < games; g++) {
    // 席ごとの性格はランダム（同じ卓に同じ性格が並ぶこともある）
    const personas = Array.from({ length: n }, () => PERSONA_KEYS[Math.floor(rand() * PERSONA_KEYS.length)])
    const G = playGame(P, personas, Math.floor(rand() * 2 ** 31))
    for (const p of G.players) players.push({ persona: p.persona, opening: p.opening, hist: p.hist, game: g })
    auctions.push(...G.auctions)
    if (!G.bdeck.length) deckOut++
    const eq = G.players.map((p) => p.hist.at(-1).equity)
    const best = Math.max(...eq)
    gamesOut.push({ spread: best - Math.min(...eq), winner: G.players[eq.indexOf(best)].persona, winnerOpening: G.players[eq.indexOf(best)].opening })
  }
  return { n, players, gamesOut, auctions, deckOut }
}

function report(r) {
  const { n, players, gamesOut, auctions } = r
  const lines = []
  lines.push(`\n## ${n}人卓（${games}ゲーム・${players.length}社）\n`)
  lines.push('| 期 | 経常利益 G 中央値 | 平均 | 下位10% | 上位10% | 黒字の会社 | 累計で資本金超え | 棟数 | 入居率 | 損益分岐入居率 | 法人比率 | 平均家賃 | 手番 | 資金ショート |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (let k = 0; k < P.periods; k++) {
    const h = players.map((p) => p.hist[k])
    const Gs = h.map((x) => x.G)
    lines.push(
      `| ${k + 1} | ${f0(q(Gs, 0.5))} | ${f0(mean(Gs))} | ${f0(q(Gs, 0.1))} | ${f0(q(Gs, 0.9))} | ${pct(mean(Gs.map((v) => (v > 0 ? 1 : 0))))} | ${pct(
        mean(h.map((x) => (x.equity > P.capital ? 1 : 0))),
      )} | ${f1(mean(h.map((x) => x.bldgs)))} | ${pct(mean(h.map((x) => x.occRate)))} | ${pct(q(h.map((x) => x.bepRate).filter((v) => v != null), 0.5))} | ${pct(
        mean(h.map((x) => x.corpShare)),
      )} | ${f1(mean(h.filter((x) => x.occ).map((x) => x.avgRent)))} | ${f1(mean(h.map((x) => x.turns)))} | ${pct(mean(h.map((x) => (x.short > 0 ? 1 : 0))))} |`,
    )
  }
  // 第3期の内訳（どこで黒字・赤字が決まるか）
  const h3 = players.map((p) => p.hist[Math.min(2, P.periods - 1)])
  const keys = [...new Set(h3.flatMap((x) => Object.keys(x.Fb)))]
  lines.push(`\n第3期の平均：PQ ${f0(mean(h3.map((x) => x.PQ)))} ／ VQ ${f0(mean(h3.map((x) => x.VQ)))} ／ F ${f0(mean(h3.map((x) => x.F)))}（${keys
    .map((k) => `${k} ${f0(mean(h3.map((x) => x.Fb[k] || 0)))}`)
    .join('・')}）`)
  lines.push(`入居契約（1社1期あたり・第3期）：法人 ${f1(mean(h3.map((x) => x.contracts.corp)))}・個人 ${f1(mean(h3.map((x) => x.contracts.indiv)))}・学生 ${f1(mean(h3.map((x) => x.contracts.stud)))}`)
  // 入札
  lines.push(
    `個人市場の入札：${f1(auctions.length / games / P.periods)}回／期・参加 平均${f1(mean(auctions.map((a) => a.n)))}社・宣言 ${f1(mean(auctions.map((a) => a.seats)))}室のうち ${pct(
      sum(auctions.map((a) => a.filled)) / sum(auctions.map((a) => a.seats)),
    )}が成約・入札額の中央値 ${f0(q(auctions.flatMap((a) => a.prices), 0.5))}`,
  )
  // 順位
  lines.push(
    `最終（第${P.periods}期末）の純資産：中央値 ${f0(q(players.map((p) => p.hist.at(-1).equity), 0.5))}・1位と最下位の差の中央値 ${f0(q(gamesOut.map((g) => g.spread), 0.5))}・物件の山札が尽きたゲーム ${pct(
      r.deckOut / games,
    )}`,
  )
  // 性格ごと
  lines.push('\n| 性格 | 社数 | G 第1期 | 第2期 | 第3期 | 第4期 | 第5期 | 最終純資産 中央値 | 1位になった率 | 資金ショート |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const key of PERSONA_KEYS) {
    const ps = players.filter((p) => p.persona === key)
    if (!ps.length) continue
    const g = (k) => f0(q(ps.map((p) => p.hist[k].G), 0.5))
    const wins = gamesOut.filter((x) => x.winner === key).length
    const appear = new Set(ps.map((p) => p.game)).size
    lines.push(
      `| ${key} | ${ps.length} | ${g(0)} | ${g(1)} | ${g(2)} | ${g(3)} | ${g(4)} | ${f0(q(ps.map((p) => p.hist.at(-1).equity), 0.5))} | ${pct(wins / appear)} | ${pct(
        mean(ps.map((p) => (p.hist.some((h) => h.short > 0) ? 1 : 0))),
      )} |`,
    )
  }
  return lines.join('\n')
}

/** 1行の要約（数値を何通りも比べるとき用）：人数・期別 G 中央値・第3期の黒字率・入居率・資金ショート・性格別の1位率 */
function brief(r) {
  const { n, players, gamesOut } = r
  const med = (k) => f0(q(players.map((p) => p.hist[k].G), 0.5))
  const h3 = players.map((p) => p.hist[2])
  const win = PERSONA_KEYS.map((k) => `${k.slice(0, 3)}${pct(gamesOut.filter((g) => g.winner === k).length / games)}`).join(' ')
  // 開業の方針ごと（時間制の資本金の検証用）：第1期の G・最終純資産・1位率
  const op = ['focus', 'spread']
    .map((o) => {
      const ps = players.filter((p) => p.opening === o)
      return `${o === 'focus' ? '1棟' : '2棟'} 1期${f0(q(ps.map((p) => p.hist[0].G), 0.5))} 最終${f0(q(ps.map((p) => p.hist.at(-1).equity), 0.5))} 1位${pct(gamesOut.filter((g) => g.winnerOpening === o).length / games)}`
    })
    .join(' ／ ')
  const turns = f1(mean(players.map((p) => p.hist[1].turns)))
  return `${n}人 手番/期${turns} G中央値 ${Array.from({ length: P.periods }, (_, k) => med(k)).join(' / ')} ｜3期 黒字${pct(mean(h3.map((x) => (x.G > 0 ? 1 : 0))))} 入居${pct(
    mean(h3.map((x) => x.occRate)),
  )} 分岐${pct(q(h3.map((x) => x.bepRate).filter((v) => v != null), 0.5))} 棟${f1(mean(h3.map((x) => x.bldgs)))} 家賃${f1(mean(h3.filter((x) => x.occ).map((x) => x.avgRent)))} ｜ショート ${pct(
    mean(players.map((p) => (p.hist.some((h) => h.shortNew) ? 1 : 0))),
  )}（期別 ${Array.from({ length: P.periods }, (_, k) => pct(mean(players.map((p) => (p.hist[k].shortNew ? 1 : 0))))).join('/')}） 30以上 ${pct(mean(players.map((p) => (p.hist.some((h) => h.shortBig) ? 1 : 0))))} ｜最終純資産${f0(q(players.map((p) => p.hist.at(-1).equity), 0.5))} ｜1位 ${win} ｜開業 ${op}`
}

const results = playerCounts.map(runFor)
if (args.brief) {
  for (const r of results) console.log(brief(r))
  process.exit(0)
}
console.log(`# サブリース経営MG シミュレーション（数値：${args.params || 'base'}${args.set ? ' ＋ ' + args.set : ''}・seed ${seed}）`)
for (const r of results) console.log(report(r))
if (args.json) {
  const slim = results.map((r) => ({
    n: r.n,
    periods: Array.from({ length: P.periods }, (_, k) => {
      const h = r.players.map((p) => p.hist[k])
      return { G: h.map((x) => x.G), occRate: h.map((x) => x.occRate), equity: h.map((x) => x.equity), persona: r.players.map((p) => p.persona) }
    }),
  }))
  writeFileSync(args.json, JSON.stringify({ params: P, seed, games, results: slim }))
}
