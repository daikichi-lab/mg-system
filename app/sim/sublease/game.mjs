// サブリース経営MG の1ゲームを最後まで自動で進めるシミュレーター（issue #104）。
//
// 製造業MGのコード（src/lib/calc.ts など）は使わない（サブリースは別ファイルで実装する方針）。
// ルールは設計案（https://claude.ai/artifact/23T6G3k6jSxUC6Ki2DUQRx）に、2026-10-07 の決定を足したもの：
// - 1卓4〜6人の順番制。手番ごとに山札（意思決定・リスク・チャンス）から1枚引く
// - 棟カードの市場（表向き3枚）と山札は卓で共有
// - 個人市場はアプリ内の封印入札（親が室数を宣言 → 参加者が家賃を伏せて出す → 安い順に入居）
// - 退去判定は割合で固定（種類ごとに 入居室数 × 率 を切り上げ）
//
// プレイヤーの判断は bots.mjs。ここは盤面・現金・損益の更新と、手番・期の進行だけを持つ。

import { makeDeck } from './cards.mjs'
import { TUTORIAL } from './tutorial.mjs'
import { decide, preTurn, joinAuction, bidPrice, periodStartChoices, openingSetup } from './bots.mjs'

// ---- 乱数（種を固定して同じ結果を再現する） ----
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const shuffle = (arr, rand) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ---- 棟カード ----
/** 市場の山札（都市・郊外・地方に、築古を混ぜる）。築古の立地はランダム */
function makeBuildingDeck(P, rand) {
  const cards = []
  const areas = Object.keys(P.areas)
  for (const a of areas) for (let i = 0; i < P.areas[a].n; i++) cards.push({ area: a, old: false })
  for (let i = 0; i < P.oldN; i++) cards.push({ area: areas[Math.floor(rand() * areas.length)], old: true })
  return shuffle(cards, rand)
}
/** 棟カード1枚から、会社盤に置く棟を作る。部屋は 'none'（家具なし）／'vac'（募集中）／'occ'（入居中） */
function newBuilding(P, card) {
  const a = P.areas[card.area]
  const d = card.old ? P.oldDelta : 0
  return {
    area: card.area,
    old: card.old,
    own: a.own + d,
    mkt: a.mkt + d,
    reno: false,
    blocked: false, // オーナー訴訟・施工不備：この期は新規入居できない
    rooms: Array.from({ length: P.roomsPerBldg }, () => ({ st: 'none', type: null, rent: 0 })),
  }
}

// ---- 盤面の集計 ----
export const allRooms = (p) => p.bldgs.flatMap((b) => b.rooms)
export const countRooms = (p, pred) => p.bldgs.reduce((s, b) => s + b.rooms.filter((r) => pred(r, b)).length, 0)
export const occupied = (p) => countRooms(p, (r) => r.st === 'occ')
export const vacant = (p) => countRooms(p, (r) => r.st === 'vac')
export const unprepared = (p) => countRooms(p, (r) => r.st === 'none')
/** 新規入居に使える募集中の部屋（入居停止の棟を除く） */
export const vacantOpen = (p, pred = () => true) => countRooms(p, (r, b) => r.st === 'vac' && !b.blocked && pred(b))
/** リーシング能力（1回の入居契約の室数）。個人市場は広告で ＋ */
export const leaseCap = (P, p) => p.sales * P.leasePerSales
export const indivCap = (P, p) => leaseCap(P, p) + Math.min(p.ads, p.sales * P.adPerSales) * P.adRooms
/** 管理能力（管理できる入居室数） */
export const mgmtCap = (P, p) => p.mgmt * P.mgmtRooms + p.locks * P.lockRooms
/** その会社から見た棟の相場家賃（リノベ ＋、競合物件のカードを引いた期の都市 −） */
export const mktOf = (P, p, b) => b.mkt + (b.reno ? P.renoMkt : 0) - (p.flags.competitor && b.area === 'city' ? 3 : 0)
export const furnSets = (p) => p.furn.reduce((s, l) => s + l.n, 0)
export const furnBook = (p) => p.furn.reduce((s, l) => s + l.n * l.book, 0)
export const equity = (p) => p.capital + p.retained
export const loanRoom = (P, p) => (p.period < P.loanFrom ? 0 : Math.max(0, Math.round(equity(p) * P.loanMult) - p.loan))

/**
 * 按分のときの「この期の残りの四半期数」（4〜1）。その会社が出納帳を何行使ったか（行数の1/4ずつ）で決める。
 * 全額計上のときは常に 4
 */
export function quartersLeft(G, p) {
  if (G.P.rentMode !== 'quarter') return 4
  return 4 - Math.min(3, Math.floor((4 * Math.max(0, p.rows - 1)) / G.rowLimit))
}

/**
 * この期の残りの割合（0〜1）。時間制は「経過時間 ÷ 1期の時間」から、行数制は四半期から出す。
 * 自動プレイヤーの見通し（あと何回契約できるか・期末までの家賃）に使う
 */
export function fracLeft(G, p) {
  if (G.P.pace === 'time') return Math.max(0, (G.periodMin - Math.min(G.clock, G.periodMin)) / G.periodMin)
  return quartersLeft(G, p) / 4
}

