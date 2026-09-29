// 戦略MG 計算エンジン（純関数）。仕様は docs/calc-spec.md が正で、このファイルがその実装。
// 数値は test/golden.json（期待値スナップショット）と厳密一致することを golden-master テスト（test/calc.test.ts）で検証する。
// （元は単一HTMLのプロトタイプ mock/index.html から移植したもの。mock は 2026-09 に削除済み）

import { normalizeRules, type Rules } from './rules.ts'

export type { Rules } from './rules.ts'
export { DEFAULT_RULES } from './rules.ts'

export type Fvals = Record<string, any>

export interface TxRow {
  id: number
  key?: string
  fvals?: Fvals
  label?: string
  col: number | null
  amount: number
  noCash?: boolean
  note?: string
  isCapital?: boolean
  isClosing?: boolean
  isOpeningTax?: boolean
  isOpeningInterest?: boolean
  isBorrowInterest?: boolean
  isAutoRepay?: boolean
  linkedTo?: number
}

/** 什器1台の記録。period は購入した期（0 ＝ 記録のない古いデータや講師が盤面で足した台：「前期以前に購入」）。book は現在の簿価 */
export interface MachineLot {
  period: number
  book: number
}

export interface St {
  name: string
  president: string
  org: string
  period: number
  openingCash: number
  openingCapital: number
  retained: number
  openingMatQty: number
  openingMatVal: number
  openingProducts: number
  openingEquipVal: number
  openingMachines: number
  /** 期首の什器・1台ずつ（購入した期と簿価）。無い／合計と合わないときは平均で按分する（openingLotsOf） */
  openingLots: MachineLot[]
  openingStaffMfg: number
  openingStaffSales: number
  openingLoan: number
  openingDev: number
  openingAds: number
  matQty: number
  matVal: number
  rawCubes: number
  products: number
  machines: number
  equipVal: number
  /** 盤面の什器・1台ずつ。machines＝件数、equipVal＝簿価の合計 と常に一致させる（recompute で作り直す） */
  lots: MachineLot[]
  staffMfg: number
  staffSales: number
  ads: number
  dev: number
  insurance: number
  edu: number
  loan: number
  salesQty: number
  salesAmt: number
  scrapQty: number
  equipSold: number // 今期に売却した什器の簿価の合計（特別損失に回す。recompute で作り直す）
  loanMult: number
  repayRate: number
  tx: TxRow[]
  seq: number
  settled: boolean
  closingPrep: boolean
  started: boolean
  result: Result | null
}

export interface Result {
  period: number
  PQ: number
  vPQ: number
  mPQ: number
  F: number
  G: number
  tax: number
  net: number
  dep: number
  salary: number
  avg: number
  rent: number
  special: number
  pretax: number
  total4: number
  Q: number
  laborF: number
  sellF: number
  adminF: number
  depF: number
  cashEnd: number
  endInvQty: number
  endInvVal: number
  equipEnd: number
  loanEnd: number
  capEnd: number
  retEnd: number
  assets: number
  liabEq: number
  diff: number
  ret0: number
  cashFlow: number
  openCash: number
  eq0: number
  loan0: number
  salesQty: number
  machines: number
  staffMfg: number
  staffSales: number
  inSum: number
  outSum: number
  openMatQty: number
  openMatVal: number
  matBoughtQty: number
  matBoughtVal: number
  totMatQty: number
  totMatVal: number
  scrap: number
  boardInvQty: number
  diffQty: number
  rawEnd: number
  prodEnd: number
  dev: number
  ads: number
  turns: number
  decisions: number
  equipTotal: number
  equipBought: number
  equipSold: number // 売却で盤面から外した什器の簿価（特別損失）
  equipSaleCash: number // 什器売却の売却代金（A列のうち保険金ではない分。投資CFに出す）
  lotsEnd?: MachineLot[] // 期末の什器・1台ずつ（減価償却後）。次期の openingLots になる。古い決算結果には無い
  loanBorrow: number
  loanRepay: number
  name: string
  president: string
  colTot: number[]
  rows: TxRow[]
  capStart: number
  loanMult: number
  repayRate: number
  openInterest: number
}

// ---- 数値ルール ----
// 研修回ごとに差し替えられる数値は rules.ts に集約してある。
// 参照は必ず getRules() 経由で行い、モジュールスコープに値を退避しないこと
// （setRules() で差し替えた後も古い値を掴み続けてしまうため）。
let RULES: Rules = normalizeRules(null)

/** いま有効な数値ルール */
export const getRules = (): Rules => RULES

/** 数値ルールを差し替える。null/未指定で既定ルールに戻す。 */
export function setRules(next?: Partial<Rules> | null): Rules {
  RULES = normalizeRules(next)
  return RULES
}

// ---- 定数（列と勘定科目の対応。ルールでは変更しない） ----
export const COLS = 11
export const IN_COLS = [0, 1, 2, 3]
export const COL_LABELS = [
  'ア 資本金',
  'イ 借入金',
  'ウ 売上',
  'A 保険金・その他', // 受取保険金と什器売却の代金（どちらも特別損益に流れる入金）
  'エ 什器',
  'オ 材料仕入',
  'カ 人件費',
  'キ 販売費',
  'ク 管理費',
  'ケ 借入金返済',
  'コ 納税',
]

