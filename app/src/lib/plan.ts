// 経営計画書（第3表）の入力と計算。仕様は docs/仕様書.md §3.2・§5.1。
//
// 参加者が書く値（Plan）だけを保存し、単価（給料・家賃・減価償却・チップ・金利）は保存しない。
// 金額は毎回、数値ルール（getRules）と記帳アクションの定義（ACTIONS[key].amount）から引く。
// → 研修のルールを差し替えても計画の金額が追従し、あとで記帳したときの金額と必ず一致する。
import {
  ACTIONS,
  caps,
  getRules,
  loanRoom,
  cashNow,
  nextPeriod,
  recompute,
  salaryFor,
  corporateTax,
  type Fvals,
  type Result,
  type St,
} from './calc.ts'

/**
 * アクションプランの1行。1行＝そのアクションを1回行う予定。
 * key は記帳アクションのキー（プルダウンで選ぶ。'' ＝未選択）、
 * qty は数量（個・枚・台・人。借入／返済は金額そのもの）、
 * amount は現金の増減（＋入金／−出金）。amount は key・qty から自動で入るが、手で上書きもできる。
 */
export interface PlanAction {
  key: string
  qty: number
  amount: number
}

/**
 * アクションプランのプルダウンに出す記帳アクション。
 * 参加者が自分の意思で行うルールA・Bだけを ACTIONS の定義順に並べる
 * （ルールX＝イベントは自分では選べないので出さない）。
 */
export const PLAN_ACTION_KEYS = Object.keys(ACTIONS).filter(
  // 什器売却は「どの機械を売るか」で金額が決まり、数量×単価では出せないので計画のプルダウンには入れない
  (k) => ACTIONS[k].rule !== 'X' && !ACTIONS[k].amountOf,
)
export const PLAN_ACTION_OPTIONS = PLAN_ACTION_KEYS.map((key) => ({ key, label: ACTIONS[key].label }))

/** 数量の単位。借入・返済は数量そのものが金額なので単位は付けない */
export const PLAN_ACTION_UNITS: Record<string, string> = {
  shiire: '個',
  seizo: '個',
  hanbai: '個',
  kikai: '台',
  saiyo: '人',
  haichi: '人',
  koukoku: '枚',
  kaihatsu: '枚',
  hoken: '枚',
  kyoiku: '枚',
  kariire: '',
  hensai: '',
}

/** アクションを選んだ直後の数量。借入・返済は金額なので 0 から、それ以外は 1回分の 1 */
export function defaultQty(key: string): number {
  if (!key) return 0
  return key === 'kariire' || key === 'hensai' ? 0 : 1
}

/** 数量を、そのアクションの記帳フォームの入力値に変換する（金額は記帳と同じ式で出すため） */
function fieldsFor(key: string, qty: number, plan: Plan): Fvals {
  switch (key) {
    case 'shiire':
      return { qty, unit: plan.v } // 仕入単価は計画の売上原価 V
    case 'hanbai':
      return { qty, unit: plan.p } // 売価は計画の販売単価 P
    case 'saiyo':
      return { mfg: qty }
    case 'kariire':
    case 'hensai':
      return { a: qty }
    default:
      return { qty, n: qty }
  }
}

/**
 * アクションプラン1行の入出金。記帳と同じ `ACTIONS[key].amount` を使い、
 * 入金（side='in'）は ＋、出金（'out'）は −、現金が動かないもの（製造など）は 0。
 * 単価を持たないので、仕入れ・販売は計画の V・P をそのまま使う。
 */
export function actionAmount(key: string, qty: number, plan: Plan): number {
  const def = ACTIONS[key]
  if (!def || !def.side) return 0
  const v = Math.round(def.amount(fieldsFor(key, qty, plan)))
  return def.side === 'in' ? v : -v
}

