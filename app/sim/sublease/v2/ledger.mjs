// 第N期の経常利益が中央値の会社（5人卓・100ゲーム）の、手番ごとの記帳を出す。
// 使い方（app/ で）：node sim/sublease/v2/ledger.mjs 3   # 第3期
import { paramsV2 } from './params.mjs'
import { playGame, PERSONA_KEYS } from './game.mjs'
import { rng } from '../game.mjs'
const per = Number(process.argv[2] || 3)
const P = paramsV2()
const rand = rng(5005); const runs = []
for (let g = 0; g < 100; g++) { const ps = Array.from({ length: 5 }, () => PERSONA_KEYS[Math.floor(rand() * 4)]); runs.push({ ps, seed: Math.floor(rand() * 1e9) }) }
const all = []
for (const r of runs) { const G = playGame({ ...P, periods: per }, r.ps, r.seed); G.players.forEach((p, i) => all.push({ r, i, g: p.hist[per - 1].G })) }
all.sort((a, b) => a.g - b.g); const m = all[all.length >> 1]
const G = playGame({ ...P, periods: per, trace: true }, m.r.ps, m.r.seed)
const me = m.i, p = G.players[me]
const COL = { rent: ['ウ', '家賃収入'], loan: ['イ', '借入'], short: ['イ', '短期借入'], furniture: ['エ', '家具家電'], ownerRent: ['オ', '借上げ賃料'], hire: ['カ', '採用費'], salary: ['カ', '給料'], V: ['キ', '入居費用'], ads: ['キ', '広告'], salesChip: ['キ', '営業チップ'], hq: ['ク', '営業所の家賃'], reno: ['ク', 'リノベ'], lock: ['ク', 'スマートロック'], insurance: ['ク', '保険'], repair: ['ク', '修繕'], restore: ['ク', '原状回復'], claim: ['ク', 'クレーム'], lawsuit: ['ク', '訴訟'], defect: ['ク', '改修'], arrears: ['ク', '滞納'], interest: ['ク', '金利'], shortInterest: ['ク', '短期の金利'], transfer: ['ク', '配置転換'], repay: ['ケ', '返済'], tax: ['コ', '法人税'] }
const ev = G.trace.filter((e) => e.period === per && e.p === me)
const groups = []
for (const e of ev) {
  const key = e.ctx?.phase ? e.ctx.phase : `${e.ctx.who}-${e.ctx.turn}`
  let g = groups.at(-1)
  if (!g || g.key !== key) groups.push((g = { key, ctx: e.ctx, items: [] }))
  g.items.push(e)
}
const nm = (c) => (c.phase === 'start' ? '期首' : c.phase === 'end' ? '期末' : c.who === me ? `**${c.turn}**` : `（${c.who + 1}社の手番）`)
const time = (c) => (c.clock != null ? `${Math.floor(c.clock)}:${String(Math.round((c.clock % 1) * 60)).padStart(2, '0')}` : '')
console.log(`第${per}期・${me + 1}社（性格 ${p.persona}）・経常利益 ${Math.round(p.hist[per - 1].G)}\n`)
console.log('| 手番 | 時刻 | 出来事 | 記帳（列・科目・金額） | 現金 |')
console.log('|---|---|---|---|---|')
for (const g of groups) {
  const notes = g.items.filter((e) => e.k === 'note').map((e) => e.note)
  const money = {}
  for (const e of g.items.filter((e) => e.k !== 'note')) { const [c, n] = COL[e.k] || ['?', e.k]; const k = `${c} ${n}`; money[k] = (money[k] || 0) + e.v }
  const ms = Object.entries(money).filter(([, v]) => Math.round(v)).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${Math.round(v)}`).join('、')
  console.log(`| ${nm(g.ctx)} | ${time(g.ctx)} | ${notes.join('<br>') || '−'} | ${ms || '−'} | ${Math.round(g.items.at(-1).cash)} |`)
}
const h = p.hist[per - 1]
console.log(`\n家賃収入 ${Math.round(h.PQ)} ／ 経常利益 ${Math.round(h.G)} ／ 入居率 ${Math.round(100 * h.occRate)}% ／ 自分の手番 ${h.turns}回`)