const r = Math.round
const rows = (f?: Fvals): Fvals[] =>
  f && f.items && f.items.length ? f.items : [{ qty: f?.qty, unit: f?.unit }]

// ---- アクション定義 ----
export interface ActionDef {
  label: string
  rule: 'A' | 'B' | 'X'
  cat?: string
  col: number | null
  side?: 'in' | 'out' | null
  multi?: boolean
  noCash?: boolean
  custom?: boolean
  fixed?: boolean
  account: string
  amount: (f: Fvals) => number
  /**
   * 盤面に依存する金額（什器売却の「簿価の半値」など）。あれば記帳時と recompute の再生時に
   * こちらで行の金額を決め直す。前の行の削除・編集で簿価が変わっても、行の金額が盤面に追従する。
   */
  amountOf?: (st: St, f: Fvals) => number
  apply?: (st: St, f: Fvals) => void
}

/**
 * 合計簿価 total を n 台に按分した什器のリストを作る（端数は先頭から1ずつ）。
 * 1台ずつの記録が無いときの受け皿。購入期は簿価から逆算し（inferLotPeriod）、逆算できない台は 0（購入期不明）。
 */
export function splitLots(n: number, total: number, period = 0): MachineLot[] {
  if (n <= 0) return []
  const base = Math.floor(total / n)
  let rest = total - base * n
  return Array.from({ length: n }, () => {
    const book = base + (rest-- > 0 ? 1 : 0)
    return { period: inferLotPeriod(book, period), book }
  })
}

/**
 * 簿価から購入した期を逆算する（簿価 ＝ 購入価格 − 減価償却 × 経過期数）。
 * `period` は今の期（期首）。割り切れない・第1期より前になる・購入価格より大きい ときは 0（購入期不明）。
 */
export function inferLotPeriod(book: number, period: number): number {
  const { machinePrice, depPerMachine } = getRules()
  if (!(depPerMachine > 0) || period < 1) return 0
  const k = (machinePrice - book) / depPerMachine // 経過期数
  if (!Number.isInteger(k) || k < 0 || period - k < 1) return 0
  return period - k
}

/**
 * 期首の1台ずつの記録が無い古いデータ用：過去の決算結果から什器の購入期を復元する。
 * 各期の什器購入額（エ）÷ 購入価格 ＝ その期に買った台数、として積み、期末に減価償却を引く
 * （売却が無かった頃のデータなので購入と減価償却だけで組み立てられる。lotsEnd を持つ期はそれを使う）。
 * 講師が盤面の台数を直接変えた等で台数・期末簿価が合わない期は、台数を合わせて差額を先頭から1ずつ吸収する。
 * `upTo` 期の期首まで（`upTo` 期自身の決算は含めない）。
 */
export function lotsFromHistory(results: Result[], upTo: number): MachineLot[] {
  const { machinePrice, depPerMachine } = getRules()
  let lots: MachineLot[] = []
  for (const res of [...results].sort((a, b) => a.period - b.period)) {
    if (res.period >= upTo) break
    if (res.lotsEnd && res.lotsEnd.length === res.machines) {
      lots = res.lotsEnd.map((l) => ({ ...l }))
      continue
    }
    const bought = machinePrice > 0 ? Math.max(0, Math.round((res.equipBought || 0) / machinePrice)) : 0
    for (let i = 0; i < bought; i++) lots.push({ period: res.period, book: machinePrice })
    while (lots.length > (res.machines || 0)) lots.pop() // 減らすなら新しい台から
    while (lots.length < (res.machines || 0)) lots.push({ period: res.period, book: machinePrice })
    lots = lots.map((l) => ({ ...l, book: l.book - depPerMachine }))
    let diff = (res.equipEnd || 0) - lots.reduce((a, l) => a + l.book, 0)
    for (let i = 0; diff !== 0 && lots.length; i = (i + 1) % lots.length) {
      const d = Math.sign(diff)
      lots[i].book += d
      diff -= d
    }
  }
  return lots
}

/**
 * 期首の什器を1台ずつにしたもの。openingLots が台数・合計簿価と合っていればそれを使い、
 * 無い（古いデータ）か合わない（講師が盤面の台数を直接変えた等）ときは合計を台数で按分し、購入期を簿価から逆算する。
 */
export function openingLotsOf(st: St): MachineLot[] {
  const lots = st.openingLots || []
  const sum = lots.reduce((a, l) => a + l.book, 0)
  if (lots.length === st.openingMachines && sum === st.openingEquipVal) return lots.map((l) => ({ ...l }))
  return splitLots(st.openingMachines, st.openingEquipVal, st.period)
}

