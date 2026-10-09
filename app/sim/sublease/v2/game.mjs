// サブリース経営MG シミュレーション v2：エリアごとの人駒の市場と、入居者の入札（2026-10-07 の設計見直し）。
//
// 進め方は v1 の本命（時間制・家賃と借上げ賃料は時間で積み立てて自分の手番で精算・第1期は台本）と同じ。
// 入居者まわりだけ作り直している（params.mjs の冒頭を参照）。製造業MGのコードは使わない。

import { rng } from '../game.mjs'

const TYPES = ['corp', 'indiv', 'stud']
const AREAS = ['city', 'suburb', 'rural']
const shuffle = (a, rand) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---- 性格（自動プレイヤー）。v1 と同じ4つ ----
export const PERSONAS = {
  standard: { expandOcc: 0.75, maxBldg: 4, bidDisc: 3, salesChips: 1, reno: false, lock: false, ins: false, borrow: true, buffer: 20, prefer: ['corp', 'stud', 'indiv'] },
  aggressive: { expandOcc: 0.5, maxBldg: 6, bidDisc: 5, salesChips: 1, reno: false, lock: false, ins: false, borrow: true, buffer: 0, prefer: ['corp', 'indiv', 'stud'] },
  steady: { expandOcc: 0.9, maxBldg: 3, bidDisc: 2, salesChips: 3, reno: false, lock: true, ins: true, borrow: false, buffer: 50, prefer: ['corp', 'stud', 'indiv'] },
  premium: { expandOcc: 0.8, maxBldg: 4, bidDisc: 1, salesChips: 0, reno: true, lock: false, ins: false, borrow: true, buffer: 20, prefer: ['indiv', 'corp', 'stud'] },
}
// 入居者の種類に特化した性格（2026-10-07）：棟の増やし方・採用などは標準と同じで、入札で取りにいく種類だけが違う
PERSONAS.corpFocus = { ...PERSONAS.standard, salesChips: 3, prefer: ['corp'] }
PERSONAS.indivFocus = { ...PERSONAS.standard, prefer: ['indiv'] }
PERSONAS.studFocus = { ...PERSONAS.standard, prefer: ['stud', 'indiv'] }
PERSONAS.studOnly = { ...PERSONAS.standard, prefer: ['stud'] }
export const PERSONA_KEYS = ['standard', 'aggressive', 'steady', 'premium']

// ---- 山札 ----
function makeDeck(P) {
  const d = []
  for (let i = 0; i < P.deckDecision; i++) d.push({ kind: 'decision', key: 'decision' })
  // リスクカードの枚数は P.riskCards（2026-10-09：感染症・競合物件・入居者トラブルは削除、法人の解約4枚・ほかは2枚ずつ）
  const risk = P.riskCards ? Object.entries(P.riskCards) : [['defect', 1], ['corpCancel', P.corpCancelCards], ['pandemic', 1], ['lawsuit', 1], ['leak', 2], ['arrears', 1], ['noise', 1], ['competitor', 1]]
  const chance = [['rush', 2], ['foreign', 2], ['factory', 1], ['pricing', 1], ...(P.moveCards ? [['regional', 1], ['remote', 2], ['university', P.universityCards ?? 1], ['redevelop', 1]] : [])]
  for (const [k, n] of risk) for (let i = 0; i < n; i++) d.push({ kind: 'risk', key: k })
  for (const [k, n] of chance) for (let i = 0; i < n; i++) d.push({ kind: 'chance', key: k })
  return d
}
function makeBdeck(P, rand) {
  const d = []
  for (const a of AREAS) for (let i = 0; i < P.areas[a].n; i++) d.push({ area: a, old: false })
  for (let i = 0; i < P.oldN; i++) d.push({ area: AREAS[Math.floor(rand() * 3)], old: true })
  return shuffle(d, rand)
}
/** 立地ごとの部屋数（roomsByArea があればそれ、なければ8室） */
const roomsOf = (P, area) => (P.roomsByArea && P.roomsByArea[area]) || P.rooms
function newBldg(P, c) {
  const a = P.areas[c.area]
  const d = c.old ? P.oldDelta : 0
  return { area: c.area, old: c.old, own: a.own + d, mkt: a.mkt + d, reno: false, rooms: Array.from({ length: roomsOf(P, c.area) }, () => ({ st: 'none', type: null, rent: 0 })) }
}

// ---- 集計 ----
const occ = (p, t, area) => p.bldgs.flatMap((b) => (area && b.area !== area ? [] : b.rooms.filter((r) => r.st === 'occ' && (!t || r.type === t))))
const vac = (p, area) => p.bldgs.reduce((s, b) => s + (area && b.area !== area ? 0 : b.rooms.filter((r) => r.st === 'vac').length), 0)
const unfurn = (p) => p.bldgs.reduce((s, b) => s + b.rooms.filter((r) => r.st === 'none').length, 0)
/** そのエリアで使える営業スタッフ（salesByArea のときは配属した人数、そうでなければ会社全体） */
const salesIn = (P, p, area) => (P.salesByArea && area ? p.salesBy[area] || 0 : p.sales)
const leaseCap = (P, p, area) => salesIn(P, p, area) * P.leasePerSales
// 広告は、そのエリアに営業スタッフがいる入札にだけ効く
const indivCap = (P, p, area) => (leaseCap(P, p, area) ? leaseCap(P, p, area) + Math.min(p.ads, p.sales * P.adPerSales) * P.adRooms : 0)
/** 管理能力：mgmtByArea のときはエリアごと（そのエリアの管理スタッフ×12＋そのエリアのスマートロック×6）、そうでなければ会社全体 */
const mgmtCap = (P, p, area) =>
  P.mgmtByArea && area ? (p.mgmtBy[area] || 0) * P.mgmtRooms + (p.lockBy[area] || 0) * P.lockRooms : p.mgmt * P.mgmtRooms + p.locks * P.lockRooms
/** 管理能力の残り（エリアごと or 会社全体） */
const mgmtRoom = (P, p, area) => (P.mgmtByArea ? mgmtCap(P, p, area) - occ(p, null, area).length : mgmtCap(P, p) - occ(p).length)
/** 営業所の家賃：スタッフのいるエリアの数 × officeRent（officeByArea でなければ本社家賃 hq） */
const officeCost = (P, p) => (P.officeByArea ? ['city', 'suburb', 'rural'].filter((a) => (p.salesBy[a] || 0) + (p.mgmtBy[a] || 0) > 0).length * P.officeRent : P.hq)
/** 入札の下限：floorAtOwn のときはそのエリアの借上げ賃料（それより安く貸さない。2026-10-08）、そうでなければ種類ごとの priceFloor */
const floorOf = (P, type, area) => (P.floorAtOwn ? P.areas[area].own : P.priceFloor[type])
const mktOf = (P, p, b) => b.mkt - (p.flags.competitor && b.area === 'city' ? 3 : 0)
const equity = (p) => p.capital + p.retained
const loanRoom = (P, p) => (p.period < P.loanFrom ? 0 : Math.max(0, Math.round(equity(p) * P.loanMult) - p.loan))
const furnBook = (p) => p.furn.reduce((s, l) => s + l.n * l.book, 0)
// smart のときは会社ごとの戦い方（p.strat）、そうでなければ性格（PERSONAS）
const ps = (p) => p.strat || PERSONAS[p.persona]

// ---- 記帳の記録（P.trace のときだけ。1手番ずつの記帳を見るため：2026-10-08） ----
/** お金の出入りを記録する。v は入金＋・出金− */
function tr(G, p, k, v, note) {
  if (!G.trace) return
  G.trace.push({ period: G.period, ctx: G.ctx, p: p.id, k, v, note, cash: p.cash })
}
/** お金の動かない出来事（入居・退去・カード・借りた棟など）を記録する */
const note = (G, p, text) => tr(G, p, 'note', 0, text)

// ---- お金 ----
function addF(p, k, v) {
  p.pl.F[k] = (p.pl.F[k] || 0) + v
}
function pay(G, p, v, k, cost = true) {
  if (v <= 0) return
  p.cash -= v
  if (cost) addF(p, k, v)
  tr(G, p, k, -v)
  if (p.cash < 0) cover(G, p, k)
}
function cover(G, p, why) {
  const P = G.P
  const room = loanRoom(P, p)
  if (room > 0) borrow(G, p, Math.min(room, Math.ceil(-p.cash / 0.95 / 10) * 10))
  if (p.cash < 0) {
    const s = -p.cash
    const i = Math.round(s * P.shortRate)
    p.short += s + i
    p.cash = 0
    addF(p, 'shortInterest', i)
    tr(G, p, 'short', s, `短期借入${Math.round(s)}（金利${i}は残高に計上）`)
    G.log.push({ t: 'short', p: p.id, period: G.period, amt: s, why })
  }
}
function borrow(G, p, a) {
  if (a <= 0) return
  p.loan += a
  p.cash += a
  tr(G, p, 'loan', a)
  const i = Math.round(a * G.P.loanRate)
  p.cash -= i
  addF(p, 'interest', i)
  tr(G, p, 'interest', -i)
}
function accrue(G, p) {
  const t = Math.min(G.clock, G.periodMin)
  const dt = t - p.lastT
  if (dt <= 0) return
  const f = dt / G.periodMin
  p.pend.rent += occ(p).reduce((s, r) => s + r.rent, 0) * f
  p.pend.own += p.bldgs.reduce((s, b) => s + b.own * b.rooms.length, 0) * f
  p.pl.occRQ += occ(p).length * f
  p.pl.availRQ += p.bldgs.reduce((s, b) => s + b.rooms.length, 0) * f
  p.lastT = t
}
/**
 * 家賃と借上げ賃料の倍率：payMode 'perTurn' のときは、自分の手番ごとに1期分の額をまるごと受け取り・払うので、
 * 1期あたりでは 手番の数 倍になる（自動プレイヤーの見積もり用）。'time' なら1
 */
const K = (G) => (G.P.payMode === 'perTurn' ? (G.P.turnsPerPeriod?.[G.period] ?? G.P.turnsPerPeriod?.default ?? 1) : 1)
function collect(G, p) {
  if (G.P.payMode === 'perTurn') {
    // 手番ごとにまるごと（2026-10-08 ユーザー案）：入居中の部屋の家賃を受け取り、借りている棟の全室分の借上げ賃料を払う。期末の精算はない
    accrue(G, p) // 入居率の集計だけ（お金は動かさない）
    p.pend = { rent: 0, own: 0 }
    if (G.ctx?.phase === 'end') return
    const rent = occ(p).reduce((s, r) => s + r.rent, 0)
    p.cash += rent
    p.pl.rev += rent
    if (rent > 0) tr(G, p, 'rent', rent)
    // 自分の手番の最後に精算する（2026-10-08 ユーザー判断）。借りた手番は、その棟の借上げ賃料なし。次の手番から毎手番まるごと
    pay(G, p, p.bldgs.reduce((s, b) => s + (b.leasedTot === (p.totTurns || 0) ? 0 : b.own * b.rooms.length), 0), 'ownerRent')
    return
  }
  accrue(G, p)
  p.cash += p.pend.rent
  p.pl.rev += p.pend.rent
  if (p.pend.rent > 0) tr(G, p, 'rent', p.pend.rent)
  pay(G, p, p.pend.own, 'ownerRent')
  p.pend = { rent: 0, own: 0 }
}