export interface Plan {
  /** 1. 必要経常利益（G）の目標 */
  g: number
  /**
   * 2. 戦略的投資（新規）：今期に行う予定の投資。
   * 現況（期首の会社盤にいる人・機械・家賃・期首借入残高の金利）は入力せず、盤面から自動で出す。
   */
  hire: number // スタッフ採用の人数（製造・販売は分けない）
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

/**
 * 計画どおりに投資したときの1回あたりの能力。
 * 盤面は「期首 ＋ 今期の機械購入・教育・広告」で組む（教育チップは期をまたがない）。
 * **採用予定は入れない**：製造・販売どちらに配置するかで能力が変わり、計画では決められないため。
 */
function planCaps(plan: Plan, st: St) {
  return caps({
    ...st,
    staffMfg: st.openingStaffMfg,
    staffSales: st.openingStaffSales,
    machines: st.openingMachines + plan.machinesNew,
    edu: plan.edu,
    ads: st.openingAds + plan.ads,
  })
}

/**
 * 1回の記帳でできる数量の上限。ルールで決まっているものだけ返し、上限が無ければ null。
 * 記帳のバリデーション（lib/game.ts の `validate()`）と同じ根拠にそろえてある。
 * - 仕入れ：材料在庫の上限（matCap）まで
 * - 製造：製造能力と店舗陳列の上限（prodCap）の小さいほう
 * - 販売：販売能力まで
 * - 教育・商品開発：記帳フォームが1回1枚で固定なので 1（教育チップは期を通しても最大1枚）
 * - 配置転換：期首のスタッフ数まで
 * - 借入：今期借入可能額まで／返済：借入残高まで
 */
export function actionQtyMax(key: string, plan: Plan, st: St): number | null {
  const R = getRules()
  switch (key) {
    case 'shiire':
      return R.matCap
    case 'seizo':
      return Math.min(planCaps(plan, st).mfgCap, R.prodCap)
    case 'hanbai':
      return planCaps(plan, st).salesCap
    case 'kyoiku':
    case 'kaihatsu':
      return 1
    case 'haichi':
      return Math.max(st.openingStaffMfg, st.openingStaffSales)
    case 'kariire':
      return loanRoom(st)
    case 'hensai':
      return st.loan
    default:
      return null // 機械購入・スタッフ採用・広告・保険はルール上の上限なし
  }
}

/** 数量を1回の上限に収める（上限が無ければそのまま） */
export function clampQty(key: string, qty: number, plan: Plan, st: St): number {
  const max = actionQtyMax(key, plan, st)
  const n = Math.max(0, Math.round(qty))
  return max == null ? n : Math.min(n, max)
}

/** 教育チップは期を通して最大1枚（記帳の `教育チップは最大1枚までです` と同じ） */
export const EDU_MAX = 1

/** アクションプランの行数（様式と同じ 25 行） */
export const PLAN_ROWS = 25

// 保存データの型崩れ対策：数値でなければ 0、人数・枚数は 0 以上の整数に丸める
const num0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const int0 = (v: unknown): number => Math.max(0, Math.round(num0(v)))

/**
 * 保存済みの1行から記帳アクションのキーを読む。知らないキーは未選択（''）にする。
 * 自由記入だった頃の text は、アクション名と一致すればそのキーに読み替える。
 */
function actionKey(a: Record<string, unknown> | undefined): string {
  const k = a?.key
  if (typeof k === 'string' && PLAN_ACTION_KEYS.includes(k)) return k
  const t = a?.text
  return typeof t === 'string' ? (PLAN_ACTION_KEYS.find((x) => ACTIONS[x].label === t) ?? '') : ''
}

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
    actions: Array.from({ length: PLAN_ROWS }, () => ({ key: '', qty: 0, amount: 0 })),
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
    // 製造・販売を分けて保存された古い計画は、合計を採用人数として読む
    hire: o.hire === undefined ? int0(o.hireMfg) + int0(o.hireSales) : int0(o.hire),
    machinesNew: int0(o.machinesNew),
    edu: Math.min(EDU_MAX, int0(o.edu)), // 教育チップは最大1枚
    ins: int0(o.ins),
    ads: int0(o.ads),
    dev: int0(o.dev),
    loanNew: int0(o.loanNew),
    p: num0(o.p),
    v: num0(o.v),
    actions: Array.from({ length: PLAN_ROWS }, (_, i) => {
      const a = acts[i] as Record<string, unknown> | undefined
      return { key: actionKey(a), qty: int0(a?.qty), amount: num0(a?.amount) }
    }),
  }
}