/**
 * 時間制：前回から今までの家賃と借上げ賃料を「経過時間 ÷ 1期の時間」で積み立てる（まだ現金にはしない）。
 * 入居・退去・借上げで部屋が変わる前に必ず呼ぶ（変わる前の状態で、変わるまでの分を数えるため）。
 * 1期の時間を超えた分（時間が来て周回を終えるまで）は数えない＝1期まるごと入居していれば、ちょうど1期分の家賃
 */
export function accrue(G, p) {
  const P = G.P
  if (P.pace !== 'time') return
  const t = Math.min(G.clock, G.periodMin)
  const dt = t - p.lastT
  if (dt <= 0) return
  const f = dt / G.periodMin
  const occ = occupied(p)
  p.pend.rent += occRooms(p).reduce((a, r) => a + r.rent, 0) * f
  p.pend.own += p.bldgs.reduce((a, b) => a + b.own * b.rooms.length, 0) * f
  p.pl.occRQ += occ * f * 4
  p.pl.availRQ += allRooms(p).length * f * 4
  p.lastT = t
}
/** 時間制：積み立てた家賃を受け取り、借上げ賃料を払う（自分の手番の頭と期末） */
function collect(G, p) {
  if (G.P.pace !== 'time') return
  accrue(G, p)
  const rent = p.pend.rent
  const own = p.pend.own
  p.pend = { rent: 0, own: 0 }
  income(p, rent)
  pay(G, p, own, 'ownerRent')
}

// ---- 会社 ----
function newPlayer(P, id, persona, startCard) {
  const p = {
    id,
    persona,
    period: 1,
    cash: P.capital,
    capital: P.capital,
    retained: 0,
    loan: 0,
    short: 0, // 期末に現金が足りず借りた短期借入（資金ショート）
    taxDue: 0,
    bldgs: P.startEmpty ? [] : [newBuilding(P, startCard)],
    wh: 0, // 倉庫の家具家電（部屋に置く前）
    furn: [], // 家具家電の簿価（購入ロットごと：{ n, book }。book は1セットの簿価）
    sales: 1,
    mgmt: 1,
    ads: 0,
    corpChips: 0,
    locks: 0,
    ins: 0,
    rows: 0,
    turnNo: 0, // この期の自分の手番の回数（学生市場は2回目まで）
    corpUsed: 0,
    studUsed: 0,
    flags: {},
    pl: null,
    hist: [],
    shortCount: 0,
    lastT: 0, // 時間制：最後に家賃を積み立てた時刻（期の頭からの分）
    pend: { rent: 0, own: 0 }, // 時間制：積み立てたが、まだ受け取っていない家賃・払っていない借上げ賃料
    opening: null, // 開業時の方針（'focus'＝1棟を充実／'spread'＝2棟にまんべんなく）
  }
  resetPeriod(P, p)
  // 営業中の物件で始める：家具は資本金で買ってある（現金が減り、家具の簿価になる）。入居者のプライスカードを置く
  if (P.startTenants) {
    const b = p.bldgs[0]
    p.cash -= b.rooms.length * P.furnPrice
    p.furn.push({ n: b.rooms.length, book: P.furnPrice })
    for (const r of b.rooms) r.st = 'vac'
    const rentOf = { corp: b.mkt - P.corpDisc, indiv: b.mkt - 1, stud: b.mkt - P.studDisc }
    let i = 0
    for (const t of ['corp', 'indiv', 'stud'])
      for (let k = 0; k < (P.startTenants[t] || 0) && i < b.rooms.length; k++, i++) Object.assign(b.rooms[i], { st: 'occ', type: t, rent: rentOf[t] })
  }
  return p
}
/** 期ごとの損益の入れ物。F は内訳ごとに持つ */
function newPL() {
  // availRQ／occRQ：借りている部屋・入居している部屋を「室 × 四半期」で数える（入居率を期間の長さで重みづけするため）
  return { rev: 0, contracts: { corp: 0, indiv: 0, stud: 0 }, vq: 0, F: {}, special: 0, availRQ: 0, occRQ: 0 }
}
function resetPeriod(P, p) {
  p.pl = newPL()
  p.turnNo = 0
  p.corpUsed = 0
  p.studUsed = 0
  p.flags = {}
  for (const b of p.bldgs) b.blocked = false
}

// ---- 現金の出入り ----
/**
 * 出金して費用（F の内訳 key）に計上する。現金が足りなければ、借入（第2期以降・枠の範囲）で埋め、
 * それでも足りなければ短期借入（資金ショート）で埋める。自動プレイヤーは足りるように行動するが、
 * イベントや期末処理では足りなくなることがある。
 */