/** 売却の選択肢：1台ずつ（購入した期の古い順）。同じ期に複数台あれば seq（何台目か）で区別し、count はその期の台数 */
export function machineOptions(st: St): { period: number; book: number; seq: number; count: number }[] {
  const counts = new Map<number, number>()
  for (const l of st.lots) counts.set(l.period, (counts.get(l.period) || 0) + 1)
  const seen = new Map<number, number>()
  return [...st.lots]
    .map((l, i) => ({ ...l, i }))
    .sort((a, b) => a.period - b.period || a.i - b.i)
    .map((l) => {
      const seq = (seen.get(l.period) || 0) + 1
      seen.set(l.period, seq)
      return { period: l.period, book: l.book, seq, count: counts.get(l.period)! }
    })
}

/** 「第N期に購入」の表示。0 は購入期を決められない台 */
export const lotLabel = (period: number): string => (period > 0 ? `第${period}期に購入` : '購入期不明')

/** プルダウンの1行分の表示。同じ期に複数台あれば「1台目」「2台目」を付ける */
export const lotOptionLabel = (o: { period: number; book: number; seq: number; count: number }): string =>
  `${lotLabel(o.period)}${o.count > 1 ? ` ${o.seq}台目` : ''}（簿価 ${o.book}）`

/** 売却する什器の指定「期:何台目」（例 "3:2"）。古い記帳の {period} だけの形も読む */
export const lotKey = (period: number, seq = 1): string => `${period}:${seq}`
export function parseLotKey(f: Fvals): { period: number; seq: number } | null {
  if (typeof f.lot === 'string' && /^\d+:\d+$/.test(f.lot)) {
    const [p, q] = f.lot.split(':').map(Number)
    return { period: p, seq: q }
  }
  if (Number.isInteger(f.period) && f.period >= 0) return { period: f.period, seq: 1 }
  return null
}

/**
 * 什器売却：指定した什器（購入した期の何台目か）1台の「盤面から外す簿価」と「売却代金（簿価の半値）」。
 * その什器が残っていなければ売れない（idx = -1・0円）。
 */
export function equipSale(st: St, f: Fvals): { idx: number; period: number; book: number; price: number } {
  const sel = parseLotKey(f)
  if (!sel) return { idx: -1, period: 0, book: 0, price: 0 }
  let n = 0
  const idx = st.lots.findIndex((l) => l.period === sel.period && ++n === sel.seq)
  if (idx < 0) return { idx, period: sel.period, book: 0, price: 0 }
  const book = st.lots[idx].book
  return { idx, period: sel.period, book, price: r(book / 2) }
}

