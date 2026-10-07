// サブリース経営MG シミュレーションの自動プレイヤー（issue #104）。
//
// 研修の参加者がとりそうな判断を、性格（PERSONAS）ごとのしきい値で表す。最善手を探すものではない。
// 「空室を埋める → 家具を置く → 家具を買う → 能力を足す → 棟を増やす」の優先順で、
// 期末に払う借上げ賃料・給料を見込んで現金を残しながら行動する。

import {
  A,
  borrow,
  fracLeft,
  occupied,
  vacant,
  vacantOpen,
  unprepared,
  leaseCap,
  mgmtCap,
  mktOf,
  loanRoom,
} from './game.mjs'

/**
 * 性格。
 * - expandOcc：募集中＋入居中の部屋のうち入居がこの割合を超えたら、次の棟を借りる
 * - maxBldg：借りる棟の上限
 * - minRows：残りの行数がこれより少なければ棟を借りない（期末の借上げ賃料だけ払うことになるので）
 * - bidDisc：入札で相場からいくら下げるか（空室が多いほど さらに下げる）
 * - studMin：募集中の部屋がこれ以上あれば学生を入れる
 * - corpChips：法人営業チップを何枚まで買うか
 * - reno・lock・ins：リノベ・スマートロック・保険を使うか
 * - borrow：棟を増やすために借りるか（期末の支払いに足りないときは性格によらず借りる）
 * - buffer：手元に残す現金
 * - optimism：募集中の部屋がこの期のうちに埋まる見込み（現金の見通しに使う）
 * - negotiate：第3期の借上げ賃料の減額交渉をする確率
 * - indivFirst：法人より個人を先に埋める（単価重視）
 */
export const PERSONAS = {
  standard: { expandOcc: 0.75, maxBldg: 4, minRows: 10, bidDisc: 3, studMin: 3, corpChips: 1, reno: false, lock: false, ins: false, borrow: true, buffer: 20, optimism: 0.6, negotiate: 0.5, indivFirst: false },
  aggressive: { expandOcc: 0.5, maxBldg: 6, minRows: 6, bidDisc: 5, studMin: 1, corpChips: 2, reno: false, lock: false, ins: false, borrow: true, buffer: 0, optimism: 0.8, negotiate: 1, indivFirst: false },
  steady: { expandOcc: 0.9, maxBldg: 3, minRows: 14, bidDisc: 2, studMin: 4, corpChips: 3, reno: false, lock: true, ins: true, borrow: false, buffer: 50, optimism: 0.4, negotiate: 0, indivFirst: false },
  premium: { expandOcc: 0.8, maxBldg: 4, minRows: 10, bidDisc: 1, studMin: 8, corpChips: 0, reno: true, lock: false, ins: false, borrow: true, buffer: 20, optimism: 0.6, negotiate: 0.3, indivFirst: true },
}
export const PERSONA_KEYS = Object.keys(PERSONAS)
const ps = (p) => PERSONAS[p.persona]