function pay(G, p, amt, key, asCost = true) {
  if (amt <= 0) return
  p.cash -= amt
  if (asCost) p.pl.F[key] = (p.pl.F[key] || 0) + amt
  if (p.cash < 0) cover(G, p, key)
}
function cover(G, p, why = '') {
  const P = G.P
  const need = -p.cash
  const room = loanRoom(P, p)
  if (room > 0) {
    // 借入（金利は借入時に前払い）。10単位に切り上げ
    const a = Math.min(room, Math.ceil((need / (1 - P.loanRate)) / 10) * 10)
    borrow(G, p, a)
  }
  if (p.cash < 0) {
    const s = -p.cash
    p.short += s
    p.cash = 0
    const intr = Math.round(s * P.shortRate)
    p.cash -= intr
    p.pl.F.shortInterest = (p.pl.F.shortInterest || 0) + intr
    p.short += intr
    p.cash = 0
    p.shortCount++
    G.log.push({ t: 'short', p: p.id, period: p.period, amt: s, why })
  }
}
export function borrow(G, p, a) {
  if (a <= 0) return
  const P = G.P
  p.loan += a
  p.cash += a
  const intr = Math.round(a * P.loanRate)
  p.cash -= intr
  p.pl.F.interest = (p.pl.F.interest || 0) + intr
}
function income(p, amt) {
  p.cash += amt
  p.pl.rev += amt
}

// ---- アクション（ルールA） ----
export const A = {
  /** 物件を借り上げる：表向きの棟カードから1枚。費用は期末の借上げ賃料 */
  lease(G, p, idx, nFurn = 0) {
    const card = G.market.splice(idx, 1)[0]
    if (!card) return false
    const b = newBuilding(G.P, card)
    if (G.P.pace === 'time') {
      // 時間制：借りた時刻から借上げ賃料が積み立たる
      accrue(G, p)
    } else {
      // 按分のときは、借りた四半期から期末までの借上げ賃料を払う（期をまたいだら1期分）
      b.quarters = quartersLeft(G, p)
      p.pl.availRQ += b.rooms.length * b.quarters
    }
    p.bldgs.push(b)
    refillMarket(G)
    // 借りるのと同じ手番で、その棟の家具家電も買える（leaseFurnish。手番が少ない時間制向け）
    if (G.P.leaseFurnish && nFurn > 0) A.buyFurn(G, p, Math.min(nFurn, b.rooms.length))
    return true
  },
  /** 家具家電を買う（倉庫の上限まで） */
  buyFurn(G, p, n) {
    const P = G.P
    n = Math.min(n, P.directFurnish ? P.whCap : P.whCap - p.wh)
    if (n <= 0) return false
    pay(G, p, n * P.furnPrice, 'furniture', false)
    p.wh += n
    p.furn.push({ n, book: P.furnPrice })
    // 買ったその場で未準備の部屋に置く（手番が少ない時間制では、購入と募集準備を1回にまとめる）
    if (P.directFurnish)
      while (p.wh > 0) {
        // 家具の置いてある部屋が少ない棟から1室ずつ置く（2棟ならまんべんなく）
        const b = p.bldgs
          .filter((x) => x.rooms.some((r) => r.st === 'none'))
          .sort((x, y) => x.rooms.filter((r) => r.st !== 'none').length - y.rooms.filter((r) => r.st !== 'none').length)[0]
        if (!b) break
        b.rooms.find((r) => r.st === 'none').st = 'vac'
        p.wh--
      }
    return true
  },
  /** 募集準備：倉庫の家具を未準備の部屋に置く（管理スタッフ1人1回4室） */
  prepare(G, p) {
    const P = G.P
    let n = Math.min(p.wh, p.mgmt * P.prepPerMgmt)
    if (n <= 0) return false
    for (const b of p.bldgs)
      for (const r of b.rooms)
        if (n > 0 && r.st === 'none') {
          r.st = 'vac'
          p.wh--
          n--
        }
    return true
  },
  /** 採用（営業 or 管理）。1回3人まで・それぞれ6人まで */
  hire(G, p, kind, n) {
    const P = G.P
    n = Math.min(n, P.hireMax, P.staffMax - p[kind])
    if (n <= 0) return false
    pay(G, p, n * P.hireCost, 'hire')
    p[kind] += n
    return true
  },
  ads(G, p, n) {
    const P = G.P
    n = Math.min(n, p.sales * P.adPerSales - p.ads)
    if (n <= 0) return false
    pay(G, p, n * P.adPrice, 'ads')
    p.ads += n
    return true
  },
  corpChip(G, p) {
    const P = G.P
    if (p.corpChips >= P.corpChipMax) return false
    pay(G, p, P.corpChipPrice, 'corpChip')
    p.corpChips++
    return true
  },
  reno(G, p, b) {
    if (!b || b.reno) return false
    pay(G, p, G.P.renoPrice, 'reno')
    b.reno = true
    return true
  },
  lock(G, p) {
    if (p.locks >= G.P.lockMax) return false
    pay(G, p, G.P.lockPrice, 'lock')
    p.locks++
    return true
  },
  insurance(G, p) {
    pay(G, p, G.P.insPrice, 'insurance')
    p.ins++
    return true
  },
  /** 法人の入居契約：相場−2・法人枠とリーシング能力の範囲 */
  corp(G, p, opt = {}) {
    const P = G.P
    const quota = opt.free ?? P.corpBase + p.corpChips * P.corpPerChip + (p.flags.corpBonus || 0) - p.corpUsed
    const n = Math.min(leaseCap(P, p), Math.max(0, quota))
    if (n <= 0 || vacantOpen(p, opt.where) <= 0) return false
    const cut = corpCut(G, p, opt.die)
    const got = fill(G, p, 'corp', n, (b) => mktOf(P, p, b) - P.corpDisc - cut, opt.where)
    if (!opt.free) p.corpUsed += got
    return got > 0
  },
  /** 学生の入居契約：各期の自分の手番の2回目まで・1期4室・相場−5 */
  stud(G, p) {
    const P = G.P
    if (p.turnNo >= P.studTurns || p.flags.pandemic) return false
    const n = Math.min(leaseCap(P, p), P.studMax - p.studUsed)
    const got = fill(G, p, 'stud', n, (b) => mktOf(P, p, b) - P.studDisc)
    p.studUsed += got
    return got > 0
  },
  /** 個人の入居契約：封印入札（親＝この会社） */
  indiv(G, p) {
    return auction(G, p)
  },
}