/**
 * 税引後の利益を `after` 以上にするのに必要な、最小の経常利益 G。
 * 決算と同じ法人税の式（corporateTax）で「G − 税 ≧ after」となる最小の整数を探す
 * （繰越損失があるときは埋めた残りだけに課税されるので、実質「after ＋ 最低税額 5」になる）。
 * 特別損益（保険金・廃棄損）は無いものとする。after が 0 以下なら目安は出さない（null）。
 */
export function gForAfterTax(after: number, st: St): number | null {
  if (after <= 0) return null
  for (let g = Math.ceil(after); g <= after + 100000; g++) {
    if (g - corporateTax(g, st.retained) >= after) return g
  }
  return null
}

/**
 * 1. 経常利益（G）の目安その1：期首の利益剰余金がマイナスのとき、
 * 期末にそれをゼロ以上へ戻すのに必要な最小の G。利益剰余金が 0 以上なら出さない（null）。
 */
export function breakEvenG(st: St): number | null {
  return st.retained >= 0 ? null : gForAfterTax(-st.retained, st)
}

/** 1位との差を埋めるのに必要な経常利益（目安その2） */
export interface RankGap {
  /** 純資産が1番多い他社 */
  topName: string
  topEquity: number
  /** 自社の期首の純資産（資本金＋利益剰余金） */
  myEquity: number
  /** 1位との差。0 以下なら自社が1位 */
  gap: number
  /** 差を今期の税引後利益で埋めるのに必要な経常利益。差が無ければ null */
  g: number | null
}

/** 純資産の比較に使う、その会社の最新の決算結果 */
export interface RankCompany {
  name: string
  results?: { capEnd: number; retEnd: number }[] | null
}

/**
 * 1. 経常利益（G）の目安その2：同じ研修の他社のうち純資産が1番多い会社との差と、
 * それを今期で埋めるのに必要な経常利益。
 *
 * - 純資産 ＝ 資本金 ＋ 利益剰余金。他社は最新の決算結果（capEnd＋retEnd）、自社は期首の値を使う。
 * - 期末の純資産 ＝ 期首の純資産 ＋ 当期純利益（増資なしとして）なので、
 *   差を埋めるには「税引後利益 ≧ 差」。必要な G は `gForAfterTax()` で出す。
 * - **相手も今期伸びるので、あくまで現時点の差に対する目安**。決算がまだ1社も無ければ出さない（null）。
 */