export const ACTIONS: Record<string, ActionDef> = {
  // --- ルールA ---
  shiire: {
    label: '仕入れ',
    rule: 'A',
    col: 5,
    side: 'out',
    multi: true,
    account: '材料仕入',
    amount: (f) => rows(f).reduce((s, x) => s + (x.qty || 0) * (x.unit || 0), 0),
    apply: (st, f) =>
      rows(f).forEach((x) => {
        st.rawCubes += x.qty || 0
        st.matQty += x.qty || 0
        st.matVal += (x.qty || 0) * (x.unit || 0)
      }),
  },
  seizo: {
    label: '製造',
    rule: 'A',
    col: null,
    side: null,
    noCash: true,
    account: '金額',
    amount: () => 0,
    apply: (st, f) => {
      const n = Math.min(f.qty || 0, st.rawCubes)
      st.rawCubes -= n
      st.products += n
    },
  },
  hanbai: {
    label: '販売',
    rule: 'A',
    col: 2,
    side: 'in',
    multi: true,
    account: '売上',
    amount: (f) => rows(f).reduce((s, x) => s + (x.qty || 0) * (x.unit || 0), 0),
    apply: (st, f) =>
      rows(f).forEach((x) => {
        // 盤面に無い製品は売れない：会計側（salesQty/salesAmt）も実売数でカウントする。
        // 入力数のまま加算すると、行の削除・編集後などに期末在庫がマイナスになりB/Sが壊れる
        const n = Math.min(x.qty || 0, st.products)
        st.products -= n
        st.salesQty += n
        st.salesAmt += n * (x.unit || 0)
      }),
  },
  kikai: {
    label: '機械購入',
    rule: 'A',
    col: 4,
    side: 'out',
     account: '什器',
    amount: (f) => (f.n || 0) * getRules().machinePrice,
    apply: (st, f) => {
      st.machines += f.n || 0
      st.equipVal += (f.n || 0) * getRules().machinePrice
      // 1台ずつの記録（購入した期・簿価）。什器売却で「いつ買った機械か」を選ぶのに使う
      for (let i = 0; i < (f.n || 0); i++) st.lots.push({ period: st.period, book: getRules().machinePrice })
    },
  },
  saiyo: {
    label: 'スタッフ採用',
    rule: 'A',
    col: 6,
    side: 'out',
     account: '人件費',
    amount: (f) => ((f.mfg || 0) + (f.sales || 0) + (f.fail || 0)) * 5,
    apply: (st, f) => {
      st.staffMfg += f.mfg || 0
      st.staffSales += f.sales || 0
    },
  },
  koukoku: {
    label: '広告',
    rule: 'A',
    col: 7,
    side: 'out',
    account: '販売費',
    amount: (f) => (f.n || 0) * 10,
    apply: (st, f) => {
      st.ads += f.n || 0
    },
  },
  kaihatsu: {
    label: '商品開発',
    rule: 'A',
    col: 7,
    side: 'out',
    account: '販売費',
    amount: (f) => (f.n || 0) * 20,
    apply: (st, f) => {
      if (f.result !== '失敗') st.dev += f.n || 0
    },
  },
  // --- ルールB ---
  hoken: {
    label: '保険加入',
    rule: 'B',
    col: 8,
    side: 'out',
    account: '管理費',
    amount: (f) => (f.n || 0) * 5,
    apply: (st, f) => {
      st.insurance += f.n || 0
    },
  },
  kyoiku: {
    label: '教育',
    rule: 'B',
    col: 8,
    side: 'out',
    account: '管理費',
    amount: (f) => (f.n || 0) * 20,
    apply: (st, f) => {
      st.edu += f.n || 0
    },
  },
  haichi: {
    label: '配置転換',
    rule: 'B',
    col: 8,
    side: 'out',
    account: '管理費',
    amount: (f) => (f.n || 0) * 5,
    apply: (st, f) => {
      const n = f.n || 0
      if (f.dir === 'sales->mfg') {
        const m = Math.min(n, st.staffSales)
        st.staffSales -= m
        st.staffMfg += m
      } else {
        const m = Math.min(n, st.staffMfg)
        st.staffMfg -= m
        st.staffSales += m
      }
    },
  },
  kariire: {
    label: '借入',
    rule: 'B',
    col: 1,
    side: 'in',
    account: '借入金',
    amount: (f) => f.a || 0,
    apply: (st, f) => {
      st.loan += f.a || 0
    },
  },
  hensai: {
    label: '借入返済',
    rule: 'B',
    col: 9,
    side: 'out',
    account: '返済',
    amount: (f) => f.a || 0,
    apply: (st, f) => {
      st.loan = Math.max(0, st.loan - (f.a || 0))
    },
  },
  baikyaku: {
    // 「いつ買った機械か」（fvals.period）を選んで1台、簿価の半値で売る。代金は入金の A 列
    // （保険金と同じ特別損益の列）に入れ、外した簿価は equipSold に積んで決算で特別損失にする（差額＝売却損）。
    label: '什器売却',
    rule: 'B',
    col: 3,
    side: 'in',
    account: '什器売却',
    amount: (f) => f.price || 0, // 記帳時に amountOf で決めた売却代金（fvals.price）
    amountOf: (st, f) => {
      const { book, price } = equipSale(st, f)
      f.price = price
      f.book = book
      return price
    },
    apply: (st, f) => {
      const { idx, book } = equipSale(st, f)
      if (idx < 0) return // その什器が残っていない（前の行の変更）。再検証でエラーになる
      st.lots.splice(idx, 1)
      st.machines -= 1
      st.equipVal -= book
      st.equipSold += book
    },
  },
  // --- イベント（rule X）---
  kaihatsu_win: {
    label: '商品開発成功!',
    rule: 'X',
    cat: '販売機会',
    col: 2,
    side: 'in',
    account: '売上',
    amount: (f) => (f.qty || 0) * 32,
    apply: (st, f) => {
      const n = Math.min(f.qty || 0, st.products)
      st.products -= n
      st.salesQty += n
      st.salesAmt += n * 32
    },
  },
  // 独占販売：販売と同じく複数行（個数×売価）を1回で記帳できる（issue #83）。
  // 以前の1組の形（fvals に qty・unit を直接持つ）も rows() が1行として読むので、保存済みの行の結果は変わらない
  dokusen: {
    label: '独占販売!',
    rule: 'X',
    cat: '販売機会',
    col: 2,
    side: 'in',
    multi: true,
    account: '売上',
    amount: (f) => rows(f).reduce((s, x) => s + (x.qty || 0) * (x.unit || 0), 0),
    apply: (st, f) =>
      rows(f).forEach((x) => {
        // 販売と同じく、盤面に無い製品は売れない（会計側も実売数でカウントする）
        const n = Math.min(x.qty || 0, st.products)
        st.products -= n
        st.salesQty += n
        st.salesAmt += n * (x.unit || 0)
      }),
  },
  tokubai: {
    label: '特別サービス!',
    rule: 'X',
    cat: '仕入機会',
    col: 5,
    side: 'out',
    account: '材料仕入',
    amount: (f) => (f.qty || 0) * 10,
    apply: (st, f) => {
      st.rawCubes += f.qty || 0
      st.matQty += f.qty || 0
      st.matVal += (f.qty || 0) * 10
    },
  },
  keiki: {
    label: '景気上昇',
    rule: 'X',
    cat: '仕入機会',
    col: 5,
    side: 'out',
    account: '材料仕入',
    amount: (f) => (f.qty || 0) * 12,
    apply: (st, f) => {
      st.rawCubes += f.qty || 0
      st.matQty += f.qty || 0
      st.matVal += (f.qty || 0) * 12
    },
  },
  ibutsu: {
    label: '異物混入',
    rule: 'X',
    cat: '在庫被害',
    col: 3,
    side: 'in',
    custom: true,
    account: '保険金',
    amount: (f) => f.payout || 0,
    apply: (st, f) => {
      const d = Math.min(f.discard || 0, st.products)
      st.products -= d
      st.scrapQty += d
      if (f.insuredUsed) st.insurance = Math.max(0, st.insurance - f.insuredUsed)
    },
  },
  suigai: {
    label: '水害発生',
    rule: 'X',
    cat: '在庫被害',
    col: 3,
    side: 'in',
    custom: true,
    account: '保険金',
    amount: (f) => f.payout || 0,
    apply: (st, f) => {
      const d = Math.min(f.discard || 0, st.rawCubes)
      st.rawCubes -= d
      st.scrapQty += d
      if (f.insuredUsed) st.insurance = Math.max(0, st.insurance - f.insuredUsed)
    },
  },
  taishoku_mfg: {
    label: '製造スタッフ退職',
    rule: 'X',
    cat: '退職',
    col: 6,
    side: 'out',
    account: '人件費',
    amount: () => 5,
    apply: (st) => {
      if (st.staffMfg > 0) st.staffMfg--
    },
  },
  taishoku_sales: {
    label: '販売スタッフ退職',
    rule: 'X',
    cat: '退職',
    col: 6,
    side: 'out',
    account: '人件費',
    amount: () => 5,
    apply: (st) => {
      if (st.staffSales > 0) st.staffSales--
    },
  },
  claim: { label: 'クレーム発生', rule: 'X', cat: '費用・トラブル', col: 7, side: 'out', account: '販売費', amount: () => 5 },
  kitchen: { label: '厨房機器故障', rule: 'X', cat: '費用・トラブル', col: 8, side: 'out', account: '管理費', amount: () => 5 },
  rousai: { label: '労災発生', rule: 'X', cat: '費用・トラブル', col: 8, side: 'out', account: '管理費', amount: () => 5 },
  kaihatsu_fail: {
    label: '商品開発失敗',
    rule: 'X',
    cat: '手番のみ',
    col: null,
    noCash: true,
    account: '金額',
    amount: () => 0,
    apply: (st) => {
      if (st.dev > 0) st.dev--
    },
  },
  kansen: { label: '感染症の流行', rule: 'X', cat: '手番のみ', col: null, noCash: true, account: '金額', amount: () => 0 },
  chiiki: { label: '地域行事参加', rule: 'X', cat: '手番のみ', col: null, noCash: true, account: '金額', amount: () => 0 },
  fuhyo: { label: '風評被害発生', rule: 'X', cat: '手番のみ', col: null, noCash: true, account: '金額', amount: () => 0 },
  gyaku: { label: '逆回り', rule: 'X', cat: '手番のみ', col: null, noCash: true, account: '金額', amount: () => 0 },
}

