// 戦略MG 計算エンジン（mock/index.html の純関数を TypeScript 移植）。
// docs/calc-spec.md に忠実。数値は mock と厳密一致（golden-master テストで検証）。

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

// ---- 定数 ----
export const SALARY_TABLE: Record<number, number> = { 1: 25, 2: 28, 3: 31, 4: 34, 5: 37 }
export const COLS = 11
export const IN_COLS = [0, 1, 2, 3]
export const LOAN_RATE = 0.05
export const RENT = 25
export const DEP_PER_MACHINE = 10
export const MACHINE_PRICE = 100
export const MATERIAL_PRICES = [10, 11, 12, 13, 14, 15, 16]
export const MAT_CAP = 15
export const PROD_CAP = 15
export const COL_LABELS = [
  'ア 資本金',
  'イ 借入金',
  'ウ 売上',
  'A 受取保険金',
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
  apply?: (st: St, f: Fvals) => void
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
    amount: (f) => (f.n || 0) * MACHINE_PRICE,
    apply: (st, f) => {
      st.machines += f.n || 0
      st.equipVal += (f.n || 0) * MACHINE_PRICE
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
  dokusen: {
    label: '独占販売!',
    rule: 'X',
    cat: '販売機会',
    col: 2,
    side: 'in',
    account: '売上',
    amount: (f) => (f.qty || 0) * (f.unit || 0),
    apply: (st, f) => {
      const n = Math.min(f.qty || 0, st.products)
      st.products -= n
      st.salesQty += n
      st.salesAmt += n * (f.unit || 0)
    },
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
      const bi = r((t.amount || 0) * LOAN_RATE)
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
  // (D) tx を順に apply
  for (const t of st.tx) {
    if (t.key && ACTIONS[t.key] && ACTIONS[t.key].apply) ACTIONS[t.key].apply!(st, t.fvals || {})
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

// ---- 期末処理 ----
export function doClosingPrep(st: St) {
  if (st.settled || st.closingPrep) return
  recompute(st)
  const SAL = SALARY_TABLE[st.period] || 28
  const head = st.staffMfg + st.staffSales
  const retired = st.tx.filter((x) => x.key === 'taishoku_mfg' || x.key === 'taishoku_sales').length
  const halfPer = Math.ceil(SAL / 2)
  const retSalary = retired * halfPer
  const salary = head * SAL + retSalary
  const salNote = retired > 0 ? `在籍${head}×${SAL}＋退職${retired}×${halfPer}(半額)` : `${head}×${SAL}`
  if (salary > 0)
    st.tx.push({ id: st.seq++, label: '給料(期末)', col: 6, amount: salary, note: salNote, isClosing: true })
  st.tx.push({ id: st.seq++, label: '家賃(期末)', col: 8, amount: RENT, isClosing: true })
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

// ---- 決算 ----
export function settle(st: St): Result | null {
  if (st.settled) return st.result
  if (!st.closingPrep) doClosingPrep(st)
  recompute(st)
  const salRow = st.tx.find((x) => x.isClosing && x.col === 6)
  const rentRow = st.tx.find((x) => x.isClosing && x.col === 8)
  const salary = salRow ? salRow.amount : 0
  const rent = rentRow ? rentRow.amount : RENT
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
  const dep = st.machines * DEP_PER_MACHINE
  const F = tot[6] + tot[7] + tot[8] + dep
  const G = mPQ - F
  const special = tot[3] - scrapVal
  const pretax = G + special
  const ret0b = st.retained
  const total4 = pretax + ret0b
  let tax: number
  if (pretax < 0 || total4 < 0) tax = 5
  else if (ret0b < 0) tax = r(total4 * 0.3)
  else tax = r(pretax * 0.3)
  tax = Math.max(tax, 5)
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
    loanBorrow: tot[1],
    loanRepay: tot[9],
    name: st.name,
    president: st.president,
    colTot: tot.slice(),
    rows: st.tx.slice(),
    capStart: st.openingCapital,
    loanMult: st.loanMult,
    repayRate: st.repayRate,
    openInterest: r(st.openingLoan * LOAN_RATE),
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
    const intr = r(res.loanEnd * LOAN_RATE)
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

export function cashflow(res: Result) {
  const c = res.colTot
  const opCF = c[2] + c[3] - c[5] - c[6] - c[7] - c[8] - c[10]
  const invCF = -c[4]
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