/** 期末に払う見込み（借上げ賃料・給料・本社家賃・返済・短期借入） */
function endCost(G, p, extraOwn = 0) {
  const P = G.P
  // 行数制は期末に借上げ賃料をまとめて払う。時間制は手番ごとに払うので、残りの時間の分と未払いの積み立てだけ
  const own =
    P.pace === 'time'
      ? p.bldgs.reduce((s, b) => s + b.own * b.rooms.length, 0) * fracLeft(G, p) + p.pend.own + extraOwn
      : p.bldgs.reduce((s, b) => s + Math.round((b.own * b.rooms.length * (b.quarters ?? 4)) / 4), 0) + extraOwn
  // 期末の退去の原状回復費（入居の3割くらいが退去する見込み）と、イベント用の余裕 10 も見込む
  const restore = Math.ceil(occupied(p) * 0.3) * P.restore
  return own + (p.sales + p.mgmt) * P.salary[G.period - 1] + P.hq + Math.round(p.loan * P.repayRate) + p.short + restore + 10
}
/** この期にあと何回くらい入居契約できそうか（残りの行の半分くらいが意思決定で契約に回せる） */
function contractsLeft(G, p) {
  const P = G.P
  if (P.pace === 'time') {
    // 残り時間 ÷（人数 × 1手番の平均時間）＝ 自分の残りの手番。その6割くらいを契約に回せる
    const turns = ((G.periodMin - Math.min(G.clock, G.periodMin)) / (G.players.length * ((P.turnMin[0] + P.turnMin[1]) / 2 + 0.3))) | 0
    return Math.max(0, Math.floor(turns * 0.6))
  }
  return Math.max(0, Math.floor((G.rowLimit - p.rows) * 0.45))
}
/** 期末の現金の見通し：今の現金 − 期末の支払い ＋ 募集中の部屋が埋まる見込みの家賃 */
function outlook(G, p, extraOwn = 0) {
  const P = G.P
  const vac = vacantOpen(p)
  const canFill = Math.min(vac, contractsLeft(G, p) * leaseCap(P, p))
  if (!p.bldgs.length) return p.cash - endCost(G, p)
  const avgMkt = p.bldgs.reduce((s, b) => s + mktOf(P, p, b), 0) / p.bldgs.length
  // 借入できない期（第1期）は、期末に足りなくなっても埋められないので、空室が埋まる見込みを半分に見る
  // （アプリでは「期末の支払い見込み」を画面に出す前提。参加者はそれを見て判断できる）
  const opt = loanRoom(P, p) > 0 || p.period >= P.loanFrom ? ps(p).optimism : ps(p).optimism * 0.5
  // 時間制：入居中の部屋はこの先も家賃が積み立たる（残りの時間の分）。新しく埋めた部屋は残りの時間の半分くらい
  const keep = P.pace === 'time' ? occRent(p) * fracLeft(G, p) + p.pend.rent : 0
  const fillShare = P.pace === 'time' ? fracLeft(G, p) * 0.5 : fracLeft(G, p)
  return p.cash - endCost(G, p, extraOwn) + keep + canFill * ((avgMkt - 3) * fillShare - P.V) * opt
}
const occRent = (p) => p.bldgs.reduce((s, b) => s + b.rooms.reduce((a, r) => a + (r.st === 'occ' ? r.rent : 0), 0), 0)
const canSpend = (G, p, amt) => p.cash >= amt && outlook(G, p) - amt >= ps(p).buffer

/** 手番の前のルールB：期末の支払いに足りない見込みなら借りる。棟を増やすための借入は性格次第 */
export function preTurn(G, p) {
  const P = G.P
  const room = loanRoom(P, p)
  if (room <= 0) return
  const o = outlook(G, p)
  let need = 0
  if (o < 0) need = -o + 10
  else if (ps(p).borrow && wantExpand(G, p) && p.cash < P.furnPrice * P.roomsPerBldg + 20) need = P.furnPrice * P.roomsPerBldg + 40 - p.cash
  if (need <= 0) return
  borrow(G, p, Math.min(room, Math.ceil(need / 10) * 10))
  p.rows++
}

/** 棟を増やしたいか（入居が進んでいて、行も現金も足りる） */
function wantExpand(G, p) {
  const P = G.P
  const s = ps(p)
  // 1棟を育てる方針（focus）は2棟まで。説明の期があるときだけ（方針は第2期に決める）
  const cap = P.tutorial && p.opening === 'focus' ? Math.min(2, s.maxBldg) : s.maxBldg
  if (p.bldgs.length >= Math.min(cap, P.maxBldg) || !G.market.length) return false
  if (G.P.pace === 'time' ? fracLeft(G, p) < s.minRows / 45 : G.rowLimit - p.rows < s.minRows) return false
  if (unprepared(p) > 0) return false
  const occ = occupied(p)
  const vac = vacant(p)
  if (occ + vac === 0 || occ / (occ + vac) < s.expandOcc) return false
  // 卓の個人の入居希望者の残り（アプリの市場ボードに出す）を見て、新しい棟の8室を埋められそうなときだけ借りる。
  // 法人枠・学生の残りも足して数える。積極的な性格は見込みを甘く（半分で足りる）見る
  const corpLeft = Math.max(0, P.corpBase + p.corpChips * P.corpPerChip + (p.flags.corpBonus || 0) - p.corpUsed)
  const studLeft = p.turnNo < P.studTurns ? Math.max(0, P.studMax - p.studUsed) : 0
  const indivShare = G.indivLeft === Infinity ? Infinity : G.indivLeft / G.players.length
  const fillable = indivShare + corpLeft + studLeft - vac
  if (fillable < P.roomsPerBldg * (s.expandOcc <= 0.5 ? 0.5 : 0.8)) return false
  return true
}
/** 表向きの棟カードから、相場と借上げ賃料の差（1室の粗利）が大きいものを選ぶ */
function bestCard(G) {
  let best = 0
  let bv = -Infinity
  G.market.forEach((c, i) => {
    const a = G.P.areas[c.area]
    const v = a.mkt - a.own - (c.old ? 0.5 : 0)
    if (v > bv) {
      bv = v
      best = i
    }
  })
  return best
}