// ---- 初期状態 ----
export function newState(): St {
  return {
    name: '',
    president: '',
    org: '',
    period: 1,
    openingCash: 0,
    openingCapital: 0,
    retained: 0,
    openingMatQty: 0,
    openingMatVal: 0,
    openingProducts: 0,
    openingEquipVal: 0,
    openingMachines: 0,
    openingLots: [],
    openingStaffMfg: 0,
    openingStaffSales: 0,
    openingLoan: 0,
    openingDev: 0,
    openingAds: 0,
    matQty: 0,
    matVal: 0,
    rawCubes: 0,
    products: 0,
    machines: 0,
    equipVal: 0,
    lots: [],
    staffMfg: 0,
    staffSales: 0,
    ads: 0,
    dev: 0,
    insurance: 0,
    edu: 0,
    loan: 0,
    salesQty: 0,
    salesAmt: 0,
    scrapQty: 0,
    equipSold: 0,
    loanMult: 1,
    repayRate: 0,
    tx: [],
    seq: 1,
    settled: false,
    closingPrep: false,
    started: false,
    result: null,
  }
}

// ---- 能力 ----
export function caps(st: St) {
  const workers = Math.min(st.staffMfg, st.machines * 2)
  const mfgCap = workers * (st.edu > 0 ? 3 : 2)
  const salesCap = st.staffSales * 2 + Math.min(st.ads, st.staffSales * 2) * 2
  return { workers, mfgCap, salesCap, priceComp: st.dev * 2 }
}