// ---- 入居・退去 ----
/** その会社のそのエリアの募集中の部屋に、type の入居者を n 室入れる。家賃は rentOf(棟)。戻り値は入居した室数 */
function fill(G, p, area, type, n, rentOf) {
  accrue(G, p)
  const P = G.P
  const cand = []
  for (const b of p.bldgs) if (b.area === area) for (const r of b.rooms) if (r.st === 'vac') cand.push({ r, b })
  cand.sort((x, y) => rentOf(y.b) - rentOf(x.b))
  let got = 0
  for (const { r, b } of cand.slice(0, Math.max(0, n))) {
    // リノベした棟は入ってくる家賃が＋2
    // リノベした棟（renoMode 'building'）またはリノベした部屋（'room'）は、入ってくる家賃が＋2
    Object.assign(r, { st: 'occ', type, rent: rentOf(b) + (b.reno || r.reno ? P.renoRent : 0) })
    got++
  }
  if (got) {
    note(G, p, `入居 ${{ corp: '法人', indiv: '個人', stud: '学生' }[type]}${got}室（${area === 'city' ? '都市' : area === 'suburb' ? '郊外' : '地方'}・家賃${cand[0] ? rentOf(cand[0].b) : ''}）`)
    pay(G, p, got * P.V[type], 'V', false)
    p.pl.vq += got * P.V[type]
    p.pl.contracts[type] += got
  }
  return got
}
function evict(G, p, rooms, type) {
  accrue(G, p)
  // ためておく市場では、退去した人はその棟のエリアの市場に戻る（次の期首に並ぶ）
  if (G.P.supplyMode === 'stock' && G.P.marketMode !== 'cards')
    for (const b of p.bldgs)
      for (const r of b.rooms)
        // 個人は indivReturnRate の割合だけ市場に戻る（残りはゲームから去る）
        if (rooms.includes(r) && (type !== 'indiv' || G.rand() < G.P.indivReturnRate)) G.back[b.area][type] = (G.back[b.area][type] || 0) + 1
  if (rooms.length) note(G, p, `退去 ${{ corp: '法人', indiv: '個人', stud: '学生' }[type]}${rooms.length}室`)
  for (const r of rooms) Object.assign(r, { st: 'vac', type: null, rent: 0 })
  pay(G, p, rooms.length * G.P.restore[type], 'restore')
}

/**
 * 入居者の入札。親がエリア・種類・室数を宣言 → そのエリアに募集中の部屋がある他社が参加 → 全員が家賃を伏せて出す →
 * 安い順に（リノベは2、法人の入札では法人営業チップ1枚ごとに1安いものとして比べる）、宣言した室数まで入居。
 * 学生は入居させた会社がストッカーから＋1人（空室があれば）。法人は corpDice のとき、勝った会社がサイコロを振り出た目の分だけ家賃を下げる
 */
function auction(G, parent, area, type, seats) {
  const P = G.P
  const bidders = [parent]
  // 子は、そのエリアに空室があり、その種類を取りにいく性格なら参加する
  for (const q of G.players) {
    if (q === parent || vac(q, area) <= 0 || (type === 'indiv' && q.flags.noIndiv)) continue
    // smart：入れられる室数があり、1室の価値がプラスなら参加する
    if (q.strat) {
      if (seatsOf(G, q, area, type) > 0 && roomValue(G, q, area, type) > 0 && G.rand() < 0.95) bidders.push(q)
    } else if (ps(q).prefer.includes(type) && G.rand() < 0.9) bidders.push(q)
  }
  const bids = bidders.map((q) => {
    const open = q.bldgs.filter((b) => b.area === area && b.rooms.some((r) => r.st === 'vac'))
    const cap = Math.max(...open.map((b) => mktOf(P, q, b))) + P.bidCap[type]
    const s = ps(q)
    const total = occ(q).length + vac(q)
    const pressure = total ? Math.round((vac(q) / total) * 4) : 0
    const corpExtra = type === 'corp' ? 2 : 0 // 法人は一度入れば出ていかないので、少し安くしてでも取りにいく
    // 参加する会社は入札の前に名乗り出るので、自分しかいなければ相場いっぱいで出す。相手がいるときだけ値引きする（2026-10-07）
    // smart：基本の値引き ＋ そのエリアで負けが続いた分（adapt）。勝つと戻す
    const disc = q.strat ? s.disc + (q.adapt[area] || 0) + Math.floor(G.rand() * 2) : s.bidDisc + pressure + corpExtra + Math.max(0, bidders.length - 2) + Math.floor(G.rand() * 3)
    const floor = floorOf(P, type, area)
    const price = bidders.length === 1 ? cap : Math.max(floor, Math.min(cap, cap - disc))
    // 営業チップ1枚ごとに2低くコールしたものとして比べる（製造業MGと同じ）
    const eff = price - q.salesChips * P.salesChipBid
    // 管理能力を超えて入居させられない（mgmtHardCap）：取れる室数は 管理能力 − 今の入居室数 まで
    const room = P.mgmtHardCap ? Math.max(0, mgmtRoom(P, q, area)) : Infinity
    const offer = Math.min(type === 'indiv' ? indivCap(P, q, area) : leaseCap(P, q, area), vac(q, area), room)
    return { q, price, eff, offer, tie: G.rand() }
  })
  bids.sort((x, y) => x.eff - y.eff || Number(y.q === parent) - Number(x.q === parent) || x.tie - y.tie)
  if (G.trace) {
    const nm = { corp: '法人', indiv: '個人', stud: '学生' }[type]
    const an = { city: '都市', suburb: '郊外', rural: '地方' }[area]
    const txt = `入札 ${an}・${nm}${seats}室（親 ${parent.id + 1}社）：` + bids.map((b) => `${b.q.id + 1}社 ${b.price}${b.q.salesChips ? `（営業チップ${b.q.salesChips}枚・宣言${b.eff}）` : ''}`).join(' ／ ') + `・市場の人駒 ${G.market[area][type]}`
    for (const b of bids) note(G, b.q, txt)
  }
  let left = Math.min(seats, G.market[area][type])
  for (const bd of bids) {
    if (left <= 0) break
    const n = Math.min(left, bd.offer)
    if (n <= 0) continue
    let cut = 0
    // 法人の単価交渉（corpDice。2026-10-08 復活）：勝った会社がサイコロを振り、4・5・6の目で家賃が1・2・3下がる（営業チップは関係しない）
    if (type === 'corp' && P.corpDice) cut = Math.max(0, 1 + Math.floor(G.rand() * 6) - 3)
    // 法人の単価交渉：いつも最大の値下げを受ける前提（corpCutFixed。2026-10-08 ユーザー案）
    if (type === 'corp' && P.corpCutFixed) cut = P.corpCutFixed
    const got = fill(G, bd.q, area, type, n, () => Math.max(1, bd.price - cut))
    if (got > 0) bd.won = true
    left -= got
    G.market[area][type] -= got
    // 集計用：借りた棟が8割埋まった手番を記録
    for (const b of bd.q.bldgs) if (b.leasedAt && !b.filledAt && b.rooms.filter((r) => r.st === 'occ').length >= Math.ceil(b.rooms.length * 0.8)) b.filledAt = { period: G.period, turn: bd.q.turnNo, clock: G.clock }
    if (type === 'stud' && got > 0 && P.studBonus) {
      // ストッカーから＋2人（管理能力の範囲まで）
      const extra = P.mgmtHardCap ? Math.min(P.studBonus, Math.max(0, mgmtRoom(P, bd.q, area))) : P.studBonus
      fill(G, bd.q, area, 'stud', extra, () => bd.price)
    }
  }
  // 勝ち負けを覚える（smart の勝率の見込みと値引きの調整に使う）
  if (bidders.length > 1)
    for (const bd of bids) {
      const q = bd.q
      if (!q.strat) continue
      const won = q.pl.contracts && q.bldgs.some((b) => b.area === area) && bd.won
      const st = (q.bidStat[area] ||= { w: 0, n: 0 })
      st.n++
      if (won) st.w++
      q.adapt[area] = Math.max(0, Math.min(6, (q.adapt[area] || 0) + (won ? -1 : 1)))
    }
  G.auctions.push({ type, area, n: bidders.length, seats, parent: parent.persona, parentPrice: bids.find((b) => b.q === parent).price, parentWon: bids.find((b) => b.q === parent).eff <= Math.min(...bids.map((b) => b.eff)) })
  return true
}