export function rankGap(st: St, companies: RankCompany[]): RankGap | null {
  const equityOf = (c: RankCompany): number | null => {
    const r = c.results?.[c.results.length - 1]
    return r ? r.capEnd + r.retEnd : null
  }
  const others = companies
    .filter((c) => c.name !== st.name)
    .map((c) => ({ name: c.name, eq: equityOf(c) }))
    .filter((x): x is { name: string; eq: number } => x.eq != null)
  if (!others.length) return null
  const top = others.reduce((a, b) => (b.eq > a.eq ? b : a))
  const myEquity = st.openingCapital + st.retained
  const gap = top.eq - myEquity
  return { topName: top.name, topEquity: top.eq, myEquity, gap, g: gap > 0 ? gForAfterTax(gap, st) : null }
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
 *   スタッフの給料（期首人数 × 当期給料。製造・販売を分けず人件費でまとめる）、減価償却（期首台数 × 単価）、家賃、期首借入残高の金利
 * - 新規（戦略的投資・入力）：採用（製造・販売それぞれの採用費と、期末で追加の給料）、機械購入（減価償却）、教育・保険・広告・商品開発（枚数 × 単価）、新規借入の金利。
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
    // 製造・販売を分けず「人件費」1行にまとめる（労務費という費目は使わない）
    {
      key: 'salary',
      label: '人件費',
      detail: `現在雇用しているスタッフ ${mfg + sales}人 × 給料 ${sal}`,
      amount: sal * (mfg + sales),
      col: 'now',
    },
    { key: 'dep', label: '減価償却費', detail: `現在所有している什器 ${mach}台 × 減価償却 ${R.depPerMachine}`, amount: R.depPerMachine * mach, col: 'now' },
    { key: 'rent', label: '家賃', detail: '期末に必ず発生する家賃', amount: R.rent, col: 'now' },
    { key: 'intOpen', label: '営業外費用', detail: `期首の借入金 ${st.openingLoan} × 金利${units.ratePct}%`, amount: interestOpen, col: 'now' },
    // 新規（入力から）
    { key: 'hire', label: '一般管理費', detail: `採用費 ${units.hire} × ${plan.hire}人`, amount: unit('saiyo', { mfg: plan.hire }), col: 'new' },
    { key: 'hireSalary', label: '人件費', detail: `給料 ${sal} × ${plan.hire}人`, amount: sal * plan.hire, col: 'new' },
    { key: 'depNew', label: '減価償却費', detail: `減価償却 ${R.depPerMachine} × ${plan.machinesNew}台`, amount: R.depPerMachine * plan.machinesNew, col: 'new' },
    { key: 'edu', label: '一般管理費', detail: `${units.edu} × ${plan.edu}枚`, amount: unit('kyoiku', { n: plan.edu }), col: 'new' },
    { key: 'ins', label: '一般管理費', detail: `${units.ins} × ${plan.ins}枚`, amount: unit('hoken', { n: plan.ins }), col: 'new' },
    { key: 'ads', label: '販売費', detail: `${units.ads} × ${plan.ads}枚`, amount: unit('koukoku', { n: plan.ads }), col: 'new' },
    { key: 'dev', label: '研究開発費', detail: `${units.dev} × ${plan.dev}枚`, amount: unit('kaihatsu', { n: plan.dev }), col: 'new' },
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
  /** 選ばれている記帳アクションのキー（'' ＝未選択） */
  key: string
  qty: number
  amount: number
  balance: number
}
export interface CashPlan {
  /** 前期繰越残高（期首の現金） */
  openingCash: number
  /** 期首処理（法人税納付・支払金利）。期首の自動行の合計をマイナスで */
  openingAuto: number
  rows: CashPlanRow[]
}

/**
 * 7. アクションプラン：前期繰越残高 → 期首処理 → 各行の入出金 の順に現金残高を累計する。
 * 期首処理は記帳済みの自動行（法人税納付・支払金利）の金額をそのまま使う。
 * 期末処理（給料・家賃・元本返済）はアクションプランには載せない。
 */
export function cashPlan(plan: Plan, st: St): CashPlan {
  const openingAuto = -st.tx
    .filter((t) => t.isOpeningTax || t.isOpeningInterest)
    .reduce((s, t) => s + (t.amount || 0), 0)
  let bal = st.openingCash + openingAuto
  const rows = plan.actions.map((a) => {
    bal += a.amount || 0
    return { key: a.key, qty: a.qty, amount: a.amount || 0, balance: bal }
  })
  return { openingCash: st.openingCash, openingAuto, rows }
}

/** 7. 必要なアクション回数の1項目 */
export interface ActionNeed {
  /** 記帳アクションのキー（アクションプランのプルダウンと同じ） */
  key: string
  label: string
  /** 最低限必要な回数。能力が 0 で何回やっても届かないときは null */
  need: number | null
  /** 回数の根拠（必要量 ÷ 1回あたりの上限） */
  detail: string
  /** アクションプランで実際に選ばれている回数 */
  planned: number
}