// ---- recompute（tx から盤面を再導出）----
export function recompute(st: St) {
  // (A) 借入金利の派生行を作り直す
  st.tx = st.tx.filter((t) => !t.isBorrowInterest)
  const withInterest: TxRow[] = []
  for (const t of st.tx) {
    withInterest.push(t)
    if (t.key === 'kariire') {
      const bi = r((t.amount || 0) * getRules().loanRate)
      if (bi > 0)
        withInterest.push({
          id: -(t.id || 0) - 1000000,
          col: 8,
          amount: bi,
          isBorrowInterest: true,
          linkedTo: t.id,
          label: '借入金利',
          note: '借入額×5%',
        })
    }
  }
  st.tx = withInterest
  // (B) 期首在庫を材料/製品に分割
  const op = Math.min(st.openingProducts, st.openingMatQty)
  st.matQty = st.openingMatQty
  st.matVal = st.openingMatVal
  st.products = op
  st.rawCubes = st.openingMatQty - op
  // (C) 盤面を期首値で初期化
  st.machines = st.openingMachines
  st.equipVal = st.openingEquipVal
  st.lots = openingLotsOf(st)
  st.staffMfg = st.openingStaffMfg
  st.staffSales = st.openingStaffSales
  st.loan = st.openingLoan
  st.ads = st.openingAds
  st.dev = st.openingDev
  st.insurance = 0
  st.edu = 0
  st.salesQty = 0
  st.salesAmt = 0
  st.scrapQty = 0
  st.equipSold = 0
  // (D) tx を順に apply
  for (const t of st.tx) {
    const a = t.key ? ACTIONS[t.key] : undefined
    if (!a) continue
    // 盤面に依存する金額（什器売却＝その行の時点の簿価の半値）は、前の行が変わっても追従するよう再生のたびに決め直す
    if (a.amountOf) {
      if (!t.fvals) t.fvals = {}
      t.amount = a.amountOf(st, t.fvals) || 0
    }
    if (a.apply) a.apply(st, t.fvals || {})
  }
}

export function colTotals(st: St): number[] {
  const t = new Array(COLS).fill(0)
  st.tx.forEach((x) => {
    if (x.col !== null && x.col !== undefined) t[x.col] += x.amount
  })
  return t
}

export function flows(st: St) {
  let inS = 0
  let outS = 0
  st.tx.forEach((x) => {
    if (x.col === null || x.col === undefined) return
    if (IN_COLS.includes(x.col)) inS += x.amount
    else outS += x.amount
  })
  return { inS, outS }
}

export function cashNow(st: St): number {
  const { inS, outS } = flows(st)
  return st.openingCash + inS - outS
}

// ---- 借入枠 ----
export function equityNow(st: St): number {
  return st.openingCapital + colTotals(st)[0] + st.retained
}
export function loanCap(st: St): number {
  return st.period <= 1 ? 0 : Math.max(0, r(equityNow(st) * st.loanMult))
}
export function loanRoom(st: St, excl = 0): number {
  return Math.max(0, loanCap(st) - (st.loan - excl))
}

/**
 * その期の1人あたり給料。給料表（rules.salaryTable）の添字は期−1。
 * 表にない期（第6期以降）や値が 0 のときは 28 を使う。
 * 期末処理の計上額と期首処理の事前表示が同じ値になるよう、必ずここを通す。
 */
export function salaryFor(period: number): number {
  return getRules().salaryTable[period - 1] || 28
}

// ---- 期末処理 ----
export function doClosingPrep(st: St) {
  if (st.settled || st.closingPrep) return
  recompute(st)
  const SAL = salaryFor(st.period)
  const head = st.staffMfg + st.staffSales
  const retired = st.tx.filter((x) => x.key === 'taishoku_mfg' || x.key === 'taishoku_sales').length
  const halfPer = Math.ceil(SAL / 2)
  const retSalary = retired * halfPer
  const salary = head * SAL + retSalary
  const salNote = retired > 0 ? `在籍${head}×${SAL}＋退職${retired}×${halfPer}(半額)` : `${head}×${SAL}`
  if (salary > 0)
    st.tx.push({ id: st.seq++, label: '給料(期末)', col: 6, amount: salary, note: salNote, isClosing: true })
  st.tx.push({ id: st.seq++, label: '家賃(期末)', col: 8, amount: getRules().rent, isClosing: true })
  const repay = Math.min(r((st.openingLoan * st.repayRate) / 100), st.loan)
  if (repay > 0)
    st.tx.push({
      id: st.seq++,
      key: 'hensai',
      fvals: { a: repay },
      label: '借入金返済(期末)',
      col: 9,
      amount: repay,
      note: `期首残高${st.openingLoan}×${st.repayRate}%`,
      isClosing: true,
      isAutoRepay: true,
    })
  st.closingPrep = true
  recompute(st)
}

// ---- 決算前の在庫整合性チェック ----
// 期末在庫の個数がマイナス、または盤面と帳簿の個数が食い違う状態では決算させない。
// 正常な台帳では常に null（過去データの破損や想定外の経路への安全網）。
export function settleBlockReason(st: St): string | null {
  recompute(st)
  const scrapQ = st.scrapQty || 0
  const endQty = st.matQty - st.salesQty - scrapQ
  const board = st.rawCubes + st.products
  if (endQty < 0)
    return `期末在庫が ${endQty} 個とマイナスのため決算できません。累計販売 ${st.salesQty} 個が期首在庫＋仕入 ${st.matQty} 個（うち廃棄 ${scrapQ} 個）を超えています。販売・仕入・製造の記帳を見直してください。`
  if (endQty !== board)
    return `在庫の個数が合わないため決算できません（帳簿 ${endQty} 個 / 盤面 ${board} 個）。販売・製造・廃棄の記帳を見直してください。`
  return null
}