/**
 * 法人の単価交渉：サイコロの目で家賃をいくら下げるか（corpDice）。die を渡すとその目を使う（第1期の台本は講師が振った目を全員で使う）。
 * 下げ幅は営業スタッフ・法人営業チップで抑えられる（mitigate）。0 未満にはならない
 */
export function corpCut(G, p, die) {
  const P = G.P
  if (!P.corpDice) return 0
  const d = die ?? 1 + Math.floor(G.rand() * 6)
  let cut = d >= P.corpDice.from ? d - P.corpDice.from + 1 : 0
  if (P.corpDice.mitigate === 'sales') cut -= Math.floor(p.sales / 2)
  if (P.corpDice.mitigate === 'chips') cut -= p.corpChips
  G.corpCuts.push(Math.max(0, cut))
  return Math.max(0, cut)
}

/**
 * 募集中の部屋に入居者を入れる。家賃が高い棟から埋める。家賃を受け取り、入居1室ごとに V を払う。
 * where で棟を絞れる（新規の社宅需要＝地方の棟だけ）。戻り値は入居した室数
 */
function fill(G, p, type, n, rentOf, where = () => true) {
  const P = G.P
  const rooms = []
  for (const b of p.bldgs) if (!b.blocked && where(b)) for (const r of b.rooms) if (r.st === 'vac') rooms.push({ r, b })
  rooms.sort((x, y) => rentOf(y.b) - rentOf(x.b))
  let got = 0
  // 時間制：入居した時刻から家賃が積み立たる（その場では受け取らない）。行数制の按分：残りの四半期分を受け取る
  accrue(G, p)
  const quarters = quartersLeft(G, p)
  for (const { r, b } of rooms.slice(0, Math.max(0, n))) {
    r.st = 'occ'
    r.type = type
    r.rent = rentOf(b)
    if (P.pace !== 'time') {
      income(p, Math.round((r.rent * quarters) / 4))
      p.pl.occRQ += quarters
    }
    pay(G, p, P.V, 'V', false)
    p.pl.vq += P.V
    p.pl.contracts[type]++
    got++
  }
  return got
}

/**
 * 個人市場の封印入札。
 * 親が「貸します」と室数を宣言（リーシング能力＋広告、自分の募集中の部屋まで）→ 他の会社は参加するかを決める
 * → 参加者全員がプライスカードを1枚伏せて出す（自分の棟の相場家賃以下）→ 安い順に、親が宣言した室数まで入居。
 * リノベの棟は2安いものとして比べる。同じ額なら リノベ → 親 → くじ。参加した子は1行使う。
 */
function auction(G, parent) {
  const P = G.P
  if (parent.flags.noIndiv) return false
  // 卓で共有の入居希望者が残っていなければ、個人市場は開けない
  const seats = Math.min(indivCap(P, parent), vacantOpen(parent), G.indivLeft)
  if (seats <= 0) return false
  const bidders = [parent]
  for (const q of G.players)
    if (q !== parent && q.rows < G.rowLimit && !q.flags.noIndiv && vacantOpen(q) > 0 && joinAuction(G, q, parent, seats)) {
      q.rows++ // 子も1行記入する（時間制では行数は見ない）
      bidders.push(q)
    }
  // 時間制：入札があった手番は長くなる
  G.turnExtra += G.P.auctionMin || 0
  const bids = bidders.map((q) => {
    const price = bidPrice(G, q, bidders.length)
    // その額以下の相場の棟には出せない（上限はその棟の相場家賃）
    const ok = (b) => !b.blocked && mktOf(P, q, b) >= price
    const offer = Math.min(indivCap(P, q), countRooms(q, (r, b) => r.st === 'vac' && ok(b)))
    const reno = q.bldgs.some((b) => b.reno && ok(b) && b.rooms.some((r) => r.st === 'vac'))
    return { q, price, offer, ok, eff: price - (reno ? P.renoBid : 0), reno, tie: G.rand() }
  })
  bids.sort((x, y) => x.eff - y.eff || Number(y.reno) - Number(x.reno) || Number(y.q === parent) - Number(x.q === parent) || x.tie - y.tie)
  let left = seats
  const result = []
  const before = left
  for (const bd of bids) {
    if (left <= 0 || bd.offer <= 0) continue
    const n = Math.min(left, bd.offer)
    // リノベの棟から先に埋める
    const got = fill(G, bd.q, 'indiv', n, () => bd.price, (b) => bd.ok(b))
    left -= got
    result.push({ id: bd.q.id, price: bd.price, got })
  }
  G.indivLeft -= before - left
  G.auctions.push({ period: G.period, n: bidders.length, seats, filled: seats - left, prices: bids.map((b) => b.price) })
  return seats - left > 0 || result.length > 0
}

