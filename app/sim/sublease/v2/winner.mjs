// 1位になった会社が何をしていたかを、期ごとにまとめて出す（5人卓・100ゲームのうち、1位の最終純資産が中央値のゲーム）。
// 使い方（app/ で）：node sim/sublease/v2/winner.mjs
import { paramsV2 } from './params.mjs'
import { playGame } from './game.mjs'
import { rng } from '../game.mjs'

const P = paramsV2({ trace: true })
const rand = rng(7)
const games = []
for (let g = 0; g < 100; g++) {
  const seed = Math.floor(rand() * 1e9)
  const G = playGame(P, Array(5).fill('x'), seed)
  const best = G.players.reduce((a, b) => (b.hist[4].equity > a.hist[4].equity ? b : a))
  games.push({ seed, eq: best.hist[4].equity })
}
// 1位の最終純資産が中央値のゲームを選び、記録つきでもう一度回す
games.sort((a, b) => a.eq - b.eq)
const pick = games[games.length >> 1]
const G = playGame(P, Array(5).fill('x'), pick.seed)
const rank = [...G.players].sort((a, b) => b.hist[4].equity - a.hist[4].equity)
const w = rank[0]
const AL = { city: '都市', suburb: '郊外', rural: '地方' }
const f0 = (v) => Math.round(v).toLocaleString('ja-JP')
const s = w.strat
console.log(`## 1位の会社（${w.id + 1}社）`)
console.log(`戦い方：値引きの基本 ${s.disc}・1期に借りる棟 ${s.leasePerPeriod}まで・現金の余裕 ${s.buffer}・営業チップの好み ${s.chipW.toFixed(1)}・広告 ${s.adW.toFixed(1)}・リノベ ${s.renoW.toFixed(1)}・採用 ${s.hireW.toFixed(1)}・借り上げ ${s.leaseW.toFixed(1)}・保険 ${s.ins ? 'あり' : 'なし'}・借入 ${s.borrow ? 'する' : 'しない'}`)
console.log('\n卓の順位（最終純資産）：' + rank.map((p, i) => `${i + 1}位 ${p.id + 1}社 ${f0(p.hist[4].equity)}`).join(' ／ '))
console.log('\n| 期 | 経常利益 | 家賃収入 | 借上げ賃料 | 給料 | 棟（期末） | 入居（法人／個人／学生） | 入居率 | 行動 | 現金 | 借入 |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|')
for (const h of w.hist) {
  const ev = G.trace.filter((e) => e.p === w.id && e.period === h.period && e.ctx && e.ctx.who === w.id)
  const cnt = (re) => ev.filter((e) => e.k === 'note' && re.test(e.note)).length
  const bids = ev.filter((e) => e.k === 'note' && e.note.startsWith('入札') && e.note.includes(`親 ${w.id + 1}社`)).length
  const acts = [
    ['借り上げ', cnt(/^物件を借り上げる/)], ['入札（親）', bids], ['営業採用', cnt(/^営業スタッフを採用/)], ['管理採用', cnt(/^管理スタッフを採用/)],
    ['リノベ', cnt(/^リノベ/)], ['営業チップ', ev.filter((e) => e.k === 'salesChip').length], ['広告', ev.filter((e) => e.k === 'ads').length], ['ロック', ev.filter((e) => e.k === 'lock').length],
  ].filter(([, n]) => n).map(([k, n]) => `${k}${n}`).join('・')
  const won = G.trace.filter((e) => e.p === w.id && e.period === h.period && e.k === 'note' && e.note.startsWith('入居')).length
  console.log(`| ${h.period} | ${f0(h.G)} | ${f0(h.PQ)} | ${f0(h.Fb.ownerRent || 0)} | ${f0(h.Fb.salary || 0)} | ${h.bldgs}（都市${h.areas.city}・郊外${h.areas.suburb}・地方${h.areas.rural}） | ${h.mix.corp}／${h.mix.indiv}／${h.mix.stud} | ${Math.round(100 * h.occRate)}% | ${acts || '−'}（入居が決まった ${won}回） | ${f0(h.cash)} | − |`)
}
console.log('\n第5期末の拠点：' + ['city', 'suburb', 'rural'].map((a) => `${AL[a]} 営業${w.salesBy[a] || 0}・管理${w.mgmtBy[a] || 0}`).join(' ／ ') + `・リノベした部屋 ${w.bldgs.reduce((x, b) => x + b.rooms.filter((r) => r.reno).length, 0)}室・営業チップ ${w.salesChips}枚・借入 ${f0(w.loan)}`)
console.log('\n比べる：最下位の会社（' + (rank[4].id + 1) + `社）`)
for (const h of rank[4].hist) console.log(`  第${h.period}期 経常利益 ${f0(h.G)}・棟 ${h.bldgs}・入居率 ${Math.round(100 * h.occRate)}%・現金 ${f0(h.cash)}`)
console.log(`  第5期末の拠点：` + ['city', 'suburb', 'rural'].map((a) => `${AL[a]} 営業${rank[4].salesBy[a] || 0}・管理${rank[4].mgmtBy[a] || 0}`).join(' ／ ') + `・短期借入 ${f0(rank[4].short)}`)