/**
 * 7. どのアクションを何回しないといけないかを、必要販売数 Q と能力から逆算する。
 *
 * - 仕入れ／製造／販売：期首在庫で足りない分 ÷ 1回あたりの上限（切り上げ）。
 *   能力の式は calc の `caps()` をそのまま使う（式を二重に持たない）。
 *   盤面は「期首 ＋ 今期の機械購入・教育・広告」で組む。教育チップは期をまたがないので計画の枚数がそのまま効く。
 *   **採用予定は能力に入れない**：製造・販売どちらに配置するかで能力が変わり、計画では決められないため。
 * - 投資（採用・機械購入・広告・保険・教育・商品開発・借入）：入力があるものだけ出す。
 *   教育と商品開発は記帳フォームが1回1枚固定なので枚数＝回数、それ以外は1回でまとめて記帳できる。
 */
export function actionNeeds(plan: Plan, st: St): ActionNeed[] {
  const R = getRules()
  const Q = planFigures(plan, st).Q
  const c = planCaps(plan, st)
  // 回数 ＝ 必要量 ÷ 1回あたりの上限（切り上げ）。上限が 0 なら何回やっても届かないので null
  const times = (qty: number, cap: number): number | null => (cap > 0 ? Math.ceil(qty / cap) : qty > 0 ? null : 0)
  const list: ActionNeed[] = []
  const push = (key: string, need: number | null, detail: string) =>
    list.push({
      key,
      label: ACTIONS[key].label,
      need,
      detail,
      planned: plan.actions.filter((a) => a.key === key).length,
    })
  if (Q == null) {
    // 粗利単価 M が 0 以下で Q が出せないときは、売買の回数も出せない
    const noQ = '売上必要個数（Q）が未確定です'
    push('shiire', null, noQ)
    push('seizo', null, noQ)
    push('hanbai', null, noQ)
  } else {
    const buy = Math.max(0, Q - st.openingMatQty) // 期首在庫（材料＋製品）で足りない分だけ仕入れる
    const make = Math.max(0, Q - st.openingProducts) // 期首の製品で足りない分だけ製造する
    push('shiire', times(buy, R.matCap), `${buy}個 ÷ 在庫上限 ${R.matCap}個`)
    push('seizo', times(make, c.mfgCap), `${make}個 ÷ 製造能力 ${c.mfgCap}個`)
    push('hanbai', times(Q, c.salesCap), `${Q}個 ÷ 販売能力 ${c.salesCap}個`)
  }
  if (plan.hire > 0) push('saiyo', 1, `${plan.hire}人（1回でまとめて実施）`)
  if (plan.machinesNew > 0) push('kikai', 1, `${plan.machinesNew}台（1回でまとめて実施）`)
  if (plan.ads > 0) push('koukoku', 1, `${plan.ads}枚（1回でまとめて実施）`)
  if (plan.ins > 0) push('hoken', 1, `${plan.ins}枚（1回でまとめて実施）`)
  if (plan.edu > 0) push('kyoiku', plan.edu, `1回につき1枚のため ${plan.edu}枚＝${plan.edu}回`)
  if (plan.dev > 0) push('kaihatsu', plan.dev, `1回につき1枚のため ${plan.dev}枚＝${plan.dev}回`)
  if (plan.loanNew > 0) push('kariire', 1, `${plan.loanNew}（1回でまとめて実施）`)
  return list
}

/**
 * 過去の期の経営計画書を見るために、その期の「期首の盤面」を前の期の決算結果から組み直す。
 * 期またぎ（`nextPeriod()`）と同じ導出なので、その期に計画を書いたときと同じ現況・能力・借入枠になる。
 * 前の期の決算が無ければ組み直せない（null）。
 */
