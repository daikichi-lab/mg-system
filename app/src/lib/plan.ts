// 経営計画書（第3表）の入力と計算。仕様は docs/仕様書.md §3.2・§5.1。
//
// 参加者が書く値（Plan）だけを保存し、単価（給料・家賃・減価償却・チップ・金利）は保存しない。
// 金額は毎回、数値ルール（getRules）と記帳アクションの定義（ACTIONS[key].amount）から引く。
// → 研修のルールを差し替えても計画の金額が追従し、あとで記帳したときの金額と必ず一致する。
import { ACTIONS, getRules, salaryFor, type St, type Result } from './calc.ts'

/** アクションプランの1行。amount は現金の増減（＋入金／−出金）。未記入は text が空で amount 0 */
export interface PlanAction {
  text: string
  amount: number
}

export interface Plan {
  /** 1. 必要経常利益（G）の目標 */
  g: number
  /**
   * 2. 戦略的投資（新規）：今期に行う予定の投資。
   * 現況（期首の会社盤にいる人・機械・家賃・期首借入残高の金利）は入力せず、盤面から自動で出す。
   */
  hire: number // 採用人数（採用費と、その人の期末給料が固定費に乗る）
  machinesNew: number // 機械購入台数（減価償却が増える）
  edu: number
  ins: number
  ads: number
  dev: number
  loanNew: number // 新規借入額（金利が固定費に乗る）
  /** 4. 単価目標：販売単価 P と売上原価（仕入単価）V */
  p: number
  v: number
  /** 6. アクションプラン（PLAN_ROWS 行固定） */
  actions: PlanAction[]
}

/** アクションプランの行数（様式と同じ 25 行） */
export const PLAN_ROWS = 25

// 保存データの型崩れ対策：数値でなければ 0、人数・枚数は 0 以上の整数に丸める
const num0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const int0 = (v: unknown): number => Math.max(0, Math.round(num0(v)))

/** 計画の初期値（すべて未記入＝0）。現況は盤面から出すので Plan には持たない */
export function defaultPlan(): Plan {
  return {
    g: 0,
    hire: 0,
    machinesNew: 0,
    edu: 0,
    ins: 0,
    ads: 0,
    dev: 0,
    loanNew: 0,
    p: 0,
    v: 0,
    actions: Array.from({ length: PLAN_ROWS }, () => ({ text: '', amount: 0 })),
  }
}

/** 保存データ（不明な形）を Plan に整える。欠けている項目は初期値、行数は PLAN_ROWS に揃える */
export function normalizePlan(input: unknown): Plan {
  const d = defaultPlan()
  if (!input || typeof input !== 'object' || Array.isArray(input)) return d
  const o = input as Record<string, unknown>
  const acts = Array.isArray(o.actions) ? o.actions : []
  return {
    g: num0(o.g),
    hire: int0(o.hire),
    machinesNew: int0(o.machinesNew),
    edu: int0(o.edu),
    ins: int0(o.ins),
    ads: int0(o.ads),
    dev: int0(o.dev),
    loanNew: int0(o.loanNew),
    p: num0(o.p),
    v: num0(o.v),
    actions: Array.from({ length: PLAN_ROWS }, (_, i) => {
      const a = acts[i] as Record<string, unknown> | undefined
      return { text: typeof a?.text === 'string' ? a.text : '', amount: num0(a?.amount) }
    }),
  }
}

/** 固定費の1項目。col は様式の列：now＝現況（最低限必要）／new＝戦略的投資（新規） */
export interface FixedCostItem {
  key: string
  label: string
  detail: string
  amount: number
  col: 'now' | 'new'
}
/** 表示用の単価（数値ルール・記帳アクションから引いたもの） */
export interface FixedCostUnits {
  sal: number // 1人あたり給料（当期）
  dep: number // 減価償却（1台）
  hire: number // 採用費（1人）
  edu: number
  ins: number
  ads: number
  dev: number
  ratePct: number // 借入金利（%）
}
export interface FixedCosts {
  items: FixedCostItem[]
  units: FixedCostUnits
  now: number
  next: number
  total: number
}