// ---- リスク・チャンス ----
const EV = {
  defect(G, p) {
    const b = [...p.bldgs].sort((x, y) => occ({ bldgs: [y] }).length - occ({ bldgs: [x] }).length)[0]
    const o = b.rooms.filter((r) => r.st === 'occ')
    const out = o.slice(0, Math.ceil(o.length / 2))
    for (const t of TYPES) evict(G, p, out.filter((r) => r.type === t), t)
    pay(G, p, G.P.defectCost, 'defect')
    p.flags.noIndiv = 1
  },
  corpCancel(G, p) {
    const P = G.P
    let out = []
    if (P.corpCancel === 'half') {
      const c = occ(p, 'corp')
      out = c.slice(0, Math.ceil(c.length / 2))
    } else {
      let top = null
      let m = 0
      for (const b of p.bldgs) {
        const n = b.rooms.filter((r) => r.st === 'occ' && r.type === 'corp').length
        if (n > m) {
          m = n
          top = b
        }
      }
      if (top) out = top.rooms.filter((r) => r.st === 'occ' && r.type === 'corp')
    }
    evict(G, p, out, 'corp') // 原状回復は法人が負担（0）
    G.cancelled += out.length
  },
  // 感染症：この期は学生の入居契約ができない（人駒は市場に残る）
  pandemic(G) {
    G.noStud = true
  },
  lawsuit(G, p) {
    pay(G, p, G.P.lawsuitCost, 'lawsuit')
  },
  // 漏水・設備故障（2026-10-09）：家具のある部屋がいちばん多い棟（同じなら先に借りた棟）の1棟まるごと。
  // 修繕費 ＝ 家具のある部屋 × repairPerRoom。保険があれば 受取保険金 ＝ その部屋数 × insPerRoom（特別利益・A列）を受け取り、保険チップを1枚返す
  leak(G, p) {
    const furnished = (b) => b.rooms.filter((r) => r.st !== 'none').length
    const b = p.bldgs.reduce((a, x) => (furnished(x) > furnished(a) ? x : a), p.bldgs[0])
    const n = furnished(b)
    if (!n) return
    pay(G, p, n * G.P.repairPerRoom, 'repair')
    if (p.ins > 0) {
      const got = n * G.P.insPerRoom
      p.ins--
      p.cash += got
      p.pl.special = (p.pl.special || 0) + got
      tr(G, p, 'insClaim', got, '受取保険金')
    }
  },
  // 家賃の滞納（2026-10-09）：家賃がいちばん高い個人の部屋（同じなら先に借りた棟の部屋）
  arrears(G, p) {
    const r = occ(p, 'indiv').reduce((a, x) => (!a || x.rent > a.rent ? x : a), null)
    if (r) pay(G, p, r.rent, 'arrears')
  },
  noise(G, p) {
    for (const a of G.P.mgmtByArea ? ['city', 'suburb', 'rural'] : [null]) if (mgmtRoom(G.P, p, a) < 0) return evict(G, p, occ(p, 'indiv', a).slice(0, 1), 'indiv')
  },
  competitor(G, p) {
    p.flags.competitor = true
  },
  // 人駒を増やすカードの人数は G.P.eventAdd（カードごとの人数）で決める（2026-10-08：はじめからあふれさせないため数値ルールにした）
  rush(G) {
    if (G.P.marketMode === 'cards') return // 顧客カードの市場では効果なし（チャンスカードは見直し中：2026-10-09）
    G.market.city.indiv += G.P.eventAdd.rush
    G.market.suburb.indiv += G.P.eventAdd.rush
  },
  foreign(G, p) {
    if (G.P.marketMode === 'cards') return // 顧客カードの市場では効果なし（チャンスカードは見直し中：2026-10-09）
    const a = p.bldgs.length ? p.bldgs[0].area : 'suburb'
    G.market[a].corp += G.P.eventAdd.foreign
  },
  factory(G) {
    if (G.P.marketMode === 'cards') return // 顧客カードの市場では効果なし（チャンスカードは見直し中：2026-10-09）
    G.market.rural.corp += G.P.eventAdd.factory
  },
  // ---- 市場の人の移動・追加（卓の全員に効く・2026-10-07）。移る元の市場にいる人数までしか動かさない ----
  /** 地方創生：都市の市場の個人3人が地方へ移り、地方に法人＋2 */
  regional(G) {
    if (G.P.marketMode === 'cards') return // 顧客カードの市場では効果なし（チャンスカードは見直し中：2026-10-09）
    const n = Math.min(3, G.market.city.indiv)
    G.market.city.indiv -= n
    G.market.rural.indiv += n
    G.market.rural.corp += G.P.eventAdd.regional
  },
  /** リモートワーク需要の拡大：都市の市場の個人3人が、郊外に2人・地方に1人移る */
  remote(G) {
    if (G.P.marketMode === 'cards') return // 顧客カードの市場では効果なし（チャンスカードは見直し中：2026-10-09）
    const n = Math.min(3, G.market.city.indiv)
    G.market.city.indiv -= n
    G.market.suburb.indiv += Math.min(2, n)
    G.market.rural.indiv += Math.max(0, n - 2)
  },
  /** 大学の新設：郊外に学生＋4 */
  university(G) {
    if (G.P.marketMode === 'cards') return // 顧客カードの市場では効果なし（チャンスカードは見直し中：2026-10-09）
    G.market.suburb.stud += G.P.eventAdd.university
  },
  /** 都心の再開発：都市に個人＋4 */
  redevelop(G) {
    if (G.P.marketMode === 'cards') return // 顧客カードの市場では効果なし（チャンスカードは見直し中：2026-10-09）
    G.market.city.indiv += G.P.eventAdd.redevelop
  },
  pricing(G, p) {
    for (const b of p.bldgs) for (const r of b.rooms) if ((b.reno || r.reno) && r.st === 'occ') r.rent += 2
  },
}

// ---- 自動プレイヤーの判断 ----
function endCost(G, p) {
  const P = G.P
  const left = Math.max(0, (G.periodMin - Math.min(G.clock, G.periodMin)) / G.periodMin)
  return p.bldgs.reduce((s, b) => s + b.own * b.rooms.length, 0) * left * K(G) + p.pend.own + (p.sales + p.mgmt) * P.salary[G.period - 1] + officeCost(P, p) + Math.round(p.loan * P.repayRate) + p.short + 15
}
function outlook(G, p) {
  const left = Math.max(0, (G.periodMin - Math.min(G.clock, G.periodMin)) / G.periodMin)
  return p.cash - endCost(G, p) + (occ(p).reduce((s, r) => s + r.rent, 0) * left + vac(p) * 20 * left * (G.period >= G.P.loanFrom ? 0.6 : 0.3)) * K(G) + p.pend.rent
}
const canSpend = (G, p, a) => p.cash >= a && outlook(G, p) - a >= ps(p).buffer

function preTurn(G, p) {
  const P = G.P
  // 保険はルールB（借入と同じく、カードを引く前に1つまで）
  if (ps(p).ins && p.ins < 1 && p.bldgs.length && canSpend(G, p, P.insPrice)) {
    pay(G, p, P.insPrice, 'insurance')
    p.ins++
    return
  }
  const room = loanRoom(P, p)
  if (room <= 0) return
  const o = outlook(G, p)
  let need = o < 0 ? -o + 10 : 0
  if (!need && ps(p).borrow && wantExpand(G, p) && p.cash < 120) need = 140 - p.cash
  if (need > 0) borrow(G, p, Math.min(room, Math.ceil(need / 10) * 10))
}
function wantExpand(G, p) {
  const P = G.P
  const s = ps(p)
  // 棟の上限は性格どおり（「1棟を育てる」方針の2棟までの縛りは外した：2026-10-07）
  if (p.bldgs.length >= Math.min(s.maxBldg, P.maxBldg) || !G.market.cards.length || unfurn(p) > 0) return false
  const left = (G.periodMin - Math.min(G.clock, G.periodMin)) / G.periodMin
  if (left < 0.25) return false
  const o = occ(p).length
  const v = vac(p)
  return o + v > 0 && o / (o + v) >= s.expandOcc
}
/** 表向きの棟カードの評価：1室の粗利 ＋ そのエリアの人駒の残り ÷（卓でそのエリアに持たれている棟数＋1） */
function cardScore(G, c) {
  const a = G.P.areas[c.area]
  const supply = TYPES.reduce((s, t) => s + G.market[c.area][t], 0)
  const held = G.players.reduce((s, q) => s + q.bldgs.filter((b) => b.area === c.area).length, 0)
  return a.mkt - a.own - (c.old ? 0.5 : 0) + (supply / (held + 1)) * 2
}
function lease(G, p, i, nf) {
  const c = G.market.cards.splice(i, 1)[0]
  if (G.bdeck.length) G.market.cards.push(G.bdeck.pop())
  accrue(G, p)
  const nb = newBldg(G.P, c)
  note(G, p, `物件を借り上げる：${{ city: '都市', suburb: '郊外', rural: '地方' }[c.area]}${c.old ? '（築古）' : ''}・${nb.rooms.length}室・借上げ賃料${nb.own}／室・相場${nb.mkt}`)
  // 集計用：借りた期と、その時点の自分の手番の回数（埋まるまでの手番を数える）
  nb.leasedAt = { period: G.period, turn: p.turnNo, clock: G.clock }
  nb.leasedTot = p.totTurns || 0 // 何回目の自分の手番で借りたか（期をまたいで数える）
  p.bldgs.push(nb)
  if (nf > 0) buyFurn(G, p, nf)
  staffNewArea(G, p, c.area)
}
/** 物件を探す（ルールA）：表向きの棟カードを山札に戻して混ぜ、表向きを faceUp 枚にそろえ直す */
function searchCards(G, p) {
  G.bdeck.push(...G.market.cards)
  G.market.cards = []
  shuffle(G.bdeck, G.rand)
  while (G.market.cards.length < G.P.faceUp && G.bdeck.length) G.market.cards.push(G.bdeck.pop())
  note(G, p, `物件を探す：表向きを入れ替え（${G.market.cards.map((c) => ({ city: '都市', suburb: '郊外', rural: '地方' })[c.area]).join('・')}）`)
}
function buyFurn(G, p, n) {
  const P = G.P
  n = Math.min(n, P.furnMax, unfurn(p), Math.floor(p.cash / P.furnPrice))
  if (n <= 0) return false
  pay(G, p, n * P.furnPrice, 'furniture', false)
  p.furn.push({ n, book: P.furnPrice })
  while (n > 0) {
    const b = p.bldgs.filter((x) => x.rooms.some((r) => r.st === 'none')).sort((x, y) => x.rooms.filter((r) => r.st !== 'none').length - y.rooms.filter((r) => r.st !== 'none').length)[0]
    if (!b) break
    b.rooms.find((r) => r.st === 'none').st = 'vac'
    n--
  }
  return true
}
/** 入居契約の候補：自分の募集中の部屋があるエリア × 種類。性格の好み順に、取れる室数が多いものを選ぶ */
function pickContract(G, p) {
  const P = G.P
  const s = ps(p)
  let best = null
  for (const a of AREAS) {
    const v = vac(p, a)
    if (!v) continue
    s.prefer.forEach((t, rank) => {
      if (t === 'stud' && (p.turnNo >= P.studTurns || G.noStud)) return
      if (t === 'indiv' && p.flags.noIndiv) return
      const avail = G.market[a][t]
      const n = Math.min(t === 'indiv' ? indivCap(P, p, a) : leaseCap(P, p, a), v, avail)
      if (n <= 0) return
      const score = n * 10 - rank * 6
      if (!best || score > best.score) best = { a, t, n, score }
    })
  }
  return best
}
function decide(G, p) {
  const P = G.P
  const s = ps(p)
  const v = vac(p)
  // 営業がいちばん足りないエリアで、空室がその営業能力の何倍あるか
  const na = P.salesByArea ? neediestArea(G, p) : null
  const lcA = Math.max(1, leaseCap(P, p, na))
  const vA = P.salesByArea ? vac(p, na) : v
  const salesRoom = P.salesByArea ? salesIn(P, p, na) < P.staffMax : p.sales < P.staffMax
  const lc = leaseCap(P, p)
  // 管理能力がいちばん足りないエリア（空室があって、管理の残りが1室以下）
  const ma = mgmtNeedArea(G, p)
  if (P.mgmtHardCap && ma && vac(p, ma) > 0 && mgmtRoom(P, p, ma) <= 1) {
    if (s.lock && p.locks < P.lockMax && canSpend(G, p, P.lockPrice)) return buyLock(G, p, ma)
    if (p.mgmt < P.staffMax * 3 && canSpend(G, p, P.hireCost + 30)) return hire(G, p, 'mgmt', ma)
  }
  if (vA >= lcA * 3 && salesRoom && canSpend(G, p, P.hireCost + 30)) return hire(G, p, 'sales')
  if (v > 0) {
    const c = pickContract(G, p)
    if (c) return auction(G, p, c.a, c.t, c.n)
  }
  if (unfurn(p) > 0) {
    const n = Math.min(unfurn(p), P.furnMax, Math.floor((p.cash - s.buffer / 2) / P.furnPrice))
    if (n > 0 && buyFurn(G, p, n)) return
  }
  if (ma && occ(p, null, P.mgmtByArea ? ma : null).length + vac(p, P.mgmtByArea ? ma : null) > mgmtCap(P, p, P.mgmtByArea ? ma : null) - 2) {
    if (s.lock && p.locks < P.lockMax && canSpend(G, p, P.lockPrice)) return buyLock(G, p, ma)
    if (p.mgmt < P.staffMax * (P.mgmtByArea ? 3 : 1) && canSpend(G, p, P.hireCost + 30)) return hire(G, p, 'mgmt', ma)
  }
  if (wantExpand(G, p)) {
    const i = G.market.cards.map((c, k) => [cardScore(G, c), k]).sort((x, y) => y[0] - x[0])[0][1]
    const c = G.market.cards[i]
    const own = (P.areas[c.area].own + (c.old ? P.oldDelta : 0)) * roomsOf(P, c.area)
    const left = (G.periodMin - Math.min(G.clock, G.periodMin)) / G.periodMin
    if (p.cash >= 50 && outlook(G, p) - own * left - 96 + own * left * 1.3 >= s.buffer) return lease(G, p, i, Math.min(roomsOf(P, c.area), Math.floor((p.cash - s.buffer) / P.furnPrice)))
  }
  if (vA >= lcA * 2 && salesRoom && canSpend(G, p, P.hireCost + 30)) return hire(G, p, 'sales')
  if (v > lc && p.ads < p.sales * P.adPerSales && canSpend(G, p, P.adPrice)) return buy(G, p, 'ads', P.adPrice, 'ads')
  if (p.salesChips < Math.min(s.salesChips, P.salesChipMax) && canSpend(G, p, P.salesChipPrice)) return buy(G, p, 'salesChips', P.salesChipPrice, 'salesChip')
  if (s.reno) {
    const b = [...p.bldgs].filter((x) => !x.reno).sort((x, y) => occ({ bldgs: [y] }).length - occ({ bldgs: [x] }).length)[0]
    if (b && canSpend(G, p, P.renoPrice)) {
      note(G, p, `リノベ（${{ city: '都市', suburb: '郊外', rural: '地方' }[b.area]}の棟）`)
      pay(G, p, P.renoPrice, 'reno')
      accrue(G, p)
      b.reno = true
      for (const r of b.rooms) if (r.st === 'occ') r.rent += P.renoRent // 入居中の部屋にも効く
      return
    }
  }
}
function hire(G, p, kind, area) {
  const P = G.P
  pay(G, p, P.hireCost, 'hire')
  p[kind]++
  note(G, p, `${kind === 'sales' ? '営業' : '管理'}スタッフを採用`)
  if (kind === 'sales' && P.salesByArea) {
    // 配属先：指定がなければ、空室に対して営業がいちばん足りないエリア
    const a = area || neediestArea(G, p)
    p.salesBy[a] = (p.salesBy[a] || 0) + 1
  }
  if (kind === 'mgmt' && P.mgmtByArea) {
    const a = area || mgmtNeedArea(G, p) || 'suburb'
    p.mgmtBy[a] = (p.mgmtBy[a] || 0) + 1
  }
}
/** 管理がいちばん足りないエリア：（入居＋空室）− 管理能力 が大きいエリア */
function mgmtNeedArea(G, p) {
  const P = G.P
  const areas = [...new Set(p.bldgs.map((b) => b.area))]
  if (!P.mgmtByArea) return areas[0] || 'suburb'
  return areas.sort((x, y) => occ(p, null, y).length + vac(p, y) - mgmtCap(P, p, y) - (occ(p, null, x).length + vac(p, x) - mgmtCap(P, p, x)))[0]
}
/** スマートロック：mgmtByArea のときは付けたエリアだけに効く */
function buyLock(G, p, area) {
  pay(G, p, G.P.lockPrice, 'lock')
  p.locks++
  if (G.P.mgmtByArea) p.lockBy[area] = (p.lockBy[area] || 0) + 1
}
/** 空室 ÷（営業＋1）がいちばん大きいエリア（棟のあるエリアの中から） */
function neediestArea(G, p) {
  const areas = [...new Set(p.bldgs.map((b) => b.area))]
  return areas.sort((x, y) => vac(p, y) / (salesIn(G.P, p, y) + 1) - vac(p, x) / (salesIn(G.P, p, x) + 1))[0] || 'suburb'
}
/** 営業がいないエリアに棟を借りたとき：採用できれば採用、できなければ営業の多いエリアから配置転換（ルールB・1人5） */
function staffNewArea(G, p, area) {
  const P = G.P
  // 管理スタッフもエリア配属なら、そのエリアに管理がいなければ採用（できなければ管理の多いエリアから配置転換）
  if (P.mgmtByArea && !(p.mgmtBy[area] > 0)) {
    if (canSpend(G, p, P.hireCost + 30)) hire(G, p, 'mgmt', area)
    else {
      const from = Object.keys(p.mgmtBy).sort((x, y) => p.mgmtBy[y] - p.mgmtBy[x])[0]
      if (from && p.mgmtBy[from] >= 2) {
        pay(G, p, P.transferCost, 'transfer')
        p.mgmtBy[from]--
        p.mgmtBy[area] = (p.mgmtBy[area] || 0) + 1
      }
    }
  }
  if (!P.salesByArea || salesIn(P, p, area) > 0) return
  if (p.sales < P.staffMax * 3 && canSpend(G, p, P.hireCost + 30)) return hire(G, p, 'sales', area)
  const from = Object.keys(p.salesBy).sort((x, y) => p.salesBy[y] - p.salesBy[x])[0]
  if (from && p.salesBy[from] >= 2) {
    pay(G, p, P.transferCost, 'transfer')
    p.salesBy[from]--
    p.salesBy[area] = (p.salesBy[area] || 0) + 1
  }
}
function buy(G, p, k, price, fk) {
  pay(G, p, price, fk)
  p[k]++
}