export function stateAtPeriod(period: number, history: Result[], base: St): St | null {
  if (period === 1) {
    // 第1期の期首は何も持っていない（資本金も記帳で入る）ので、期首の値をすべて 0 にした盤面
    const st: St = {
      ...base,
      period: 1,
      tx: [],
      seq: 1,
      result: null,
      settled: false,
      closingPrep: false,
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
    }
    recompute(st)
    return st
  }
  const prev = history.find((r) => r.period === period - 1)
  if (!prev) return null
  const st: St = {
    ...base,
    period: prev.period, // nextPeriod() が +1 する
    result: prev,
    tx: [],
    seq: 1,
    settled: true,
    closingPrep: true,
    loanMult: prev.loanMult,
    repayRate: prev.repayRate,
  }
  nextPeriod(st)
  return st
}

export interface PlanActualItem {
  key: string
  label: string
  unit: string
  plan: number
  actual: number
  /** 実績 − 計画 */
  diff: number
  /** 計画に届いたか。売上原価・固定費は少ないほうが良いので判定が逆になる */
  ok: boolean
}

/** アクションを何回やる計画で、実際に何回やったか */
export interface PlanActualAction {
  key: string
  label: string
  plan: number
  actual: number
  /** 実績 − 計画 */
  diff: number
}

/** ある期の「計画と実績の差」 */
export interface PlanActual {
  period: number
  items: PlanActualItem[]
  /** アクションの実施回数。計画にも実績にも無いアクションは入れない */
  actions: PlanActualAction[]
}

/**
 * 8. 計画と実績の差。**計画と決算の両方がある期**だけを、期の古い順に返す。
 *
 * 計画側は経営計画書の STRAC 図と同じ作り（PQ＝P×Q、VQ＝V×Q、MQ＝PQ−VQ、G＝MQ−F）。
 * 固定費の「現況」はその期の期首の盤面から出るので、`stateAtPeriod()` で当時の盤面を組み直して計算する
 * （今の盤面で計算すると、当時の計画と違う数字になってしまう）。
 */
export function planVsActual(history: Result[], plans: Record<string, unknown>, base: St): PlanActual[] {
  const out: PlanActual[] = []
  for (const r of [...history].sort((a, b) => a.period - b.period)) {
    const saved = plans[String(r.period)]
    if (!saved) continue
    const st = stateAtPeriod(r.period, history, base)
    if (!st) continue
    const plan = normalizePlan(saved)
    const fig = planFigures(plan, st)
    if (fig.Q == null || fig.PQ == null || fig.VQ == null) continue // 単価が未記入で個数が出ていない計画は比べられない
    const mPQ = fig.PQ - fig.VQ
    // more＝多いほど良い／less＝少ないほうが良い
    // 実績の単価は決算の合計から割り戻す（決算書の STRAC 図と同じ出し方）
    const actP = r.Q ? Math.round(r.PQ / r.Q) : 0
    const actV = r.Q ? Math.round(r.vPQ / r.Q) : 0
    const rows: [string, string, string, number, number, 'more' | 'less'][] = [
      ['P', '売上単価 P（1個）', '', plan.p, actP, 'more'],
      ['V', '売上原価 V（1個）', '', plan.v, actV, 'less'],
      ['Q', '売上個数 Q', '個', fig.Q, r.Q, 'more'],
      ['PQ', '売上高 PQ', '', fig.PQ, r.PQ, 'more'],
      ['VQ', '売上原価 VQ', '', fig.VQ, r.vPQ, 'less'],
      ['MQ', '粗利益 MQ', '', mPQ, r.mPQ, 'more'],
      ['F', '固定費 F', '', fig.F, r.F, 'less'],
      ['G', '経常利益 G', '', mPQ - fig.F, r.G, 'more'],
    ]
    // アクションの実施回数。実績は決算に残った記帳行（`rows`）から数える。
    // 参加者が選べるアクション（ルールA・B）だけを見る＝イベントや自動行（借入金利・給料）は数えない
    const planned = new Map<string, number>()
    for (const a of plan.actions) if (a.key) planned.set(a.key, (planned.get(a.key) ?? 0) + 1)
    const done = new Map<string, number>()
    for (const t of r.rows || [])
      if (t.key && PLAN_ACTION_KEYS.includes(t.key)) done.set(t.key, (done.get(t.key) ?? 0) + 1)
    const actions: PlanActualAction[] = PLAN_ACTION_KEYS.filter((k) => planned.has(k) || done.has(k)).map((k) => ({
      key: k,
      label: ACTIONS[k].label,
      plan: planned.get(k) ?? 0,
      actual: done.get(k) ?? 0,
      diff: (done.get(k) ?? 0) - (planned.get(k) ?? 0),
    }))
    out.push({
      period: r.period,
      items: rows.map(([key, label, unit, p, a, good]) => ({
        key,
        label,
        unit,
        plan: p,
        actual: a,
        diff: a - p,
        ok: good === 'more' ? a >= p : a <= p,
      })),
      actions,
    })
  }
  return out
}