// ---- リスク・チャンス ----
const pick = (G, arr) => arr[Math.floor(G.rand() * arr.length)]
/**
 * 入居者を外して募集中に戻す。midPeriod（期の途中のイベント）のときは、按分なら残りの四半期分の家賃を返す
 * （家賃は期首・入居時に期末までの分を受け取っているので、途中で出ていった分は売上から引く。返さないと、
 * 空いた部屋に次の人を入れたときに同じ期間の家賃が二重に入る）
 */
function evictRooms(G, p, rooms, restore = true, midPeriod = true) {
  // 時間制：退去の時刻までの家賃を積み立ててから外す（返金は要らない）
  if (G.P.pace === 'time') {
    accrue(G, p)
    midPeriod = false
  }
  // いまの四半期の頭で出ていったものとして、いまの四半期から期末までを返す（同じ四半期に次の人を入れても二重にならない）
  const back = midPeriod && G.P.rentMode === 'quarter' ? rooms.reduce((s, r) => s + Math.round((r.rent * quartersLeft(G, p)) / 4), 0) : 0
  if (midPeriod) p.pl.occRQ -= rooms.length * quartersLeft(G, p)
  for (const r of rooms) {
    r.st = 'vac'
    r.type = null
    r.rent = 0
  }
  if (back > 0) {
    p.cash -= back
    p.pl.rev -= back
    if (p.cash < 0) cover(G, p, 'refund')
  }
  if (restore) pay(G, p, rooms.length * G.P.restore, 'restore')
}
function occRooms(p, type) {
  const out = []
  for (const b of p.bldgs) for (const r of b.rooms) if (r.st === 'occ' && (!type || r.type === type)) out.push(r)
  return out
}
const EVENTS = {
  /** 施工不備：入居者の多い1棟は全員退去・改修費・この期は新規入居できない。次の自分の手番1回は個人市場に出られない */
  defect(G, p) {
    const b = [...p.bldgs].sort((x, y) => y.rooms.filter((r) => r.st === 'occ').length - x.rooms.filter((r) => r.st === 'occ').length)[0]
    const occ = b.rooms.filter((r) => r.st === 'occ')
    if (G.P.riskMode === 'light') {
      // 軽い版：その棟の入居者の半分（切り上げ）が退去し、改修費。入居停止はしない
      evictRooms(G, p, occ.slice(0, Math.ceil(occ.length / 2)), false)
      pay(G, p, G.P.defectCost, 'defect')
    } else {
      evictRooms(G, p, occ, false)
      pay(G, p, G.P.defectCost, 'defect')
      b.blocked = true
    }
    p.flags.noIndivTurns = 1
    p.flags.noIndiv = true
  },
  /** 大口法人の解約：法人の入居者を2室まで外す */
  corpCancel(G, p) {
    if (G.P.corpCancel === 'topBuilding') {
      // 法人の入居者がいちばん多い棟の法人を全員解約する。同数なら先に借りた棟（p.bldgs の並び＝借りた順で最初の棟）
      let top = null
      let most = 0
      for (const b of p.bldgs) {
        const n = b.rooms.filter((r) => r.st === 'occ' && r.type === 'corp').length
        if (n > most) {
          most = n
          top = b
        }
      }
      if (top) evictRooms(G, p, top.rooms.filter((r) => r.st === 'occ' && r.type === 'corp'))
      return
    }
    const corp = occRooms(p, 'corp')
    // 'third'：法人に偏った会社ほど痛い（法人の入居者の3分の1・切り上げ）
    const n = G.P.corpCancel === 'third' ? Math.ceil(corp.length / 3) : 2
    evictRooms(G, p, corp.slice(0, n))
  },
  /** 感染症：この期は学生市場が閉じ、法人枠 −2 */
  pandemic(G, p) {
    p.flags.pandemic = true
    p.flags.corpBonus = (p.flags.corpBonus || 0) - 2
  },
  /** オーナー訴訟：費用、1棟はこの期の新規入居停止 */
  lawsuit(G, p) {
    pay(G, p, G.P.lawsuitCost, 'lawsuit')
    // 軽い版は費用だけ（入居停止にしない）
    if (G.P.riskMode !== 'light') pick(G, p.bldgs).blocked = true
  },
  /** 漏水・設備故障：修繕費（築古は倍）。保険があれば補償（保険チップを1枚返す） */
  leak(G, p) {
    const b = pick(G, p.bldgs)
    if (p.ins > 0) {
      p.ins--
      return
    }
    pay(G, p, G.P.repairCost * (b.old ? 2 : 1), 'repair')
  },
  /** 家賃の滞納：個人の入居者1室の家賃が回収できない */
  arrears(G, p) {
    const r = occRooms(p, 'indiv')[0]
    if (r) pay(G, p, r.rent, 'arrears')
  },
  /** 騒音：管理能力が足りなければ個人1室が退去 */
  noise(G, p) {
    if (occupied(p) > mgmtCap(G.P, p)) evictRooms(G, p, occRooms(p, 'indiv').slice(0, 1))
  },
  /** 競合物件：この期は都市の棟の相場 −3 */
  competitor(G, p) {
    p.flags.competitor = true
  },
  /** 繁忙期：個人市場でもう1回入居契約ができる */
  rush(G, p) {
    A.indiv(G, p)
  },
  /** 外国人材：この期の法人枠 ＋3 */
  foreign(G, p) {
    p.flags.corpBonus = (p.flags.corpBonus || 0) + 3
  },
  /** 新規の社宅需要：地方の棟に法人を2室まで（法人枠を使わない） */
  factory(G, p) {
    A.corp(G, p, { free: 2, where: (b) => b.area === 'rural' })
  },
  /** プライシングの成功：リノベ済みの棟の入居中の家賃 ＋2 */
  pricing(G, p) {
    for (const b of p.bldgs) if (b.reno) for (const r of b.rooms) if (r.st === 'occ') r.rent += 2
  },
}