// ---- 自動プレイヤー（smart：2026-10-08 作り直し） ----
// 決め打ちの順番ではなく、意思決定カードを引くたびに「打てる手」をすべて並べ、
// 「この期の残り＋この先（最大1.5期）でいくら得か − 費用」がいちばん大きい手を選ぶ。
// 戦略の癖（値引きの幅・棟の上限・営業チップや広告やリノベの好み など）は会社ごとにランダムに決め（sampleStrategy）、
// どんな戦い方が勝つかを数値ルールの評価に使う。

/** 戦い方を会社ごとにランダムに決める。style は集計用のラベル（絞る／広げる × 高く貸す／安く貸す） */
function sampleStrategy(rand) {
  const u = (a, b) => a + (b - a) * rand()
  const s = {
    disc: Math.floor(u(0, 7)), // 相手がいる入札で相場から引く基本の額（0〜6）
    // 棟の上限（2〜6）。P.noBldgCap のときは上限を持たず、得になる限り借りる（2026-10-08 案）
    maxBldg: 2 + Math.floor(u(0, 5)),
    leasePerPeriod: 1 + Math.floor(u(0, 2)), // 1期に借りる棟の数の上限（1〜2）
    buffer: Math.round(u(0, 60)), // 手元に残しておきたい現金の余裕
    chipW: u(0.5, 1.5), // 営業チップの好み
    adW: u(0.5, 1.5), // 広告の好み
    renoW: u(0, 1.5), // リノベの好み
    hireW: u(0.6, 1.4), // 採用の好み
    leaseW: u(0.6, 1.4), // 棟を借りる好み
    typeW: { corp: u(0.7, 1.3), indiv: u(0.7, 1.3), stud: u(0.7, 1.3) }, // 入居者の種類の好み
    ins: rand() < 0.4, // 保険に入るか
    borrow: rand() < 0.75, // 借入して投資するか
    lock: rand() < 0.5, // 管理が足りないときスマートロックを使うか
    noise: u(0.05, 0.25), // 判断のゆらぎ（人のばらつき）
  }
  s.style = (s.maxBldg >= 5 ? 'wide' : 'narrow') + (s.disc >= 3 ? 'Low' : 'High')
  // 旧ロジックと共用する項目（canSpend・自動の採用など）
  s.prefer = TYPES
  s.salesChips = 0
  s.expandOcc = 0
  return s
}
export const STYLE_KEYS = ['narrowHigh', 'narrowLow', 'wideHigh', 'wideLow']