/** 表示用：金利を % の整数（0.05 → 5） */
const pct = (rate: number) => Math.round(rate * 1000) / 10

/**
 * 2. 固定費（F）の内訳を数値ルールと盤面から算出する。
 * - 現況（最低限必要・読み取り専用）：期首の会社盤から必ず出る費用。
 *   製造／販売スタッフの給料（期首人数 × 当期給料）、減価償却（期首台数 × 単価）、家賃、期首借入残高の金利
 * - 新規（戦略的投資・入力）：採用（採用費と期末で追加の給料）、機械購入（減価償却）、教育・保険・広告・商品開発（枚数 × 単価）、新規借入の金利。
 *   単価は記帳アクションの amount と同じ式から引く。
 * 金利の丸めは記帳側（期首行・借入の派生行）と同じ Math.round。
 */
export function fixedCosts(plan: Plan, st: St): FixedCosts {
  const R = getRules()
  const sal = salaryFor(st.period)
  // 単価は ACTIONS の amount から「1単位のとき」を引く（定数を二重に持たない）
  const unit = (key: string, f: Record<string, number>) => ACTIONS[key].amount(f)
  const units: FixedCostUnits = {
    sal,
    dep: R.depPerMachine,
    hire: unit('saiyo', { mfg: 1 }),
    edu: unit('kyoiku', { n: 1 }),
    ins: unit('hoken', { n: 1 }),
    ads: unit('koukoku', { n: 1 }),
    dev: unit('kaihatsu', { n: 1 }),
    ratePct: pct(R.loanRate),
  }
  const mfg = st.openingStaffMfg
  const sales = st.openingStaffSales
  const mach = st.openingMachines
  const interestOpen = Math.round(st.openingLoan * R.loanRate)
  const interestNew = Math.round(plan.loanNew * R.loanRate)
  const items: FixedCostItem[] = [
    // 現況
    { key: 'salaryMfg', label: '労務費', detail: `製造スタッフ給与 ${sal}×${mfg}人`, amount: sal * mfg, col: 'now' },
    { key: 'salarySales', label: '人件費', detail: `販売スタッフ給与 ${sal}×${sales}人`, amount: sal * sales, col: 'now' },
    { key: 'dep', label: '減価償却費', detail: `${R.depPerMachine}×${mach}台`, amount: R.depPerMachine * mach, col: 'now' },
    { key: 'rent', label: '家賃', detail: '期末に必ず計上', amount: R.rent, col: 'now' },
    { key: 'intOpen', label: '営業外費用', detail: `借入金の期首残高 ${st.openingLoan}×金利${units.ratePct}%`, amount: interestOpen, col: 'now' },
    // 新規（入力から）
    { key: 'hire', label: '一般管理費', detail: `社員採用 ${units.hire}×${plan.hire}人`, amount: unit('saiyo', { mfg: plan.hire }), col: 'new' },
    { key: 'hireSalary', label: '人件費', detail: `期末で追加の給料 ${sal}×${plan.hire}人`, amount: sal * plan.hire, col: 'new' },
    { key: 'depNew', label: '減価償却費', detail: `機械購入 ${R.depPerMachine}×${plan.machinesNew}台`, amount: R.depPerMachine * plan.machinesNew, col: 'new' },
    { key: 'edu', label: '一般管理費', detail: `教育 ${units.edu}×${plan.edu}枚`, amount: unit('kyoiku', { n: plan.edu }), col: 'new' },
    { key: 'ins', label: '一般管理費', detail: `保険加入 ${units.ins}×${plan.ins}枚`, amount: unit('hoken', { n: plan.ins }), col: 'new' },
    { key: 'ads', label: '販売費', detail: `広告 ${units.ads}×${plan.ads}枚`, amount: unit('koukoku', { n: plan.ads }), col: 'new' },
    { key: 'dev', label: '研究開発費', detail: `商品開発 ${units.dev}×${plan.dev}枚`, amount: unit('kaihatsu', { n: plan.dev }), col: 'new' },
    { key: 'intNew', label: '営業外費用', detail: `今期新規借入 ${plan.loanNew}×金利${units.ratePct}%`, amount: interestNew, col: 'new' },
  ]
  const sum = (col: 'now' | 'new') => items.filter((x) => x.col === col).reduce((s, x) => s + x.amount, 0)
  const now = sum('now')
  const next = sum('new')
  return { items, units, now, next, total: now + next }
}

