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
  const risk = [['defect', 1], ['corpCancel', P.corpCancelCards], ['pandemic', 1], ['lawsuit', 1], ['leak', 2], ['arrears', 1], ['noise', 1], ['competitor', 1]]
  const chance = [['rush', 2], ['foreign', 2], ['factory', 1], ['pricing', 1]]
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
function newBldg(P, c) {
  const a = P.areas[c.area]
  const d = c.old ? P.oldDelta : 0
  return { area: c.area, old: c.old, own: a.own + d, mkt: a.mkt + d, reno: false, rooms: Array.from({ length: P.rooms }, () => ({ st: 'none', type: null, rent: 0 })) }
}

// ---- 集計 ----
const occ = (p, t, area) => p.bldgs.flatMap((b) => (area && b.area !== area ? [] : b.rooms.filter((r) => r.st === 'occ' && (!t || r.type === t))))
const vac = (p, area) => p.bldgs.reduce((s, b) => s + (area && b.area !== area ? 0 : b.rooms.filter((r) => r.st === 'vac').length), 0)
const unfurn = (p) => p.bldgs.reduce((s, b) => s + b.rooms.filter((r) => r.st === 'none').length, 0)
const leaseCap = (P, p) => p.sales * P.leasePerSales
const indivCap = (P, p) => leaseCap(P, p) + Math.min(p.ads, p.sales * P.adPerSales) * P.adRooms
const mgmtCap = (P, p) => p.mgmt * P.mgmtRooms + p.locks * P.lockRooms
const mktOf = (P, p, b) => b.mkt - (p.flags.competitor && b.area === 'city' ? 3 : 0)
const equity = (p) => p.capital + p.retained
const loanRoom = (P, p) => (p.period < P.loanFrom ? 0 : Math.max(0, Math.round(equity(p) * P.loanMult) - p.loan))
const furnBook = (p) => p.furn.reduce((s, l) => s + l.n * l.book, 0)
const ps = (p) => PERSONAS[p.persona]