/**
 * 経営計画書を変更できなくするか。**その期の記帳を1件でも始めたら固定**する。
 * 計画は「記帳を始める前に立てるもの」で、動き出したあとに書き換えると計画と実績の対比が意味を失うため。
 * 期首処理の自動行（法人税納付・支払金利・資本金）は記帳に数えない（key を持たないため）。
 * 期末処理や決算まで進んだ期も同じく変更できない。
 */
export function planLocked(st: St): boolean {
  return st.tx.some((t) => !!t.key) || st.closingPrep || st.settled
}

/** 経営計画書タブを出すか。数値ルール planFromPeriod の期から（それより前の期はタブ自体を出さない） */
export function planVisible(st: St): boolean {
  return st.period >= getRules().planFromPeriod
}

/**
 * 進捗タブを出すか。数値ルール progressFromPeriod（既定 4）の期から。
 * 比べる計画が必要なので、経営計画書タブが出ていない期には出さない（ルールの検証を通っていない古いデータへの保険）。
 */
export function progressVisible(st: St): boolean {
  return st.period >= getRules().progressFromPeriod && planVisible(st)
}

/** 進捗の1行（計画と、ここまでの実績） */
export interface ProgressItem {
  key: string
  label: string
  unit: string
  plan: number
  actual: number
  /** 実績 ÷ 計画（％・整数）。計画が 0 なら null */
  rate: number | null
  /** 計画まで残り（計画 − 実績。0 未満は 0） */
  remain: number
}
export interface ProgressAction {
  key: string
  label: string
  plan: number
  done: number
}
export interface Progress {
  items: ProgressItem[]
  actions: ProgressAction[]
  /** 計画したアクションの合計回数と、そのうち実施した回数（計画に無いアクションは数えない） */
  plannedTotal: number
  doneTotal: number
  /** 売上個数の残りを今の販売能力で割った、あと必要な販売回数。能力 0 なら null */
  salesLeftTimes: number | null
  salesCap: number
  /** 今の現金 */
  cash: number
  /**
   * 粗利の概算に使った1個あたりの売上原価。今期の仕入があれば「仕入金額の合計 ÷ 仕入個数」、
   * 無ければ計画の売上原価 V（from で区別）
   */
  cost: { unit: number; from: 'buy' | 'plan'; buyAmt: number; buyQty: number }
}

/** 記帳行の個数（仕入・販売は複数行 items の合計、製造は qty） */
function rowQty(f: Fvals | undefined): number {
  if (!f) return 0
  if (Array.isArray(f.items)) return f.items.reduce((s: number, it: Fvals) => s + (Number(it?.qty) || 0), 0)
  return Number(f.qty) || 0
}