/** この期の残り（0〜1）と、この先の期の重み（最終期は0。最大1.5期） */
function horizon(G) {
  const L = Math.max(0, (G.periodMin - Math.min(G.clock, G.periodMin)) / G.periodMin)
  const fut = Math.min(1.5, G.P.periods - G.period) * 0.8
  return { L, fut }
}
/** 1期にとどまる割合の目安（法人は解約カードだけ・個人はサイコロ平均3.5室・学生は半分が卒業） */
function stayOf(p, t) {
  if (t === 'corp') return 0.9
  if (t === 'stud') return 0.45
  return Math.max(0.2, 1 - 3.5 / Math.max(4, occ(p, 'indiv').length + 2))
}
/** そのエリアで入札するときの家賃の見込み（相手がいれば値引き分を引く） */
function rentEst(G, p, area, t, mkt) {
  const s = ps(p)
  const rivals = G.players.filter((q) => q !== p && vac(q, area) > 0).length
  return Math.max(floorOf(G.P, t, area), mkt - (rivals ? s.disc + (p.adapt?.[area] || 0) : 0))
}
const ownOf = (P, area) => P.areas[area].own
const mktArea = (p, area, P) => {
  const bs = p.bldgs.filter((b) => b.area === area)
  return bs.length ? Math.max(...bs.map((b) => mktOf(P, p, b))) : P.areas[area].mkt
}
/** 1室を入れたときの価値：粗利 ×（この期の残り ＋ この先 × とどまる割合）− 入居費用 */
function roomValue(G, p, area, t) {
  const P = G.P
  const { L, fut } = horizon(G)
  const m = rentEst(G, p, area, t, mktArea(p, area, P)) - ownOf(P, area)
  // 空室でも借上げ賃料は払っているので、埋めた価値は家賃そのもの（粗利ではなく家賃）で見る
  const rent = m + ownOf(P, area)
  return rent * K(G) * (L + fut * stayOf(p, t)) - P.V[t] - P.restore[t] * (1 - stayOf(p, t)) * (fut > 0 ? 1 : 0)
}
/** 入札に勝つ見込み：相手がいなければほぼ勝つ。これまでの勝ち負け・営業チップの差で動かす */
function pWin(G, p, area) {
  const rivals = G.players.filter((q) => q !== p && vac(q, area) > 0)
  if (!rivals.length) return 0.95
  const st = p.bidStat?.[area] || { w: 0, n: 0 }
  const base = (st.w + 1) / (st.n + 2)
  const chipGap = p.salesChips - rivals.reduce((s, q) => s + q.salesChips, 0) / rivals.length
  return Math.min(0.95, Math.max(0.05, base + 0.12 * chipGap))
}
/** そのエリア・種類の入札で入れられる室数（営業能力・空室・管理能力・市場の人駒） */
/** 市場の人駒の数（カードの市場では、そのエリア・種類の顧客カードの室数の合計をめやすにする） */
const supplyOf = (G, area, t) => (G.P.marketMode === 'cards' ? G.P.tenantCards.filter((c) => c[0] === area && (!t || c[1] === t)).reduce((s, c) => s + c[2], 0) : t ? G.market[area][t] : TYPES.reduce((s, x) => s + G.market[area][x], 0))
function seatsOf(G, p, area, t) {
  const P = G.P
  const cap = t === 'indiv' ? indivCap(P, p, area) : leaseCap(P, p, area)
  return Math.max(0, Math.min(cap, vac(p, area), P.mgmtHardCap ? mgmtRoom(P, p, area) : Infinity, supplyOf(G, area, t)))
}
/** そのエリアで埋めたい室数（空室のうち、管理能力と市場の人駒の範囲） */
function fillable(G, p, area) {
  const P = G.P
  const supply = supplyOf(G, area)
  return Math.max(0, Math.min(vac(p, area), P.mgmtHardCap ? mgmtRoom(P, p, area) : Infinity, supply))
}
/** この期に残っている自分の意思決定の回数の目安 */
function decisionsLeft(G, p) {
  const t = G.P.turnsPerPeriod ? G.P.turnsPerPeriod[G.period] ?? G.P.turnsPerPeriod.default : 6
  return Math.max(0, (t - p.turnNo) * 0.68)
}
/** 営業能力 cap のとき、埋めたい室数を埋めきるまでに空いている「室×期」の目安（入札の勝率と残りの回数から） */
function idleRooms(G, p, area, cap) {
  const f = fillable(G, p, area)
  if (!f) return 0
  if (cap <= 0) return f
  const need = Math.ceil(f / cap) / pWin(G, p, area)
  const left = Math.max(1, decisionsLeft(G, p))
  return f * Math.min(1, need / (2 * left))
}
/** 新しく借りる棟の、期の平均の入居率の見込み（そのエリアの人駒と、他社の空室から） */
function expectFill(G, p, area, rooms, future = false) {
  // そのエリアの人駒を、そこに棟を持つ会社（自分を含めて＋1）で分けたときの取り分。他社の空室が多いほど減る。
  // future のときは、次の期首に増える法人と、退去して戻ってくる人（個人の約3割・学生の半分）も数える
  const P = G.P
  let supply = supplyOf(G, area)
  if (future && P.marketMode !== 'cards') {
    supply += Math.round(P.supply[area].corp * G.players.length * P.corpInflow)
    for (const q of G.players) supply += occ(q, 'indiv', area).length * 0.3 + occ(q, 'stud', area).length * 0.5
  }
  const holders = G.players.filter((q) => q !== p && q.bldgs.some((b) => b.area === area)).length + 1
  // 他社の空室・家具なしの部屋は、同じ人駒を取り合う相手として全部数える
  const rivalVac = G.players.reduce((s, q) => s + (q === p ? 0 : vac(q, area) + q.bldgs.filter((b) => b.area === area).reduce((x, b) => x + b.rooms.filter((r) => r.st === 'none').length, 0)), 0)
  // 顧客カードの市場：カードは山札に戻るので需要はなくならない。埋まり具合は、そのエリアで競う会社の数と他社の空室で決まる
  if (P.marketMode === 'cards') return Math.min(0.9, Math.max(0.2, 0.9 - 0.08 * (holders - 1) - rivalVac / (rooms * 6)))
  return Math.min(0.95, Math.max(0.1, (supply - rivalVac) / holders / rooms))
}

// ---- 顧客カード（marketMode 'cards'：2026-10-09） ----
// シミュレーターでは同期で動く。画面（プロトタイプ）に組み込むときは、あなたの入力を待つため async に変換される（engine.py）
function makeTenantDeck(P, rand) {
  return shuffle(P.tenantCards.map(([area, type, rooms, d]) => ({ area, type, rooms, budget: P.areas[area].mkt + d })), rand)
}
function drawTenant(G) {
  if (!G.tdeck || !G.tdeck.length) G.tdeck = makeTenantDeck(G.P, G.rand)
  return G.tdeck.pop()
}
/** そのカードに応札できるか：希望エリアに室数分の空室と管理能力がある（学生は春だけ・施工不備の次の手番は個人に出られない） */
/** そのカードで入れられる室数（cardPartial なら空室・管理能力の範囲で一部でもよい） */
function takeRooms(G, q, c) {
  const P = G.P
  const room = Math.min(vac(q, c.area), P.mgmtHardCap ? Math.max(0, mgmtRoom(P, q, c.area)) : Infinity)
  return P.cardPartial ? Math.min(c.rooms, room) : room >= c.rooms ? c.rooms : 0
}
function canTake(G, q, c, opener) {
  const P = G.P
  if (takeRooms(G, q, c) <= 0) return false
  if (c.type === 'stud' && ((P.studSpring !== false && (opener ? opener.turnNo : q.turnNo) >= P.studTurns) || G.noStud)) return false
  if (c.type === 'indiv' && q.flags.noIndiv) return false
  return true
}
/** 顧客カードのうち、いま自分が応札できるカードの割合 */
const matchRate = (G, p) => G.P.tenantCards.filter(([area, type, rooms]) => canTake(G, p, { area, type, rooms }, p)).length / G.P.tenantCards.length
/** 入札の上限：カードの予算と、そのエリアの自分の棟の相場の低い方 */
const capFor = (G, q, c) => Math.min(c.budget, Math.max(...q.bldgs.filter((b) => b.area === c.area && b.rooms.some((r) => r.st === 'vac')).map((b) => mktOf(G.P, q, b))))
/** 1枚の顧客カードの入札。開いた会社と、条件に合う物件を持つ会社が応札。安い宣言（家賃 − 2×営業チップ）が取り、契約家賃は書いた額 */
function cardAuction(G, opener, c) {
  const P = G.P
  const bidders = [opener]
  for (const q of G.players) {
    if (q === opener || !canTake(G, q, c, opener)) continue
    if (q.human) bidders.push(q)
    else if (q.strat && roomValue(G, q, c.area, c.type) > 0 && G.rand() < 0.95) bidders.push(q)
  }
  for (const q of [...bidders]) {
    if (!q.human) continue
    q._bid = q === opener ? G.humanPrice : G.askHuman({ parent: opener, area: c.area, type: c.type, seats: c.rooms, card: c, others: bidders.length - 1 })
    if (q._bid == null) bidders.splice(bidders.indexOf(q), 1)
  }
  if (!bidders.length) return
  const bids = bidders.map((q) => {
    const cap = capFor(G, q, c)
    const floor = floorOf(P, c.type, c.area)
    let price
    if (q.human) price = q._bid
    else {
      const disc = q.strat.disc + (q.adapt[c.area] || 0) + Math.floor(G.rand() * 2)
      price = bidders.length === 1 ? cap : Math.max(floor, Math.min(cap, cap - disc))
    }
    return { q, price, eff: price - q.salesChips * P.salesChipBid, tie: G.rand() }
  })
  bids.sort((x, y) => x.eff - y.eff || Number(y.q === opener) - Number(x.q === opener) || x.tie - y.tie)
  const w = bids[0]
  const cut = c.type === 'corp' && P.corpDice ? Math.max(0, 1 + Math.floor(G.rand() * 6) - 3) : 0
  const tn = { corp: '法人', indiv: '個人', stud: '学生' }[c.type]
  const an = { city: '都市', suburb: '郊外', rural: '地方' }[c.area]
  if (G.trace) {
    const txt = `入札 ${an}・${tn}${c.rooms}室（予算${c.budget}・開いた会社 ${opener.id + 1}社）：` + bids.map((b) => `${b.q.id + 1}社 ${b.price}${b.q.salesChips ? `（営業チップ${b.q.salesChips}枚・宣言${b.eff}）` : ''}`).join(' ／ ') + ` → ${w.q.id + 1}社${cut ? `（単価交渉 −${cut}）` : ''}`
    for (const b of bids) note(G, b.q, txt)
  }
  fill(G, w.q, c.area, c.type, takeRooms(G, w.q, c), () => Math.max(1, w.price - cut))
  if (c.type === 'stud' && P.studBonus) fill(G, w.q, c.area, 'stud', Math.min(P.studBonus, vac(w.q, c.area), P.mgmtHardCap ? Math.max(0, mgmtRoom(P, w.q, c.area)) : 99), () => w.price)
  if (bids.length > 1)
    for (const b of bids) {
      if (!b.q.strat) continue
      const st = (b.q.bidStat[c.area] ||= { w: 0, n: 0 })
      st.n++
      if (b === w) st.w++
      b.q.adapt[c.area] = Math.max(0, Math.min(6, (b.q.adapt[c.area] || 0) + (b === w ? -1 : 1)))
    }
  G.auctions.push({ type: c.type, area: c.area, n: bids.length, seats: c.rooms, parent: opener.persona, parentWon: w.q === opener })
}
/** 営業する（ルールA）：営業スタッフの人数 ＋ 広告チップ×adCards 枚をめくり、営業スタッフの人数まで選んで入札。使ったカードはすべて山札の下に戻す */
function salesAction(G, p) {
  const P = G.P
  const n = p.sales + P.adCards * p.ads
  const drawn = Array.from({ length: n }, () => drawTenant(G)).filter(Boolean)
  note(G, p, `営業する：顧客カード ${drawn.length}枚をめくる`)
  let chosen
  if (p.human) chosen = G.humanChoose(drawn) // [{ card, price }]（画面では await される）
  else {
    // 自動プレイヤー：条件に合うカードを、1室の粗利 × 室数 × 種類の好み が大きい順に、営業スタッフの人数まで
    const score = (c) => takeRooms(G, p, c) * (capFor(G, p, c) - ownOf(P, c.area)) * (p.strat.typeW[c.type] || 1)
    chosen = drawn.filter((c) => canTake(G, p, c, p)).sort((x, y) => score(y) - score(x)).slice(0, p.sales).map((card) => ({ card }))
  }
  for (const { card, price } of chosen.slice(0, p.sales)) {
    if (!canTake(G, p, card, p)) continue // 前のカードで空室が埋まった
    G.humanPrice = price
    cardAuction(G, p, card)
  }
  G.tdeck.unshift(...drawn) // 使ったカードはすべて山札の下へ
}