// ---- お金 ----
function addF(p, k, v) {
  p.pl.F[k] = (p.pl.F[k] || 0) + v
}
function pay(G, p, v, k, cost = true) {
  if (v <= 0) return
  p.cash -= v
  if (cost) addF(p, k, v)
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
    G.log.push({ t: 'short', p: p.id, period: G.period, amt: s, why })
  }
}
function borrow(G, p, a) {
  if (a <= 0) return
  p.loan += a
  p.cash += a
  const i = Math.round(a * G.P.loanRate)
  p.cash -= i
  addF(p, 'interest', i)
}
function accrue(G, p) {
  const t = Math.min(G.clock, G.periodMin)
  const dt = t - p.lastT
  if (dt <= 0) return
  const f = dt / G.periodMin
  p.pend.rent += occ(p).reduce((s, r) => s + r.rent, 0) * f
  p.pend.own += p.bldgs.reduce((s, b) => s + b.own * b.rooms.length, 0) * f
  p.pl.occRQ += occ(p).length * f
  p.pl.availRQ += p.bldgs.length * G.P.rooms * f
  p.lastT = t
}
function collect(G, p) {
  accrue(G, p)
  p.cash += p.pend.rent
  p.pl.rev += p.pend.rent
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
    Object.assign(r, { st: 'occ', type, rent: rentOf(b) + (b.reno ? P.renoRent : 0) })
    got++
  }
  if (got) {
    pay(G, p, got * P.V[type], 'V', false)
    p.pl.vq += got * P.V[type]
    p.pl.contracts[type] += got
  }
  return got
}
function evict(G, p, rooms, type) {
  accrue(G, p)
  // ためておく市場では、退去した人はその棟のエリアの市場に戻る（次の期首に並ぶ）
  if (G.P.supplyMode === 'stock')
    for (const b of p.bldgs) for (const r of b.rooms) if (rooms.includes(r)) G.back[b.area][type] = (G.back[b.area][type] || 0) + 1
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
  for (const q of G.players) if (q !== parent && vac(q, area) > 0 && ps(q).prefer.includes(type) && !(type === 'indiv' && q.flags.noIndiv) && G.rand() < 0.9) bidders.push(q)
  const bids = bidders.map((q) => {
    const open = q.bldgs.filter((b) => b.area === area && b.rooms.some((r) => r.st === 'vac'))
    const cap = Math.max(...open.map((b) => mktOf(P, q, b))) + P.bidCap[type]
    const s = ps(q)
    const total = occ(q).length + vac(q)
    const pressure = total ? Math.round((vac(q) / total) * 4) : 0
    const corpExtra = type === 'corp' ? 2 : 0 // 法人は一度入れば出ていかないので、少し安くしてでも取りにいく
    // 参加する会社は入札の前に名乗り出るので、自分しかいなければ相場いっぱいで出す。相手がいるときだけ値引きする（2026-10-07）
    const price = bidders.length === 1 ? cap : Math.max(P.priceFloor[type], Math.min(cap, cap - s.bidDisc - pressure - corpExtra - Math.max(0, bidders.length - 2) - Math.floor(G.rand() * 3)))
    // 営業チップ1枚ごとに2低くコールしたものとして比べる（製造業MGと同じ）
    const eff = price - q.salesChips * P.salesChipBid
    const offer = Math.min(type === 'indiv' ? indivCap(P, q) : leaseCap(P, q), vac(q, area))
    return { q, price, eff, offer, tie: G.rand() }
  })
  bids.sort((x, y) => x.eff - y.eff || Number(y.q === parent) - Number(x.q === parent) || x.tie - y.tie)
  let left = Math.min(seats, G.market[area][type])
  for (const bd of bids) {
    if (left <= 0) break
    const n = Math.min(left, bd.offer)
    if (n <= 0) continue
    let cut = 0
    if (type === 'corp' && P.corpDice) cut = Math.max(0, 1 + Math.floor(G.rand() * 6) - bd.q.salesChips)
    const got = fill(G, bd.q, area, type, n, () => Math.max(1, bd.price - cut))
    left -= got
    G.market[area][type] -= got
    if (type === 'stud' && got > 0 && P.studBonus) fill(G, bd.q, area, 'stud', P.studBonus, () => bd.price) // ストッカーから＋1人
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
  leak(G, p) {
    if (p.ins > 0) return void p.ins--
    const b = p.bldgs[Math.floor(G.rand() * p.bldgs.length)]
    pay(G, p, G.P.repairCost * (b.old ? 2 : 1), 'repair')
  },
  arrears(G, p) {
    const r = occ(p, 'indiv')[0]
    if (r) pay(G, p, r.rent, 'arrears')
  },
  noise(G, p) {
    if (occ(p).length > mgmtCap(G.P, p)) evict(G, p, occ(p, 'indiv').slice(0, 1), 'indiv')
  },
  competitor(G, p) {
    p.flags.competitor = true
  },
  rush(G) {
    G.market.city.indiv += 3
    G.market.suburb.indiv += 3
  },
  foreign(G, p) {
    const a = p.bldgs.length ? p.bldgs[0].area : 'suburb'
    G.market[a].corp += 3
  },
  factory(G) {
    G.market.rural.corp += 4
  },
  pricing(G, p) {
    for (const b of p.bldgs) if (b.reno) for (const r of b.rooms) if (r.st === 'occ') r.rent += 2
  },
}

// ---- 自動プレイヤーの判断 ----
function endCost(G, p) {
  const P = G.P
  const left = Math.max(0, (G.periodMin - Math.min(G.clock, G.periodMin)) / G.periodMin)
  return p.bldgs.reduce((s, b) => s + b.own * b.rooms.length, 0) * left + p.pend.own + (p.sales + p.mgmt) * P.salary[G.period - 1] + P.hq + Math.round(p.loan * P.repayRate) + p.short + 15
}
function outlook(G, p) {
  const left = Math.max(0, (G.periodMin - Math.min(G.clock, G.periodMin)) / G.periodMin)
  return p.cash - endCost(G, p) + occ(p).reduce((s, r) => s + r.rent, 0) * left + p.pend.rent + vac(p) * 20 * left * (G.period >= G.P.loanFrom ? 0.6 : 0.3)
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
  p.bldgs.push(newBldg(G.P, c))
  if (nf > 0) buyFurn(G, p, nf)
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
      const n = Math.min(t === 'indiv' ? indivCap(P, p) : leaseCap(P, p), v, avail)
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
  const lc = leaseCap(P, p)
  if (v >= lc * 3 && p.sales < P.staffMax && canSpend(G, p, P.hireCost + 30)) return hire(G, p, 'sales')
  if (v > 0) {
    const c = pickContract(G, p)
    if (c) return auction(G, p, c.a, c.t, c.n)
  }
  if (unfurn(p) > 0) {
    const n = Math.min(unfurn(p), P.furnMax, Math.floor((p.cash - s.buffer / 2) / P.furnPrice))
    if (n > 0 && buyFurn(G, p, n)) return
  }
  if (occ(p).length + vac(p) > mgmtCap(P, p) - 2) {
    if (s.lock && p.locks < P.lockMax && canSpend(G, p, P.lockPrice)) return buy(G, p, 'locks', P.lockPrice, 'lock')
    if (p.mgmt < P.staffMax && canSpend(G, p, P.hireCost + 30)) return hire(G, p, 'mgmt')
  }
  if (wantExpand(G, p)) {
    const i = G.market.cards.map((c, k) => [cardScore(G, c), k]).sort((x, y) => y[0] - x[0])[0][1]
    const c = G.market.cards[i]
    const own = (P.areas[c.area].own + (c.old ? P.oldDelta : 0)) * P.rooms
    const left = (G.periodMin - Math.min(G.clock, G.periodMin)) / G.periodMin
    if (p.cash >= 50 && outlook(G, p) - own * left - 96 + own * left * 1.3 >= s.buffer) return lease(G, p, i, Math.min(8, Math.floor((p.cash - s.buffer) / P.furnPrice)))
  }
  if (v >= lc * 2 && p.sales < P.staffMax && canSpend(G, p, P.hireCost + 30)) return hire(G, p, 'sales')
  if (v > lc && p.ads < p.sales * P.adPerSales && canSpend(G, p, P.adPrice)) return buy(G, p, 'ads', P.adPrice, 'ads')
  if (p.salesChips < Math.min(s.salesChips, P.salesChipMax) && canSpend(G, p, P.salesChipPrice)) return buy(G, p, 'salesChips', P.salesChipPrice, 'salesChip')
  if (s.reno) {
    const b = [...p.bldgs].filter((x) => !x.reno).sort((x, y) => occ({ bldgs: [y] }).length - occ({ bldgs: [x] }).length)[0]
    if (b && canSpend(G, p, P.renoPrice)) {
      pay(G, p, P.renoPrice, 'reno')
      accrue(G, p)
      b.reno = true
      for (const r of b.rooms) if (r.st === 'occ') r.rent += P.renoRent // 入居中の部屋にも効く
      return
    }
  }
}
function hire(G, p, kind) {
  pay(G, p, G.P.hireCost, 'hire')
  p[kind]++
}
function buy(G, p, k, price, fk) {
  pay(G, p, price, fk)
  p[k]++
}

// ---- 第1期の台本（全員同じ。2026-10-07 の v2 版） ----
function runTutorial(G) {
  const P = G.P
  const steps = [
    [0.05, (p) => { accrue(G, p); p.bldgs.push(newBldg(P, { area: 'suburb', old: false })); buyFurn(G, p, 8) }],
    [0.12, (p) => { fill(G, p, 'suburb', 'stud', 2, () => 40); fill(G, p, 'suburb', 'stud', P.studBonus, () => 40) }],
    [0.2, (p) => { fill(G, p, 'suburb', 'corp', 2, () => 44 - (P.corpDice ? 2 : 0)) }],
    [0.3, (p) => { fill(G, p, 'suburb', 'indiv', 2, () => 43) }],
    [0.4, (p) => EV.leak(G, p)],
    [0.5, (p) => { pay(G, p, P.insPrice, 'insurance'); p.ins++ }],
    [0.6, () => {}],
    [0.7, (p) => { fill(G, p, 'suburb', 'corp', 1, () => 44 - (P.corpDice ? 5 : 0)) }],
    [0.8, (p) => hire(G, p, 'sales')],
    [0.9, () => {}],
  ]
  for (const [at, f] of steps) {
    G.clock = at * G.periodMin
    for (const p of G.players) {
      collect(G, p)
      f(p)
      p.turnNo++
    }
  }
  G.clock = G.periodMin
  G.tutorialDie = 1 // 期末の個人の退去のサイコロ：講師の目（全員共通）
}

// ---- 期の進行 ----
function refillMarket(G) {
  const P = G.P
  const n = G.players.length
  if (P.supplyMode === 'stock') {
    // ためておく市場：最初の1回（第2期の期首。第1期は台本なので市場を使わない）だけ置き、あとは戻りとカードでだけ増減する
    if (G.period === (P.tutorial ? 2 : 1))
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
  if (p.taxDue) {
    p.cash -= p.taxDue
    p.taxDue = 0
    if (p.cash < 0) cover(G, p, 'tax')
  }
  if (p.loan) pay(G, p, Math.round(p.loan * P.loanRate), 'interest')
  if (p.short) pay(G, p, Math.round(p.short * P.shortRate), 'shortInterest')
}
function turn(G, p) {
  collect(G, p)
  preTurn(G, p)
  if (!G.deck.length) G.deck = shuffle(makeDeck(G.P), G.rand)
  const c = G.deck.pop()
  if (c.kind === 'decision') decide(G, p)
  else if (p.bldgs.length) EV[c.key](G, p)
  p.turnNo++
  if (p.flags.noIndiv && p.flags.noIndiv++ > 1) p.flags.noIndiv = 0
}
function periodEnd(G, p) {
  const P = G.P
  collect(G, p)
  const occEnd = occ(p).length
  const corpN = occ(p, 'corp').length
  pay(G, p, (p.sales + p.mgmt) * P.salary[G.period - 1], 'salary')
  pay(G, p, P.hq, 'hq')
  const rep = Math.round(p.loan * P.repayRate)
  if (rep) {
    p.cash -= rep
    p.loan -= rep
    if (p.cash < 0) cover(G, p, 'repay')
  }
  // 管理能力を超えた分：学生 → 個人 → 法人 の順に退去し、クレーム費用
  let over = occ(p).length - mgmtCap(P, p)
  if (over > 0) {
    pay(G, p, over * P.claimCost, 'claim')
    for (const t of ['stud', 'indiv', 'corp']) {
      const out = occ(p, t).slice(0, over)
      evict(G, p, out, t)
      over -= out.length
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
  evict(G, p, stud.slice(0, Math.ceil(stud.length / 2)), 'stud')
  // 法人：期末の退去なし
  p.ads = Math.max(0, p.ads - 1)
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
  const total = Gv + p.retained
  let tax = Gv < 0 || total < 0 ? P.minTax : p.retained < 0 ? Math.round(total * P.taxRate) : Math.round(Gv * P.taxRate)
  tax = Math.max(P.minTax, tax)
  p.retained += Gv - tax
  p.taxDue = tax
  const bal = p.cash + furnBook(p) - (p.loan + p.short + p.taxDue + equity(p))
  if (Math.abs(bal) > 1e-6) throw new Error(`B/S不一致 p${p.id} 第${G.period}期 ${bal}`)
  const m = p.pl.occRQ > 0 ? (p.pl.rev - p.pl.vq) / p.pl.occRQ : 0
  p.hist.push({
    period: G.period,
    G: Gv,
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
    returned: { city: 0, suburb: 0, rural: 0 },
    back: { city: { corp: 0, indiv: 0, stud: 0 }, suburb: { corp: 0, indiv: 0, stud: 0 }, rural: { corp: 0, indiv: 0, stud: 0 } },
    periodMin: P.turnsPerPeriod ? P.periodTotalMin : P.periodMin[personas.length],
    players: personas.map((persona, id) => ({
      id, persona, opening: rand() < 0.5 ? 'focus' : 'spread', period: 1,
      cash: P.capital, capital: P.capital, retained: 0, loan: 0, short: 0, taxDue: 0,
      sales: 1, mgmt: 1, ads: 0, salesChips: 0, locks: 0, ins: 0, furn: [], bldgs: [], hist: [], flags: {},
    })),
    log: [],
    auctions: [],
    cancelled: 0,
    clock: 0,
    marketLog: [],
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
