// 第1期（ルール説明の期）の台本を1社分たどり、手番ごとの現金・家賃・借上げ賃料と、期末の決算を出す（issue #104）。
// 講師の説明資料の元にする。使い方（app/ で）：node sim/sublease/tutorial-trace.mjs [--players 5]
import { paramsOf } from './params.mjs'
import { playGame } from './game.mjs'
import { TUTORIAL } from './tutorial.mjs'

const n = Number(process.argv[process.argv.indexOf('--players') + 1]) || 5
const P = paramsOf('tutorial')
const G = playGame(P, Array.from({ length: n }, () => 'standard'), 1)
const r = (v) => Math.round(v)
console.log(`# 第1期の台本（${n}人卓・1期${G.periodMin}分・資本金${P.capital}）\n`)
console.log('| 手番 | 内容 | 経過 | 現金 | 家賃（累計） | 借上げ賃料（累計） | 入居／募集中 |')
console.log('|---|---|---|---|---|---|---|')
G.tutorialLog.forEach((l, i) =>
  console.log(`| ${i} | ${l.title} | ${Math.round(l.at * 100)}% | ${r(l.cash)} | ${r(l.rev)} | ${r(l.own)} | ${l.occ}／${l.vac} |`),
)
const h = G.players[0].hist[0]
console.log(`\n期末：PQ ${r(h.PQ)} ／ VQ ${r(h.VQ)} ／ F ${r(h.F)}（${Object.entries(h.Fb).map(([k, v]) => `${k} ${r(v)}`).join('・')}） ／ G ${r(h.G)} ／ 法人税 ${h.tax}`)
console.log(`退去 ${h.evicted}室 → 第2期の期首：入居 ${h.occ - h.evicted}室・募集中 ${8 - (h.occ - h.evicted)}室 ／ 現金 ${r(h.cash)} ／ 純資産 ${r(h.equity)} ／ 営業${h.staff.sales}人・管理${h.staff.mgmt}人`)
console.log(`期間で重みづけした入居率 ${r(h.occRate * 100)}% ／ 損益分岐入居率 ${r(h.bepRate * 100)}%`)
console.log('\n説明すること：')
for (const s of TUTORIAL) console.log(`- ${s.title}：${s.teach.join('／')}`)