/** 打てる手を並べて、いちばん得な手を打つ */
function decideSmart(G, p) {
  const P = G.P
  const s = ps(p)
  const { L, fut } = horizon(G)
  const sal = P.salary[G.period - 1]
  const H = L + fut
  const cands = []
  const add = (v, cost, run, label) => cands.push({ v: v * (1 + s.noise * (G.rand() * 2 - 1)), cost, run, label })
  const areasHeld = [...new Set(p.bldgs.map((b) => b.area))]

  // 営業する（顧客カード）：空室と管理能力のあるエリアがあれば。見込み＝営業の人数 × 2室 × 勝率 × 1室の価値
  if (P.marketMode === 'cards' && p.sales > 0) {
    const open = areasHeld.filter((a) => vac(p, a) > 0 && (!P.mgmtHardCap || mgmtRoom(P, p, a) > 0))
    if (open.length) {
      const v = open.reduce((x, a) => x + pWin(G, p, a) * roomValue(G, p, a, 'indiv'), 0) / open.length
      // めくる枚数 × 合う割合 の件数（営業の人数まで）× 1件の室数（約1.5）× 勝率 × 1室の価値
      const deals = Math.min(p.sales, (p.sales + P.adCards * p.ads) * matchRate(G, p))
      add(deals * 1.5 * v * (P.salesValueMult ?? 1), 0, () => salesAction(G, p), 'sales')
    }
  }
  // 入札：エリア × 種類
  for (const a of P.marketMode === 'cards' ? [] : areasHeld)
    for (const t of TYPES) {
      if (t === 'stud' && (p.turnNo >= P.studTurns || G.noStud)) continue
      if (t === 'indiv' && p.flags.noIndiv) continue
      const n = seatsOf(G, p, a, t)
      if (n <= 0) continue
      const bonus = t === 'stud' ? Math.min(P.studBonus, vac(p, a) - n, (P.mgmtHardCap ? mgmtRoom(P, p, a) : 99) - n) : 0
      add((n + Math.max(0, bonus)) * pWin(G, p, a) * roomValue(G, p, a, t) * s.typeW[t], 0, () => auction(G, p, a, t, n), `bid ${a} ${t}`)
    }
  // 家具：家具なしの部屋に置く（置かないと募集できない）
  const uf = unfurn(p)
  if (uf > 0) {
    // 現金が足りなければ、買える分だけ置く（家具がないと募集できず、借上げ賃料だけかかり続けるため）
    const n = Math.min(uf, P.furnMax, Math.max(1, Math.floor(p.cash / P.furnPrice)))
    const a = p.bldgs.find((b) => b.rooms.some((r) => r.st === 'none')).area
    add(n * (expectFill(G, p, a, n) * roomValue(G, p, a, 'indiv') - P.furnDep * H), n * P.furnPrice, () => buyFurn(G, p, n), 'furn')
  }
  // 顧客カードの市場：営業1人で めくる＋1枚・入札＋1件、広告1枚で めくる＋2枚。条件に合うカードの割合（matchRate）から見込む
  if (P.marketMode === 'cards') {
    const open = areasHeld.filter((a) => vac(p, a) > 0)
    const rate = matchRate(G, p)
    const rv = open.length ? open.reduce((x, a) => x + roomValue(G, p, a, 'indiv'), 0) / open.length : 0
    const uses = Math.min(12, decisionsLeft(G, p) * 0.4) // この期の残りで営業する回数の目安
    if (open.length && rv > 0) {
      // 1回の営業で決まる件数の見込み：min(営業の人数, めくる枚数 × 合う割合, 埋めたい室数)。増やしたときの差（限界の効果）で比べる
      const want = open.reduce((x, a) => x + Math.min(vac(p, a), P.mgmtHardCap ? Math.max(0, mgmtRoom(P, p, a)) : 99), 0)
      const deals = (sales, ads) => Math.min(sales, (sales + P.adCards * ads) * rate, want)
      const now = deals(p.sales, p.ads)
      const hireA = neediestArea(G, p)
      if (p.sales < P.staffMax * 3) add(uses * (deals(p.sales + 1, p.ads) - now) * 1.5 * rv * s.hireW - sal * H - P.hireCost, P.hireCost, () => hire(G, p, 'sales', hireA), 'hire sales')
      add(uses * (deals(p.sales, p.ads + 1) - now) * 1.5 * rv * s.adW - P.adPrice, P.adPrice, () => buy(G, p, 'ads', P.adPrice, 'ads'), 'ads')
    }
  }
  // 営業の採用：そのエリアの空室を早く埋められる分
  for (const a of P.marketMode === 'cards' ? [] : areasHeld) {
    if (salesIn(P, p, a) >= P.staffMax) continue
    const cap = leaseCap(P, p, a)
    const gain = idleRooms(G, p, a, cap) - idleRooms(G, p, a, cap + P.leasePerSales)
    const rent = rentEst(G, p, a, 'indiv', mktArea(p, a, P))
    add((gain * rent * K(G) * L * 2 + fut * Math.min(2, fillable(G, p, a)) * 4) * s.hireW - sal * (L + fut) - P.hireCost, P.hireCost, () => hire(G, p, 'sales', a), `hire sales ${a}`)
  }
  // 管理の採用・スマートロック：管理能力が足りずに入れられない部屋がある分
  for (const a of areasHeld) {
    const blocked = Math.max(0, occ(p, null, a).length + vac(p, a) - mgmtCap(P, p, a))
    if (!blocked) continue
    const rent = rentEst(G, p, a, 'indiv', mktArea(p, a, P))
    if ((p.mgmtBy[a] || 0) < P.staffMax) add(Math.min(blocked, P.mgmtRooms) * rent * K(G) * H * 0.6 * s.hireW - sal * H - P.hireCost, P.hireCost, () => hire(G, p, 'mgmt', a), `hire mgmt ${a}`)
    if (s.lock && p.locks < P.lockMax) add(Math.min(blocked, P.lockRooms) * rent * K(G) * H * 0.6 - P.lockPrice, P.lockPrice, () => buyLock(G, p, a), `lock ${a}`)
  }
  // 営業チップ：この期の残りの、相手のいる入札で勝ちやすくなる分。2枚以上あれば1枚は次の期へ残る
  {
    let gain = 0
    for (const a of areasHeld) {
      if (!G.players.some((q) => q !== p && vac(q, a) > 0)) continue
      const rooms = Math.min(fillable(G, p, a), Math.ceil(decisionsLeft(G, p)) * Math.max(1, leaseCap(P, p, a)))
      gain += rooms * Math.min(0.95 - pWin(G, p, a), 0.15) * roomValue(G, p, a, 'indiv')
    }
    const keep = p.salesChips >= 1 && fut > 0 ? 0.5 * P.salesChipPrice : 0 // 2枚目からは1枚が次の期に残る
    if (gain > 0) add(gain * s.chipW + keep - P.salesChipPrice, P.salesChipPrice, () => buy(G, p, 'salesChips', P.salesChipPrice, 'salesChip'), 'chip')
  }
  // 広告：個人の入札で＋2室（期末に1枚返す）
  if (P.marketMode !== 'cards' && p.ads < p.sales * P.adPerSales)
    for (const a of areasHeld) {
      if (!salesIn(P, p, a) || G.market[a].indiv <= leaseCap(P, p, a)) continue
      const extra = Math.min(P.adRooms, fillable(G, p, a) - indivCap(P, p, a))
      if (extra > 0) add(extra * pWin(G, p, a) * roomValue(G, p, a, 'indiv') * 0.7 * s.adW - P.adPrice, P.adPrice, () => buy(G, p, 'ads', P.adPrice, 'ads'), 'ads')
    }
  // リノベ（renoMode 'room'：2026-10-08）：選んだ棟の募集中の空室をまとめてリノベ（1室 renoPrice）。その部屋に入る人の家賃が＋2
  if (P.renoMode === 'room') {
    const b = [...p.bldgs].sort((x, y) => y.rooms.filter((r) => r.st === 'vac' && !r.reno).length - x.rooms.filter((r) => r.st === 'vac' && !r.reno).length)[0]
    const rooms = b ? b.rooms.filter((r) => r.st === 'vac' && !r.reno) : []
    if (rooms.length) {
      const left = L + (P.periods - G.period) * 0.85
      const f = expectFill(G, p, b.area, rooms.length, true)
      add(rooms.length * (f * P.renoRent * K(G) * left * s.renoW - P.renoPrice), rooms.length * P.renoPrice, () => {
        note(G, p, `リノベ（${{ city: '都市', suburb: '郊外', rural: '地方' }[b.area]}の棟の空室 ${rooms.length}室）`)
        pay(G, p, rooms.length * P.renoPrice, 'reno')
        for (const r of rooms) r.reno = true
      }, 'reno')
    }
  }
  // リノベ（棟ごと）：入居中の部屋の家賃が＋2（この先ずっと）
  for (const b of P.renoMode === 'room' ? [] : p.bldgs) {
    if (b.reno) continue
    const o = b.rooms.filter((r) => r.st === 'occ').length
    const left = L + (P.periods - G.period) * 0.85
    add((o + vac(p, b.area) * 0.3) * P.renoRent * K(G) * left * s.renoW - P.renoPrice, P.renoPrice, () => {
      note(G, p, `リノベ（${{ city: '都市', suburb: '郊外', rural: '地方' }[b.area]}の棟）`)
      pay(G, p, P.renoPrice, 'reno')
      accrue(G, p)
      b.reno = true
      for (const r of b.rooms) if (r.st === 'occ') r.rent += P.renoRent
    }, 'reno')
    break // 1手番で比べるのは入居の多い棟1つで十分
  }
  // 物件の借り上げ：表向きのカードごと
  const leasedNow = p.bldgs.filter((b) => b.leasedAt && b.leasedAt.period === G.period).length
  // 顧客カードの市場では、空室がほぼ埋まっていて（2室以下）、新しい棟の家具を買える現金があるときだけ借りる（借りすぎて資金が詰まるのを防ぐ）
  const cardsOk = P.marketMode !== 'cards' || (vac(p) <= 2 && p.cash >= 8 * P.furnPrice + 50)
  if (cardsOk && p.bldgs.length < Math.min(s.maxBldg, P.maxBldg) && uf === 0 && leasedNow < s.leasePerPeriod)
    G.market.cards.forEach((c, i) => {
      const rooms = roomsOf(P, c.area)
      const own = P.areas[c.area].own + (c.old ? P.oldDelta : 0)
      const mkt = P.areas[c.area].mkt + (c.old ? P.oldDelta : 0)
      // この期の残りは今の人駒から、この先は次の期首の増加と退去の戻りも入れて見込む
      const f = expectFill(G, p, c.area, rooms)
      const ff = expectFill(G, p, c.area, rooms, true)
      const rent = rentEst(G, p, c.area, 'indiv', mkt)
      const newArea = !areasHeld.includes(c.area)
      const staff = newArea ? (2 * sal + P.officeRent) * H + 2 * P.hireCost : 0
      const v = rooms * K(G) * ((f * rent - own) * L * 0.6 + (ff * rent - own) * fut) - rooms * (P.furnDep * H + ff * P.V.indiv) - staff
      add(v * s.leaseW, rooms * P.furnPrice + (newArea ? 2 * P.hireCost : 0), () => lease(G, p, i, P.leaseWithFurn ? rooms : 0), `lease ${c.area}`)
    })

  // 物件を探す：表向きの棟カードを全部山札に戻して混ぜ、6枚引き直す（2026-10-08）。
  // 広げたいのに表向きに得な棟がないとき、立地ごとの「あれば借りたい棟」の価値との差の半分を見込む
  if (p.bldgs.length < Math.min(s.maxBldg, P.maxBldg) && uf === 0 && leasedNow < s.leasePerPeriod && G.bdeck.length) {
    const val = (area) => {
      const rooms = roomsOf(P, area)
      const f = expectFill(G, p, area, rooms)
      const ff = expectFill(G, p, area, rooms, true)
      const rent = rentEst(G, p, area, 'indiv', P.areas[area].mkt)
      const staff = !areasHeld.includes(area) ? (2 * sal + P.officeRent) * H + 2 * P.hireCost : 0
      return (rooms * K(G) * ((f * rent - P.areas[area].own) * L * 0.6 + (ff * rent - P.areas[area].own) * fut) - rooms * (P.furnDep * H + ff * P.V.indiv) - staff) * s.leaseW
    }
    const bestUp = Math.max(0, ...G.market.cards.map((c) => val(c.area)))
    const bestAny = Math.max(...AREAS.map(val))
    if (bestAny > bestUp) add((bestAny - bestUp) * 0.5, 0, () => searchCards(G, p), 'search')
  }

  // 得な順に、お金が足りる手を打つ（足りなければ借入できる範囲まで見る）
  cands.sort((x, y) => y.v - x.v)
  // 調べもの用（P.debug）：その手番で比べた手の上位4つを残す
  if (G.debugPicks) G.debugPicks.push({ period: G.period, turn: p.turnNo, cash: Math.round(p.cash), vac: vac(p), occ: occ(p).length, bl: p.bldgs.length, top: cands.slice(0, 4).map((c) => `${c.label}:${Math.round(c.v)}`) })
  for (const c of cands) {
    if (c.v <= 0) break
    const room = s.borrow ? loanRoom(P, p) : 0
    if (c.cost > 10 && !(p.cash + room >= c.cost && outlook(G, p) + room - c.cost >= s.buffer)) continue
    if (c.cost > p.cash) borrow(G, p, Math.min(room, Math.ceil((c.cost - p.cash + 10) / 10) * 10))
    G.lastPick = c.label
    if (G.debugPicks) G.debugPicks[G.debugPicks.length - 1].pick = c.label
    return c.run()
  }
  G.lastPick = 'none'
}
/** ルールB（smart）：保険・資金繰りの借入 */
function preTurnSmart(G, p) {
  const P = G.P
  const s = ps(p)
  if (s.ins && p.ins < 1 && p.bldgs.length && canSpend(G, p, P.insPrice)) {
    pay(G, p, P.insPrice, 'insurance')
    p.ins++
    return
  }
  const room = loanRoom(P, p)
  const o = outlook(G, p)
  if (room > 0 && o < 0) borrow(G, p, Math.min(room, Math.ceil((-o + 10) / 10) * 10))
}