/** 個人の入居希望者（1人あたり）：数値か、人数ごとの表（書いていない人数は一番近い小さい人数の値） */
function poolPerPlayer(pool, n) {
  if (typeof pool === 'number') return pool
  const keys = Object.keys(pool).map(Number).sort((a, b) => a - b)
  return pool[keys.filter((k) => k <= n).at(-1) ?? keys[0]]
}

// ---- 期の進行 ----
function refillMarket(G) {
  while (G.market.length < G.P.faceUp && G.bdeck.length) G.market.push(G.bdeck.pop())
}
function drawCard(G) {
  if (!G.deck.length) G.deck = shuffle(makeDeck(G.P), G.rand)
  return G.deck.pop()
}

/** 期首処理：継続家賃・法人税の納付・期首の借入金利。第3期は借上げ賃料の減額交渉 */
function periodStart(G, p) {
  const P = G.P
  resetPeriod(P, p)
  p.period = G.period
  p.occStart = occupied(p)
  p.lastT = 0
  p.pend = { rent: 0, own: 0 }
  if (P.pace !== 'time') {
    // 継続家賃：入居中の部屋のプライスカードの合計（第1期は営業中の物件で始めたときの入居者）。時間制は手番ごとに積み立てて受け取る
    for (const r of allRooms(p)) if (r.st === 'occ') income(p, r.rent)
    p.pl.availRQ += allRooms(p).length * 4
    p.pl.occRQ += p.occStart * 4
  }
  if (G.period === 1) return
  if (p.taxDue > 0) {
    p.cash -= p.taxDue
    p.taxDue = 0
    if (p.cash < 0) cover(G, p)
  }
  if (p.loan > 0) pay(G, p, Math.round(p.loan * P.loanRate), 'interest')
  if (p.short > 0) pay(G, p, Math.round(p.short * P.shortRate), 'shortInterest')
  // 第3期の期首だけ：借上げ賃料の減額交渉（棟ごとに1回。サイコロ3〜6で成功、1〜2で訴訟）
  if (G.period === 3)
    for (const b of periodStartChoices(G, p)) {
      p.rows++
      const die = 1 + Math.floor(G.rand() * 6)
      if (die >= 3) b.own -= P.negotiateCut
      else {
        pay(G, p, P.lawsuitCost, 'lawsuit')
        // 設計案は「次の期まで新規入居できない」。軽い版は費用だけ
        if (P.riskMode !== 'light') b.blocked = true
      }
    }
}

/**
 * 第1期（ルール説明の期）を台本どおりに進める。全員が同じ手番を同じ順に行うので、期末には全員の盤面が同じになる。
 * 家賃・借上げ賃料は台本の at（第1期のどこまで進んだか）で積み立て、各手番の頭に受け取る・払う
 */
function runTutorial(G) {
  const P = G.P
  for (const step of TUTORIAL) {
    if (step.kind === 'closing') break
    G.clock = step.at * G.periodMin
    for (const p of G.players) {
      collect(G, p)
      const d = step.do
      if (d.lease) {
        accrue(G, p)
        p.bldgs.push(newBuilding(P, { area: d.lease.area, old: false }))
      }
      if (d.furniture) A.buyFurn(G, p, d.furniture)
      if (d.contract) {
        const c = d.contract
        // 法人は台本のサイコロの目（講師が振った目を全員で使う）で単価交渉
        const cut = c.type === 'corp' ? corpCut(G, p, c.die) : 0
        const rentOf = (b) => (c.type === 'corp' ? mktOf(P, p, b) - P.corpDisc - cut : c.type === 'stud' ? mktOf(P, p, b) - P.studDisc : c.price)
        const got = fill(G, p, c.type, c.n, rentOf)
        if (c.type === 'corp') p.corpUsed += got
        if (c.type === 'stud') p.studUsed += got
      }
      if (d.event) EVENTS[d.event](G, p)
      if (d.insurance) A.insurance(G, p)
      if (d.hire) A.hire(G, p, d.hire.kind, d.hire.n)
      if (step.kind === 'decision' || step.kind === 'risk' || step.kind === 'chance') p.turnNo++
    }
    // 台本の手番ごとの記録（説明資料用）：1社目の現金・この手番までの売上と費用
    const p0 = G.players[0]
    G.tutorialLog.push({ title: step.title, at: step.at, cash: p0.cash, rev: p0.pl.rev, own: p0.pl.F.ownerRent || 0, occ: occupied(p0), vac: vacant(p0) })
  }
  G.clock = G.periodMin
}