/** 開業で借りるときに一緒に買う家具：1棟を充実なら8セット、2棟にまんべんなくなら4セットずつ（現金の範囲） */
function openFurn(G, p) {
  const P = G.P
  const want = p.opening === 'spread' ? P.roomsPerBldg / 2 : P.roomsPerBldg
  return Math.max(0, Math.min(want, Math.floor((p.cash - ps(p).buffer / 2) / P.furnPrice)))
}
/** 開業準備：1棟を充実（1棟・家具8）か、2棟にまんべんなく（2棟・家具4ずつ） */
export function openingSetup(G, p) {
  const n = p.opening === 'spread' ? 2 : 1
  for (let i = 0; i < n && G.market.length; i++) A.lease(G, p, bestCard(G), openFurn(G, p))
}
/** 棟を増やすときに一緒に買う家具（現金の範囲で8セットまで） */
function expandFurn(G, p) {
  const P = G.P
  return Math.max(0, Math.min(P.roomsPerBldg, Math.floor((p.cash - ps(p).buffer) / P.furnPrice)))
}

/** 意思決定カードを引いたときのルールA（1つ） */
export function decide(G, p) {
  const P = G.P
  const s = ps(p)
  // 開業：物件を持っていなければ、まず借りる。2棟にまんべんなく（spread）の方針なら、家具を買う前に2棟目も借りる
  // 第1期が説明の期（tutorial）なら、方針を決めるのは第2期の最初の意思決定
  const openPeriod = P.tutorial ? 2 : 1
  if (G.market.length && (p.bldgs.length === 0 || (p.opening === 'spread' && G.period === openPeriod && p.bldgs.length === 1 && (P.tutorial || p.furn.length === 0))))
    if (A.lease(G, p, bestCard(G), openFurn(G, p))) return 'open-lease'
  const vac = vacantOpen(p)
  const lc = leaseCap(P, p)
  // 営業が足りず空室が溜まっているなら、先に採用（重い詰まりのときだけ）
  if (vac >= lc * 3 && p.sales < P.staffMax && canSpend(G, p, P.hireCost + P.salary[G.period - 1]))
    if (A.hire(G, p, 'sales', 1)) return 'hire-sales'
  // 1. 空室を埋める
  if (vac > 0) {
    if (!p.flags.pandemic && p.turnNo < P.studTurns && p.studUsed < P.studMax && vac >= s.studMin && A.stud(G, p)) return 'stud'
    const corpLeft = P.corpBase + p.corpChips * P.corpPerChip + (p.flags.corpBonus || 0) - p.corpUsed
    const tryCorp = () => corpLeft > 0 && A.corp(G, p)
    const tryIndiv = () => !p.flags.noIndiv && A.indiv(G, p)
    if (s.indivFirst ? tryIndiv() || tryCorp() : tryCorp() || tryIndiv()) return 'contract'
  }
  // 2. 倉庫の家具を部屋に置く
  if (unprepared(p) > 0 && p.wh > 0 && A.prepare(G, p)) return 'prepare'
  // 3. 家具を買う（未準備の部屋の分だけ）
  const needF = unprepared(p) - p.wh
  if (needF > 0) {
    // 借りている棟の家具は、借上げ賃料がもう決まっているので現金がある限り買う（買わないと空室のまま）
    const n = Math.min(needF, P.whCap - p.wh, Math.floor((p.cash - s.buffer / 2) / P.furnPrice))
    if (n > 0 && A.buyFurn(G, p, n)) return 'furniture'
  }
  // 4. 管理能力が足りなくなりそうなら、管理スタッフかスマートロック
  if (occupied(p) + vacant(p) > mgmtCap(P, p) - 2) {
    if (s.lock && p.locks < P.lockMax && canSpend(G, p, P.lockPrice) && A.lock(G, p)) return 'lock'
    if (p.mgmt < P.staffMax && canSpend(G, p, P.hireCost + P.salary[G.period - 1]) && A.hire(G, p, 'mgmt', 1)) return 'hire-mgmt'
  }
  // 5. 棟を増やす（期末の借上げ賃料と家具代を払っても見通しが残るときだけ）
  if (wantExpand(G, p)) {
    const i = bestCard(G)
    const c = G.market[i]
    const a = P.areas[c.area]
    // 按分のときは、借上げ賃料も家賃も残りの四半期分
    const qf = fracLeft(G, p)
    const own = (a.own + (c.old ? P.oldDelta : 0)) * P.roomsPerBldg * qf
    const cost = P.furnPrice * P.roomsPerBldg
    const gain = Math.min(P.roomsPerBldg, contractsLeft(G, p) * lc) * ((a.mkt - 3) * qf - P.V) * s.optimism
    if (p.cash >= cost * 0.5 && outlook(G, p, own) - cost + gain >= s.buffer && A.lease(G, p, i, expandFurn(G, p))) return 'lease'
  }
  // 6. 営業を増やす（空室がリーシング能力の2倍以上）
  if (vac >= lc * 2 && p.sales < P.staffMax && canSpend(G, p, P.hireCost + P.salary[G.period - 1]) && A.hire(G, p, 'sales', 1)) return 'hire-sales'
  // 7. 広告（個人市場の1回の室数を増やす）
  if (vac > lc && p.ads < p.sales * P.adPerSales && canSpend(G, p, P.adPrice) && A.ads(G, p, 1)) return 'ads'
  // 8. 法人営業チップ
  if (p.corpChips < s.corpChips && canSpend(G, p, P.corpChipPrice) && A.corpChip(G, p)) return 'corpChip'
  // 9. リノベ（入居の多い棟から）。1棟を育てる方針は性格によらずリノベする
  if (s.reno || (P.tutorial && p.opening === 'focus')) {
    const b = p.bldgs.filter((x) => !x.reno).sort((x, y) => y.rooms.filter((r) => r.st === 'occ').length - x.rooms.filter((r) => r.st === 'occ').length)[0]
    if (b && canSpend(G, p, P.renoPrice) && A.reno(G, p, b)) return 'reno'
  }
  // 10. 保険
  if (s.ins && p.ins < 1 && canSpend(G, p, P.insPrice) && A.insurance(G, p)) return 'insurance'
  return 'pass'
}