/**
 * 進捗タブ：今期の計画（経営計画書）と、ここまでの記帳の実績を並べる。計画の Q が出ていなければ null。
 *
 * - 売上個数 Q・売上高 PQ：盤面の salesQty・salesAmt（特売などイベントの販売も含む）
 * - 粗利 MQ：売上高 −（売上個数 × 1個あたりの売上原価）の**概算**。売上原価は期末の棚卸で決まるため、
 *   期中は今期の仕入の実績（仕入金額の合計 ÷ 仕入個数）で見る。今期まだ仕入が無ければ計画の売上原価 V
 * - 仕入個数：計画は「Q − 期首の材料在庫」（6. の必要量と同じ）、実績は今期の仕入の記帳行の個数の合計
 * - 製造個数：計画は「Q − 期首の製品在庫」、実績は今期の製造の記帳行の個数の合計
 * - アクション：計画の回数と、今期に記帳した回数（ルールA・Bのアクションだけ。`planVsActual()` と同じ数え方）
 */
export function progressNow(plan: Plan, st: St): Progress | null {
  const fig = planFigures(plan, st)
  if (fig.Q == null || fig.PQ == null || fig.VQ == null) return null
  const sumQty = (key: string) => st.tx.filter((t) => t.key === key).reduce((s, t) => s + rowQty(t.fvals), 0)
  const item = (key: string, label: string, unit: string, p: number, a: number): ProgressItem => ({
    key,
    label,
    unit,
    plan: p,
    actual: a,
    rate: p > 0 ? Math.round((a / p) * 100) : null,
    remain: Math.max(0, p - a),
  })
  const Q = fig.Q
  // 今期の仕入の実績（記帳した金額と個数）。1個あたりの原価は小数のまま使い、粗利を出すときに丸める
  const buyQty = sumQty('shiire')
  const buyAmt = st.tx.filter((t) => t.key === 'shiire').reduce((s, t) => s + (t.amount || 0), 0)
  const unitCost = buyQty > 0 ? buyAmt / buyQty : plan.v
  const items = [
    item('Q', '売上個数 Q', '個', Q, st.salesQty),
    item('PQ', '売上高 PQ', '', fig.PQ, st.salesAmt),
    item('MQ', '粗利益 MQ（概算）', '', fig.PQ - fig.VQ, st.salesAmt - Math.round(st.salesQty * unitCost)),
    item('buy', '仕入個数', '個', Math.max(0, Q - st.openingMatQty), buyQty),
    item('make', '製造個数', '個', Math.max(0, Q - st.openingProducts), sumQty('seizo')),
  ]
  const planned = new Map<string, number>()
  for (const a of plan.actions) if (a.key) planned.set(a.key, (planned.get(a.key) ?? 0) + 1)
  const done = new Map<string, number>()
  for (const t of st.tx) if (t.key && PLAN_ACTION_KEYS.includes(t.key)) done.set(t.key, (done.get(t.key) ?? 0) + 1)
  const actions = PLAN_ACTION_KEYS.filter((k) => planned.has(k) || done.has(k)).map((k) => ({
    key: k,
    label: ACTIONS[k].label,
    plan: planned.get(k) ?? 0,
    done: done.get(k) ?? 0,
  }))
  const plannedTotal = actions.reduce((s, a) => s + a.plan, 0)
  // 計画に入れた回数を上限に数える（計画より多くやった分・計画外のアクションは「消化」に入れない）
  const doneTotal = actions.reduce((s, a) => s + Math.min(a.plan, a.done), 0)
  const salesCap = caps(st).salesCap
  const left = Math.max(0, Q - st.salesQty)
  return {
    items,
    actions,
    plannedTotal,
    doneTotal,
    salesLeftTimes: left === 0 ? 0 : salesCap > 0 ? Math.ceil(left / salesCap) : null,
    salesCap,
    cash: cashNow(st),
    cost: { unit: Math.round(unitCost * 10) / 10, from: buyQty > 0 ? 'buy' : 'plan', buyAmt, buyQty },
  }
}