/** 1手番：（ルールB）→ カードを1枚引く → 意思決定ならルールAを1つ、リスク・チャンスなら効果 */
function turn(G, p) {
  if (p.rows >= G.rowLimit) return
  // 時間制：自分の手番が来たら、前の手番からの家賃を受け取り、借上げ賃料を払う
  collect(G, p)
  preTurn(G, p) // 借入などのルールB（1行使う）
  if (p.rows >= G.rowLimit) return
  const card = drawCard(G)
  p.rows++
  G.cardLog.push(card.kind)
  if (card.kind === 'decision') decide(G, p)
  // まだ物件を持っていない会社には、物件にかかるリスク・チャンスは何も起きない
  else if (p.bldgs.length) EVENTS[card.key](G, p)
  p.turnNo++
  // 施工不備の「次の1周は個人市場に出られない」：自分の手番を1回過ぎたら解除
  if (p.flags.noIndiv && p.flags.noIndivTurns-- <= 0) p.flags.noIndiv = false
}

/** 期末処理と決算 */
function periodEnd(G, p) {
  const P = G.P
  const occAtEnd = occupied(p)
  const rooms = allRooms(p).length
  const occRents = occRooms(p).map((r) => r.rent)
  const corpN = occRooms(p, 'corp').length
  // 1. 借上げ賃料：借り上げているすべての部屋（空室・未準備も）。時間制は期末までの積み立てを精算する
  if (P.pace === 'time') collect(G, p)
  else pay(G, p, p.bldgs.reduce((s, b) => s + Math.round((b.own * b.rooms.length * (b.quarters ?? 4)) / 4), 0), 'ownerRent')
  for (const b of p.bldgs) b.quarters = 4
  // 2. 給料・本社家賃
  pay(G, p, (p.sales + p.mgmt) * P.salary[G.period - 1], 'salary')
  pay(G, p, P.hq, 'hq')
  // 3. 期末返済（借入残高 × 返済率）。短期借入は返せるだけ返す
  const rep = Math.round(p.loan * P.repayRate)
  if (rep > 0) {
    p.cash -= rep
    p.loan -= rep
    if (p.cash < 0) cover(G, p)
  }
  // 4. 管理能力を超えた分は、個人（いなければ法人・学生）から退去し、1室ごとにクレーム費用
  const over = occupied(p) - mgmtCap(P, p)
  if (over > 0) {
    const order = [...occRooms(p, 'indiv'), ...occRooms(p, 'stud'), ...occRooms(p, 'corp')].slice(0, over)
    evictRooms(G, p, order, false, false)
    pay(G, p, over * P.claimCost, 'claim')
  }
  // 5. 退去判定（割合で固定・切り上げ）。外した部屋は募集中に戻り、原状回復費
  let evicted = 0
  for (const t of ['corp', 'indiv', 'stud']) {
    const occ = occRooms(p, t)
    const n = Math.min(occ.length, Math.ceil(occ.length * P.evict[t] - 1e-9))
    // 家賃の高い部屋から先に退去（家賃の見直しで上げた部屋を先に外すルールの近似）
    evictRooms(G, p, occ.sort((x, y) => y.rent - x.rent).slice(0, n), true, false)
    evicted += n
  }
  // 6. 広告チップを1枚返す。減価償却（家具家電）
  p.ads = Math.max(0, p.ads - 1)
  let dep = 0
  for (const l of p.furn) {
    const d = Math.min(P.furnDep, l.book)
    dep += d * l.n
    l.book -= d
  }
  p.pl.F.dep = dep
  // 短期借入は現金があるだけ返す
  if (p.short > 0 && p.cash > 0) {
    const r = Math.min(p.short, p.cash)
    p.short -= r
    p.cash -= r
  }
  // 決算：G ＝ PQ − VQ − F。法人税は製造業MGと同じ式（繰越損失を埋めた残りに30%・最低5）
  const F = Object.values(p.pl.F).reduce((s, v) => s + v, 0)
  const Gv = p.pl.rev - p.pl.vq - F
  const total = Gv + p.retained
  let tax = Gv < 0 || total < 0 ? P.minTax : p.retained < 0 ? Math.round(total * P.taxRate) : Math.round(Gv * P.taxRate)
  tax = Math.max(tax, P.minTax)
  p.retained += Gv - tax
  p.taxDue = tax
  // 貸借の一致を確かめる（現金＋家具家電の簿価 ＝ 借入＋短期借入＋未払税＋純資産）
  const assets = p.cash + furnBook(p)
  const liab = p.loan + p.short + p.taxDue + equity(p)
  if (Math.abs(assets - liab) > 1e-6) throw new Error(`B/S不一致 p${p.id} 第${G.period}期 資産${assets} 負債純資産${liab}`)
  const avgRent = occRents.length ? occRents.reduce((a, b) => a + b, 0) / occRents.length : 0
  // 期間で重みづけした入居率と、損益分岐入居率（1室・1期あたりの粗利 m を一定として G＝0 になる入居率）
  const occEq = p.pl.occRQ / 4
  const availEq = p.pl.availRQ / 4
  const m = occEq > 0 ? (p.pl.rev - p.pl.vq) / occEq : 0
  p.hist.push({
    period: G.period,
    G: Gv,
    PQ: p.pl.rev,
    VQ: p.pl.vq,
    F,
    Fb: { ...p.pl.F },
    tax,
    rooms,
    bldgs: p.bldgs.length,
    occ: occAtEnd,
    occRate: availEq ? occEq / availEq : 0,
    occEndRate: rooms ? occAtEnd / rooms : 0,
    bepRate: availEq && m > 0 ? F / m / availEq : null,
    corpShare: occAtEnd ? corpN / occAtEnd : 0,
    avgRent,
    contracts: { ...p.pl.contracts },
    evicted,
    cash: p.cash,
    equity: equity(p),
    loan: p.loan,
    short: p.short,
    shortNew: G.log.some((l) => l.t === 'short' && l.p === p.id && l.period === G.period),
    // 30 以上の資金ショート（期末の小さな不足ではなく、資金繰りが破綻している）
    shortBig: G.log.some((l) => l.t === 'short' && l.p === p.id && l.period === G.period && l.amt >= 30),
    staff: { sales: p.sales, mgmt: p.mgmt },
    rowsUsed: p.rows,
    turns: p.turnNo,
  })
}