// ---- 第1期の台本（全員同じ。2026-10-07 の v2 版） ----
function runTutorial(G) {
  const P = G.P
  // tutorialPlan 'v3'（2026-10-09 ユーザー指定）：人を雇う → 借りる → 家具 → 個人2室 → 広告 → 個人4室 → 営業チップ → 個人2室（満室）→ 保険 → リスク（クレーム）
  const v3 = [
    [0.05, (p) => { for (let i = 0; i < (P.tutorialSales ?? 1); i++) hire(G, p, 'sales', 'suburb'); hire(G, p, 'mgmt', 'suburb'); hire(G, p, 'mgmt', 'suburb') }], // 営業 tutorialSales 人・管理2人
    [0.1, (p) => { accrue(G, p); p.bldgs.push({ ...newBldg(P, { area: 'suburb', old: false }), leasedTot: p.totTurns || 0 }) }],
    [0.15, (p) => buyFurn(G, p, 8)],
    [0.22, (p) => fill(G, p, 'suburb', 'indiv', 2, () => P.areas.suburb.mkt)], // 最初の個人の入札は満額（相場30。2026-10-09）
    [0.3, (p) => buy(G, p, 'ads', P.adPrice, 'ads')],
    [0.4, (p) => fill(G, p, 'suburb', 'indiv', 4, () => P.tutorialRent.indiv)], // 営業2室＋広告2室
    [0.5, (p) => buy(G, p, 'salesChips', P.salesChipPrice, 'salesChip')],
    [0.6, (p) => fill(G, p, 'suburb', 'indiv', 2, () => P.tutorialRent.indiv)], // 満室
    [0.7, (p) => { pay(G, p, P.insPrice, 'insurance'); p.ins++ }],
    [0.8, (p) => EV.leak(G, p)], // リスクカード：漏水・設備故障（手番9の保険で補償される）
  ]
  const steps = P.tutorialPlan === 'v3' ? v3 : [
    // 借りる手番と家具を置く手番を分ける（leaseWithFurn=false）ときは、手番1で借り、手番2で家具を置く（2026-10-08）
    ...(P.leaseWithFurn
      ? [[0.05, (p) => { accrue(G, p); p.bldgs.push({ ...newBldg(P, { area: 'suburb', old: false }), leasedTot: p.totTurns || 0 }); buyFurn(G, p, 8) }]]
      : [
          [0.05, (p) => { accrue(G, p); p.bldgs.push({ ...newBldg(P, { area: 'suburb', old: false }), leasedTot: p.totTurns || 0 }) }],
          [0.1, (p) => buyFurn(G, p, 8)],
        ]),
    // tutorialIndivOnly（2026-10-09 ユーザー判断）：学生・法人は説明だけで、入居させるのは個人だけ（手番3・4・5・9で2室ずつ → 満室）
    ...(P.tutorialIndivOnly
      ? [
          [0.15, (p) => fill(G, p, 'suburb', 'indiv', 2, () => P.tutorialRent.indiv)], // 学生の説明
          [0.22, (p) => fill(G, p, 'suburb', 'indiv', 2, () => P.tutorialRent.indiv)], // 法人・単価交渉の説明
          [0.3, (p) => fill(G, p, 'suburb', 'indiv', 2, () => P.tutorialRent.indiv)],
          [0.4, (p) => EV.corpCancel(G, p)], // リスクカード：法人の解約（法人がいないので影響なし・説明だけ）
          [0.5, (p) => { pay(G, p, P.insPrice, 'insurance'); p.ins++ }],
          [0.6, () => {}],
          [0.7, (p) => fill(G, p, 'suburb', 'indiv', 2, () => P.tutorialRent.indiv)], // 満室
        ]
      : [
          // 練習の家賃（tutorialRent）：学生・法人（単価交渉の前）・個人。講師の目5で法人は2下がる
          [0.15, (p) => { fill(G, p, 'suburb', 'stud', 2, () => P.tutorialRent.stud); fill(G, p, 'suburb', 'stud', P.studBonus, () => P.tutorialRent.stud) }],
          [0.22, (p) => { fill(G, p, 'suburb', 'corp', 2, () => P.tutorialRent.corp - (P.corpDice ? 2 : 0)) }],
          [0.3, (p) => { fill(G, p, 'suburb', 'indiv', 2, () => P.tutorialRent.indiv) }],
          [0.4, (p) => EV.corpCancel(G, p)], // リスクカード：法人の解約（法人2室の半分＝1室）
          [0.5, (p) => { pay(G, p, P.insPrice, 'insurance'); p.ins++ }],
          [0.6, () => {}],
          // 手番6で法人が解約されたので、法人の入札（練習）1室で埋め直す
          [0.7, (p) => fill(G, p, 'suburb', 'corp', 1, () => P.tutorialRent.corp - (P.corpDice ? 2 : 0))],
        ]),
    [0.8, (p) => hire(G, p, 'sales')],
    [0.9, () => {}],
  ]
  for (const [at, f] of steps) {
    G.clock = at * G.periodMin
    for (const p of G.players) {
      if (P.payMode !== 'perTurn') collect(G, p)
      f(p)
      if (P.payMode === 'perTurn') collect(G, p)
      p.turnNo++
      p.totTurns = (p.totTurns || 0) + 1
    }
  }
  G.clock = G.periodMin
  G.tutorialDie = 2 // 期末の個人の退去のサイコロ：講師の目2（全員共通）。家賃の高い部屋から出るので、満額35の2室が退去（2026-10-09）
}