/** 他社の個人市場の入札に参加するか（募集中の部屋があれば、ほぼ参加する） */
export function joinAuction(G, q) {
  return vacantOpen(q) > 0 && G.rand() < 0.9
}

/**
 * 入札額：一番高い相場の棟から、性格の値引き ＋ 空室の多さ ＋ 参加者の多さ ＋ ゆらぎ を引く。
 * プライスカードの下限（priceFloor）より下は出せない
 */
export function bidPrice(G, q, nBidders) {
  const P = G.P
  const s = ps(q)
  const open = q.bldgs.filter((b) => !b.blocked && b.rooms.some((r) => r.st === 'vac'))
  const top = Math.max(...open.map((b) => mktOf(P, q, b)))
  const vac = vacantOpen(q)
  const total = occupied(q) + vac
  const pressure = total ? Math.round((vac / total) * 4) : 0
  const crowd = Math.max(0, nBidders - 2)
  const price = top - s.bidDisc - pressure - crowd - Math.floor(G.rand() * 3)
  return Math.max(P.priceFloor, Math.min(top, price))
}

/** 第3期の期首：減額交渉をする棟（性格の確率で、入居の少ない棟から1つ） */
export function periodStartChoices(G, p) {
  if (G.rand() >= ps(p).negotiate) return []
  const b = [...p.bldgs].sort((x, y) => x.rooms.filter((r) => r.st === 'occ').length - y.rooms.filter((r) => r.st === 'occ').length)[0]
  return b ? [b] : []
}

/**
 * 期末の退去で、サイコロで決まった n 室のうち誰を退去させるか（evictChoose: 'player'）。性格ごとの選び方：
 * - 標準・積極・単価重視：家賃の安い部屋から（来期の継続家賃をできるだけ残す）
 * - 堅実：法人を残す（学生 → 個人の順。同じ種類なら家賃の安い部屋から）。法人は退去が少なく、埋め直しの手間がかからない
 * どの性格も、学生は次の期の春（手番の2回目まで）にまた入れられるので、同じ家賃なら学生から出す
 */
export function chooseEvict(G, p, b, n) {
  const occ = b.rooms.filter((r) => r.st === 'occ')
  const typeRank = { stud: 0, indiv: 1, corp: 2 }
  const keepCorp = p.persona === 'steady'
  occ.sort((x, y) => (keepCorp ? typeRank[x.type] - typeRank[y.type] : 0) || x.rent - y.rent || typeRank[x.type] - typeRank[y.type])
  return occ.slice(0, Math.max(0, n))
}