/**
 * 法人税。税引前利益（pretax）と前期繰越利益剰余金（retained）から決める。
 * - 税引前利益がマイナス、または繰越を含めた合計（pretax＋retained）がマイナスなら最低税額 5
 * - 繰越損失（retained がマイナス）があるときは、繰越後の額（pretax＋retained）× 30%
 * - それ以外は税引前利益 × 30%。いずれも最低 5
 * 決算（settle）と経営計画書の目安（plan.ts）で同じ式を使う。
 */
export function corporateTax(pretax: number, retained: number): number {
  const total4 = pretax + retained
  let tax: number
  if (pretax < 0 || total4 < 0) tax = 5
  else if (retained < 0) tax = r(total4 * 0.3)
  else tax = r(pretax * 0.3)
  return Math.max(tax, 5)
}

// ---- 決算 ----
export function settle(st: St): Result | null {
  if (st.settled) return st.result
  if (!st.closingPrep) doClosingPrep(st)
  recompute(st)
  const salRow = st.tx.find((x) => x.isClosing && x.col === 6)
  const rentRow = st.tx.find((x) => x.isClosing && x.col === 8)
  const salary = salRow ? salRow.amount : 0
  const rent = rentRow ? rentRow.amount : getRules().rent
  const tot = colTotals(st)
  const { inS, outS } = flows(st)
  const PQ = tot[2]
  const avg = st.matQty ? r(st.matVal / st.matQty) : 0
  const scrapQ = st.scrapQty || 0
  const scrapVal = avg * scrapQ
  const endInvQty = st.matQty - st.salesQty - scrapQ
  const endInvVal = avg * endInvQty
  const vPQ = st.matVal - scrapVal - endInvVal
  const mPQ = PQ - vPQ
  const dep = st.machines * getRules().depPerMachine
  const F = tot[6] + tot[7] + tot[8] + dep
  const G = mPQ - F
  // 特別損益 ＝ A列（保険金・什器売却代金） − 廃棄損 − 売却した什器の簿価
  const special = tot[3] - scrapVal - st.equipSold
  const pretax = G + special
  const ret0b = st.retained
  const total4 = pretax + ret0b
  const tax = corporateTax(pretax, ret0b)
  const net = pretax - tax
  const decisions = st.tx.filter((x) => x.key && ACTIONS[x.key] && ACTIONS[x.key].rule === 'A').length
  const events = st.tx.filter((x) => x.key && ACTIONS[x.key] && ACTIONS[x.key].rule === 'X').length
  const turns = decisions + events
  const cashEnd = st.openingCash + inS - outS
  const equipEnd = st.equipVal - dep
  const loanEnd = st.loan
  const capEnd = st.openingCapital + tot[0]
  const retEnd = st.retained + net
  const assets = cashEnd + endInvVal + equipEnd
  const liabEq = tax + loanEnd + capEnd + retEnd
  const boardInvQty = st.rawCubes + st.products
  const diffQty = endInvQty - boardInvQty
  const result: Result = {
    period: st.period,
    PQ,
    vPQ,
    mPQ,
    F,
    G,
    tax,
    net,
    dep,
    salary,
    avg,
    rent,
    special,
    pretax,
    total4,
    Q: st.salesQty,
    laborF: tot[6],
    sellF: tot[7],
    adminF: tot[8],
    depF: dep,
    cashEnd,
    endInvQty,
    endInvVal,
    equipEnd,
    loanEnd,
    capEnd,
    retEnd,
    assets,
    liabEq,
    diff: assets - liabEq,
    ret0: st.retained,
    cashFlow: inS - outS,
    openCash: st.openingCash,
    eq0: st.openingEquipVal,
    loan0: st.openingLoan,
    salesQty: st.salesQty,
    machines: st.machines,
    staffMfg: st.staffMfg,
    staffSales: st.staffSales,
    inSum: inS,
    outSum: outS,
    openMatQty: st.openingMatQty,
    openMatVal: st.openingMatVal,
    matBoughtQty: st.matQty - st.openingMatQty,
    matBoughtVal: st.matVal - st.openingMatVal,
    totMatQty: st.matQty,
    totMatVal: st.matVal,
    scrap: scrapQ,
    boardInvQty,
    diffQty,
    rawEnd: st.rawCubes,
    prodEnd: st.products,
    dev: st.dev,
    ads: st.ads,
    turns,
    decisions,
    equipTotal: st.equipVal,
    equipBought: colTotals(st)[4],
    equipSold: st.equipSold,
    equipSaleCash: st.tx.filter((x) => x.key === 'baikyaku').reduce((a, x) => a + (x.amount || 0), 0),
    lotsEnd: st.lots.map((l) => ({ period: l.period, book: l.book - getRules().depPerMachine })), // 合計は equipEnd と一致
    loanBorrow: tot[1],
    loanRepay: tot[9],
    name: st.name,
    president: st.president,
    colTot: tot.slice(),
    rows: st.tx.slice(),
    capStart: st.openingCapital,
    loanMult: st.loanMult,
    repayRate: st.repayRate,
    openInterest: r(st.openingLoan * getRules().loanRate),
  }
  st.result = result
  st.settled = true
  return result
}