// ---- 期の進行 ----
function refillMarket(G) {
  const P = G.P
  const n = G.players.length
  if (P.supplyMode === 'stock') {
    // ためておく市場：最初の1回（第2期の期首。第1期は台本なので市場を使わない）だけ置き、あとは戻りとカードでだけ増減する
    const first = P.tutorial ? 2 : 1
    if (P.initPer) {
      // 期ごとに少しずつ出す（initPer・inflowPer）。端数は G.carry に持ち越す
      const per = G.period === first ? P.initPer : G.period > first ? P.inflowPer : null
      if (per)
        for (const a of AREAS)
          for (const t of TYPES) {
            const x = per[a][t] * n + (G.carry[a + t] || 0)
            G.market[a][t] += Math.floor(x)
            G.carry[a + t] = x - Math.floor(x)
          }
    } else if (G.period === first)
      for (const a of AREAS) for (const t of TYPES) G.market[a][t] += Math.round(P.supply[a][t] * n * P.stockInit * (t === 'corp' ? P.corpSupplyMult : t === 'stud' ? P.studSupplyMult : 1))
    // 法人は毎期少しずつ出てくる（最初に置いた期の次から）
    else if (G.period > (P.tutorial ? 2 : 1) && P.corpInflow) for (const a of AREAS) G.market[a].corp += Math.round(P.supply[a].corp * n * P.corpInflow)
    for (const a of AREAS) {
      for (const t of TYPES) G.market[a][t] = (G.market[a][t] || 0) + (G.back[a][t] || 0)
      G.back[a] = { corp: 0, indiv: 0, stud: 0 }
      G.returned[a] = 0
    }
    while (G.market.cards.length < P.faceUp && G.bdeck.length) G.market.cards.push(G.bdeck.pop())
    G.marketLog.push({ period: G.period, ...Object.fromEntries(TYPES.map((t) => [t, AREAS.reduce((s, a) => s + G.market[a][t], 0)])) })
    return
  }
  for (const a of AREAS) {
    for (const t of TYPES) G.market[a][t] = Math.round(P.supply[a][t] * n * (t === 'corp' ? P.corpSupplyMult : t === 'stud' ? P.studSupplyMult : 1))
    G.market[a].indiv += G.returned[a]
    G.returned[a] = 0
  }
  while (G.market.cards.length < P.faceUp && G.bdeck.length) G.market.cards.push(G.bdeck.pop())
  // 集計用：期首に市場に並んだ人駒（エリアの合計・種類ごと）
  G.marketLog.push({ period: G.period, ...Object.fromEntries(TYPES.map((t) => [t, AREAS.reduce((s, a) => s + G.market[a][t], 0)])) })
}
function periodStart(G, p) {
  const P = G.P
  p.pl = { rev: 0, vq: 0, F: {}, contracts: { corp: 0, indiv: 0, stud: 0 }, occRQ: 0, availRQ: 0 }
  p.turnNo = 0
  p.flags = {}
  p.lastT = 0
  p.pend = { rent: 0, own: 0 }
  if (G.period === 1) return
  G.ctx = { who: null, phase: 'start' }
  if (p.taxDue) {
    p.cash -= p.taxDue
    tr(G, p, 'tax', -p.taxDue)
    p.taxDue = 0
    if (p.cash < 0) cover(G, p, 'tax')
  }
  if (p.loan) pay(G, p, Math.round(p.loan * P.loanRate), 'interest')
  if (p.short) pay(G, p, Math.round(p.short * P.shortRate), 'shortInterest')
}
const CARD = { decision: '意思決定', defect: '施工不備の発覚', corpCancel: '法人の解約', pandemic: '感染症の流行', lawsuit: 'オーナー訴訟', leak: '漏水・設備故障', arrears: '家賃の滞納', noise: '入居者トラブル（騒音）', competitor: '近くに競合物件', rush: '3月の繁忙期', foreign: '外国人材の受け入れ増', factory: '工場の新設', pricing: 'プライシングの成功', regional: '地方創生', remote: 'リモートワーク需要の拡大', university: '大学の新設', redevelop: '都心の再開発' }
function turn(G, p) {
  G.ctx = { who: p.id, turn: p.turnNo + 1, clock: G.clock }
  // 手番ごとにまるごと（perTurn）のときは手番の最後に精算する。時間でならすときは手番の頭
  if (G.P.payMode !== 'perTurn') collect(G, p)
  if (p.strat) preTurnSmart(G, p)
  else preTurn(G, p)
  if (!G.deck.length) G.deck = shuffle(makeDeck(G.P), G.rand)
  const c = G.deck.pop()
  note(G, p, `カード：${c.kind === 'decision' ? '' : c.kind === 'risk' ? 'リスク　' : 'チャンス　'}${CARD[c.key]}`)
  if (c.kind === 'decision') (p.strat ? decideSmart : decide)(G, p)
  else if (p.bldgs.length) EV[c.key](G, p)
  if (G.P.payMode === 'perTurn') collect(G, p)
  p.turnNo++
  p.totTurns = (p.totTurns || 0) + 1
  if (p.flags.noIndiv && p.flags.noIndiv++ > 1) p.flags.noIndiv = 0
}
function periodEnd(G, p) {
  const P = G.P
  G.ctx = { who: null, phase: 'end' }
  collect(G, p)
  const occEnd = occ(p).length
  const corpN = occ(p, 'corp').length
  pay(G, p, (p.sales + p.mgmt) * P.salary[G.period - 1], 'salary')
  pay(G, p, officeCost(P, p), 'hq')
  const rep = Math.round(p.loan * P.repayRate)
  if (rep) {
    p.cash -= rep
    tr(G, p, 'repay', -rep)
    p.loan -= rep
    if (p.cash < 0) cover(G, p, 'repay')
  }
  // 管理能力を超えた分：学生 → 個人 → 法人 の順に退去し、クレーム費用
  for (const a of P.mgmtByArea ? ['city', 'suburb', 'rural'] : [null]) {
    let over = -mgmtRoom(P, p, a)
    if (over > 0) {
      pay(G, p, over * P.claimCost, 'claim')
      for (const t of ['stud', 'indiv', 'corp']) {
        const out = occ(p, t, a).slice(0, over)
        evict(G, p, out, t)
        over -= out.length
      }
    }
  }
  // 個人：会社ごとにサイコロ1回、出た目の数（または半分）が退去。退去した個人は、そのエリアの市場に戻る
  const d = G.tutorialDie ?? 1 + Math.floor(G.rand() * 6)
  let k = P.indivEvict === 'half' ? Math.floor(d / 2) : d
  const indiv = occ(p, 'indiv').sort((x, y) => y.rent - x.rent).slice(0, k)
  for (const b of p.bldgs) {
    const out = b.rooms.filter((r) => indiv.includes(r))
    if (P.indivReturn) G.returned[b.area] += out.length
  }
  evict(G, p, indiv, 'indiv')
  // 学生：半分（切り上げ）が卒業
  const stud = occ(p, 'stud')
  const grads = stud.slice(0, Math.ceil(stud.length / 2))
  // studGradLeave：卒業した学生は市場に戻らず街を出る（新しい学生は inflowPer で毎期入ってくる。2026-10-08 案）
  const gradBy = {}
  for (const b of p.bldgs) for (const r of b.rooms) if (grads.includes(r)) gradBy[b.area] = (gradBy[b.area] || 0) + 1
  evict(G, p, grads, 'stud')
  if (P.studGradLeave && P.marketMode !== 'cards') for (const [a, k] of Object.entries(gradBy)) G.back[a].stud = Math.max(0, (G.back[a].stud || 0) - k)
  // 法人：期末の退去なし
  // 広告チップ：カードの市場では使っても減らず、期末に2枚以上あれば1枚だけ残る。人駒の市場では期末に1枚返す
  p.ads = P.marketMode === 'cards' ? (p.ads >= 2 ? 1 : 0) : Math.max(0, p.ads - 1)
  // 営業チップ：2枚以上あれば1枚だけ次の期に残る（製造業MGの商品開発チップと同じ）
  p.salesChips = p.salesChips >= 2 ? 1 : 0
  let dep = 0
  for (const l of p.furn) {
    const x = Math.min(P.furnDep, l.book)
    dep += x * l.n
    l.book -= x
  }
  addF(p, 'dep', dep)
  if (p.short > 0 && p.cash > 0) {
    const r = Math.min(p.short, p.cash)
    p.short -= r
    p.cash -= r
  }
  const F = Object.values(p.pl.F).reduce((a, b) => a + b, 0)
  const Gv = p.pl.rev - p.pl.vq - F
  // 税引前 ＝ 経常利益 ＋ 特別利益（受取保険金）
  const pre = Gv + (p.pl.special || 0)
  const total = pre + p.retained
  let tax = pre < 0 || total < 0 ? P.minTax : p.retained < 0 ? Math.round(total * P.taxRate) : Math.round(pre * P.taxRate)
  tax = Math.max(P.minTax, tax)
  p.retained += pre - tax
  p.taxDue = tax
  const bal = p.cash + furnBook(p) - (p.loan + p.short + p.taxDue + equity(p))
  if (Math.abs(bal) > 1e-6) throw new Error(`B/S不一致 p${p.id} 第${G.period}期 ${bal}`)
  const m = p.pl.occRQ > 0 ? (p.pl.rev - p.pl.vq) / p.pl.occRQ : 0
  p.hist.push({
    period: G.period,
    G: Gv,
    special: p.pl.special || 0, // 特別利益（受取保険金）
    PQ: p.pl.rev,
    F,
    Fb: { ...p.pl.F },
    occRate: p.pl.availRQ ? p.pl.occRQ / p.pl.availRQ : 0,
    bepRate: p.pl.availRQ && m > 0 ? F / m / p.pl.availRQ : null,
    bldgs: p.bldgs.length,
    areas: { city: p.bldgs.filter((b) => b.area === 'city').length, suburb: p.bldgs.filter((b) => b.area === 'suburb').length, rural: p.bldgs.filter((b) => b.area === 'rural').length },
    occEnd,
    corpShare: occEnd ? corpN / occEnd : 0,
    mix: { corp: corpN, indiv: occ(p, 'indiv').length, stud: occ(p, 'stud').length },
    contracts: { ...p.pl.contracts },
    equity: equity(p),
    cash: p.cash,
    shortBig: G.log.some((l) => l.p === p.id && l.period === G.period && l.amt >= 30),
    turns: p.turnNo,
  })
}

export function playGame(P, personas, seed) {
  const rand = rng(seed)
  const G = {
    P,
    rand,
    bdeck: makeBdeck(P, rand),
    deck: shuffle(makeDeck(P), rand),
    market: { cards: [], city: {}, suburb: {}, rural: {} },
    carry: {},
    returned: { city: 0, suburb: 0, rural: 0 },
    back: { city: { corp: 0, indiv: 0, stud: 0 }, suburb: { corp: 0, indiv: 0, stud: 0 }, rural: { corp: 0, indiv: 0, stud: 0 } },
    periodMin: P.turnsPerPeriod ? P.periodTotalMin : P.periodMin[personas.length],
    players: personas.map((persona, id) => ({
      id, persona, opening: rand() < 0.5 ? 'focus' : 'spread', period: 1,
      cash: P.capital, capital: P.capital, retained: 0, loan: 0, short: 0, taxDue: 0,
      // tutorialPlan 'v3' では開業時のスタッフは0人（第1期の手番1で雇う）
      sales: P.tutorialPlan === 'v3' ? 0 : 1, salesBy: { suburb: P.tutorialPlan === 'v3' ? 0 : 1, city: 0, rural: 0 }, mgmt: P.tutorialPlan === 'v3' ? 0 : P.initMgmt ?? 1, mgmtBy: { suburb: P.tutorialPlan === 'v3' ? 0 : P.initMgmt ?? 1, city: 0, rural: 0 }, lockBy: {}, ads: 0, salesChips: 0, locks: 0, ins: 0, furn: [], bldgs: [], hist: [], flags: {},
    })),
    log: [],
    auctions: [],
    cancelled: 0,
    clock: 0,
    marketLog: [],
    trace: P.trace ? [] : null,
    debugPicks: P.debug ? [] : null,
    ctx: null,
  }
  // smart：会社ごとに戦い方をランダムに決め、persona は集計用のラベル（STYLE_KEYS）にする
  if (P.bot === 'smart')
    for (const p of G.players) {
      p.strat = sampleStrategy(rand)
      // 棟の上限なし（P.maxBldg が Infinity か99以上）：自動プレイヤーも上限を持たず、広げるかは借りる好み（leaseW）で分ける
      if (!Number.isFinite(P.maxBldg) || P.maxBldg >= 99) {
        p.strat.maxBldg = Infinity
        p.strat.style = (p.strat.leaseW >= 1 ? 'wide' : 'narrow') + (p.strat.disc >= 3 ? 'Low' : 'High')
      }
      p.persona = p.strat.style
      p.bidStat = {}
      p.adapt = {}
    }
  for (let per = 1; per <= P.periods; per++) {
    G.period = per
    for (const p of G.players) {
      p.period = per
      periodStart(G, p)
    }
    refillMarket(G)
    G.noStud = false
    G.clock = 0
    if (per === 1 && P.tutorial) {
      runTutorial(G)
    } else {
      const first = (per - 1) % G.players.length
      for (let guard = 0; guard < 100; guard++) {
        for (let k = 0; k < G.players.length; k++) {
          const before = G.auctions.length
          turn(G, G.players[(first + k) % G.players.length])
          if (P.turnsPerPeriod) {
            // 本番のMGの手番の数に合わせる：1手番の平均 ＝ 1期の時間 ÷（人数 × 手番の目安）。±50%でばらつく
            const t = P.turnsPerPeriod[per] ?? P.turnsPerPeriod.default
            G.clock += (G.periodMin / (G.players.length * t)) * (0.5 + G.rand())
          } else G.clock += P.turnMin[0] + G.rand() * (P.turnMin[1] - P.turnMin[0]) + (G.auctions.length > before ? P.auctionMin : 0)
        }
        if (G.clock >= G.periodMin) break
      }
    }
    for (const p of G.players) periodEnd(G, p)
    G.tutorialDie = null
  }
  return G
}