/**
 * 1ゲーム（5期）を最後まで進める。personas は席順の性格（bots.mjs の PERSONAS のキー）。
 * 戻り値：各社の期別の結果・入札の記録・カードの記録
 */
export function playGame(P, personas, seed) {
  const rand = rng(seed)
  const bdeck = makeBuildingDeck(P, rand)
  const startCard = { area: P.startArea, old: false }
  const G = {
    P,
    rand,
    bdeck,
    market: [],
    deck: shuffle(makeDeck(P), rand),
    players: personas.map((ps, i) => newPlayer(P, i, ps, startCard)),
    period: 1,
    rowLimit: P.rows[0],
    clock: 0, // 時間制：期の頭からの経過時間（分）
    // 時間制：1期の時間（分）。数値か、人数ごとの表（人数が多いほど1人あたりの手番が減るので長くする）
    periodMin: typeof P.periodMin === 'number' ? P.periodMin : P.periodMin[personas.length],
    turnExtra: 0,
    log: [],
    auctions: [],
    cardLog: [],
    tutorialLog: [],
    corpCuts: [], // 法人の単価交渉で下がった額（集計用）
  }
  refillMarket(G)
  // 開業の方針は半々（1棟を充実させる／2棟にまんべんなく）。資本金がどちらでも成り立つかを見るため
  for (const p of G.players) p.opening = G.rand() < 0.5 ? 'focus' : 'spread'
  for (let per = 1; per <= P.periods; per++) {
    G.period = per
    G.rowLimit = P.rows[per - 1]
    G.indivLeft = P.indivPool == null ? Infinity : poolPerPlayer(P.indivPool, G.players.length) * G.players.length
    for (const p of G.players) {
      p.rows = 0
      periodStart(G, p)
    }
    // 開業準備（第1期の時計を動かす前）：資本金で棟を借り、家具を入れる。席順に1人ずつ表向きの棟カードから選ぶ
    if (per === 1 && P.setupOpening) for (const p of G.players) openingSetup(G, p)
    // 親は期ごとに隣へ回る。行数制：誰かが最終行まで行ったら、その周回を終えて期末へ。
    // 時間制：1手番に turnMin 分（一様）かかり、1期の時間が来たら、その周回を終えて期末へ
    const first = (per - 1) % G.players.length
    let guard = 0
    G.clock = 0
    if (P.pace === 'time') G.rowLimit = Infinity
    if (per === 1 && P.tutorial) {
      runTutorial(G)
      for (const p of G.players) periodEnd(G, p)
      continue
    }
    for (;;) {
      for (let k = 0; k < G.players.length; k++) {
        G.turnExtra = 0
        turn(G, G.players[(first + k) % G.players.length])
        if (P.pace === 'time') G.clock += P.turnMin[0] + G.rand() * (P.turnMin[1] - P.turnMin[0]) + G.turnExtra
      }
      if (P.pace === 'time' ? G.clock >= G.periodMin : G.players.some((p) => p.rows >= G.rowLimit)) break
      if (++guard > 200) break
    }
    for (const p of G.players) periodEnd(G, p)
  }
  return G
}