// ---- 次の期へ ----
export function nextPeriod(st: St): void {
  const res = st.result
  if (!res) return
  st.openingCash = res.cashEnd
  st.openingCapital = res.capEnd
  st.retained = res.retEnd
  st.openingMatQty = res.endInvQty
  st.openingMatVal = res.endInvVal
  st.openingProducts = Math.min(res.prodEnd, res.endInvQty)
  st.openingEquipVal = res.equipEnd
  st.openingMachines = res.machines
  st.openingLots = (res.lotsEnd || []).map((l) => ({ ...l })) // 無ければ recompute が平均で按分する
  st.openingStaffMfg = res.staffMfg
  st.openingStaffSales = res.staffSales
  st.openingLoan = res.loanEnd
  st.openingDev = res.dev >= 2 ? 1 : 0
  st.openingAds = res.ads >= 2 ? 1 : 0
  st.period = Math.min(5, st.period + 1)
  st.tx = []
  st.settled = false
  st.closingPrep = false
  st.result = null
  if (res.period < 5 && res.tax > 0)
    st.tx.push({ id: st.seq++, label: '法人税納付(期首)', col: 10, amount: res.tax, isOpeningTax: true })
  if (res.period < 5 && res.loanEnd > 0) {
    const intr = r(res.loanEnd * getRules().loanRate)
    if (intr > 0)
      st.tx.push({ id: st.seq++, label: '支払金利(期首)', col: 8, amount: intr, isOpeningInterest: true })
  }
  recompute(st)
}

// ---- 表示用の派生値 ----
export const fmt = (n: number) => r(n).toLocaleString('ja-JP')
export const fmtA = (n: number) => {
  n = r(n)
  return n < 0 ? '▲' + Math.abs(n).toLocaleString('ja-JP') : n.toLocaleString('ja-JP')
}

export function ratios(res: Result) {
  return {
    costRate: res.PQ ? r((res.vPQ / res.PQ) * 100) : 0,
    grossRate: res.PQ ? r((res.mPQ / res.PQ) * 100) : 0,
    bepRate: res.mPQ > 0 ? r((res.F / res.mPQ) * 100) : res.G < 0 ? 150 : 0,
    P: res.Q ? r(res.PQ / res.Q) : 0,
    V: res.Q ? r(res.vPQ / res.Q) : 0,
    M: res.Q ? r(res.mPQ / res.Q) : 0,
  }
}

/**
 * 特別損益の内訳（決算書の「① 特別損益」の下に出す）。
 * 保険金 ＝ A列 − 什器売却の代金、廃棄損 ＝ 廃棄個数 × 平均単価、什器売却損 ＝ 売却した簿価 − 代金。
 * 保険金 − 廃棄損 − 什器売却損 ＝ special になる。古い決算結果には売却の値が無いので 0 扱い。
 */
export function specialBreakdown(res: Result): { insurance: number; scrapLoss: number; saleLoss: number } {
  const sale = res.equipSaleCash || 0
  return {
    insurance: (res.colTot?.[3] || 0) - sale,
    scrapLoss: (res.scrap || 0) * (res.avg || 0),
    saleLoss: (res.equipSold || 0) - sale,
  }
}

export function cashflow(res: Result) {
  const c = res.colTot
  // A列のうち什器売却の代金は投資CF（什器の購入と同じ区分）に出す。古い決算結果には無いので 0 扱い
  const sale = res.equipSaleCash || 0
  const opCF = c[2] + (c[3] - sale) - c[5] - c[6] - c[7] - c[8] - c[10]
  const invCF = -c[4] + sale
  const finCF = c[0] + c[1] - c[9]
  return { opCF, invCF, finCF, netCF: opCF + invCF + finCF }
}

export function fmRatio(h: { mPQ: number; F: number; G: number }): number {
  return h.mPQ > 0 ? r((h.F / h.mPQ) * 100) : h.G < 0 ? 150 : 0
}

// histLite 相当（組織比較・履歴の軽量指標）
export interface HistLite {
  period: number
  G: number
  PQ: number
  mPQ: number
  F: number
  net: number
  capEnd: number
  retEnd: number
  cashEnd: number
  turns: number
  decisions: number
}
export function histLite(res: Result): HistLite {
  return {
    period: res.period,
    G: res.G,
    PQ: res.PQ,
    mPQ: res.mPQ,
    F: res.F,
    net: res.net,
    capEnd: res.capEnd,
    retEnd: res.retEnd,
    cashEnd: res.cashEnd,
    turns: res.turns,
    decisions: res.decisions,
  }
}