export interface PlanFigures {
  F: number
  MQ: number
  M: number
  /** 必要販売数。粗利単価 M が 0 以下なら何個売っても届かないので null（計算不能） */
  Q: number | null
  PQ: number | null
  VQ: number | null
}

/** 3〜5. 必要粗利益 MQ＝G＋F、粗利単価 M＝P−V、必要販売数 Q＝⌈MQ÷M⌉（切り上げ）、売上高 P×Q、売上原価 V×Q */
export function planFigures(plan: Plan, st: St): PlanFigures {
  const F = fixedCosts(plan, st).total
  const MQ = plan.g + F
  const M = plan.p - plan.v
  const Q = M > 0 ? Math.max(0, Math.ceil(MQ / M)) : null
  return { F, MQ, M, Q, PQ: Q == null ? null : plan.p * Q, VQ: Q == null ? null : plan.v * Q }
}

export interface CashPlanRow {
  text: string
  amount: number
  balance: number
}
export interface CashPlan {
  /** 前期繰越残高（期首の現金） */
  openingCash: number
  /** 期首処理（法人税納付・支払金利）。期首の自動行の合計をマイナスで */
  openingAuto: number
  rows: CashPlanRow[]
  /** 期末処理（給料・家賃・元本返済）。予定人数と数値ルール、期首の返済率から */
  closingAuto: number
  closingDetail: string
  endBalance: number
}

/**
 * 6. アクションプラン：前期繰越残高 → 期首処理 → 各行の入出金 → 期末処理 の順に現金残高を累計する。
 * 期首処理は記帳済みの自動行（法人税納付・支払金利）の金額をそのまま使う。
 * 期末処理は「（期首人数＋採用予定）× 当期給料 ＋ 家賃 ＋ 期首借入残高 × 返済率」（期末処理の式と同じ）。
 */
export function cashPlan(plan: Plan, st: St): CashPlan {
  const R = getRules()
  const openingAuto = -st.tx
    .filter((t) => t.isOpeningTax || t.isOpeningInterest)
    .reduce((s, t) => s + (t.amount || 0), 0)
  let bal = st.openingCash + openingAuto
  const rows = plan.actions.map((a) => {
    bal += a.amount || 0
    return { text: a.text, amount: a.amount || 0, balance: bal }
  })
  const salary = (st.openingStaffMfg + st.openingStaffSales + plan.hire) * salaryFor(st.period)
  const repay = Math.round((st.openingLoan * st.repayRate) / 100)
  const closingAuto = -(salary + R.rent + repay)
  const closingDetail = `給料 ${salary}＋家賃 ${R.rent}${repay > 0 ? `＋返済 ${repay}` : ''}`
  return { openingCash: st.openingCash, openingAuto, rows, closingAuto, closingDetail, endBalance: bal + closingAuto }
}

/** 経営計画書タブを出すか。数値ルール planFromPeriod の期から（それより前の期はタブ自体を出さない） */
export function planVisible(st: St): boolean {
  return st.period >= getRules().planFromPeriod
}

export type PlanActuals = Pick<Result, 'PQ' | 'vPQ' | 'mPQ' | 'F' | 'G'>

/** 7. その期の実績（決算後にだけ入る）。当期が決算済みなら st.result、過去期は履歴から取る */
export function actualsFor(period: number, st: St, history: Result[]): PlanActuals | null {
  const r = st.settled && st.result && st.result.period === period ? st.result : history.find((h) => h.period === period)
  return r ? { PQ: r.PQ, vPQ: r.vPQ, mPQ: r.mPQ, F: r.F, G: r.G } : null
}
