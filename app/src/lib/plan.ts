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
  settle,
  type Fvals,
  type Result,
  type St,
} from './calc.ts'
import { validate } from './game.ts'

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
  /**
   * アクションの種類の補足（issue #102）。記帳フォームで選ぶものと同じ。
   * スタッフ採用：'mfg'（製造）／'sales'（販売）、配置転換：'mfg->sales'／'sales->mfg'。それ以外は使わない
   */
  opt?: string
}

/** 補足（opt）を選ぶアクションと、その選択肢。先頭が初期値 */
export const PLAN_ACTION_OPTS: Record<string, { value: string; label: string }[]> = {
  saiyo: [
    { value: 'mfg', label: '製造' },
    { value: 'sales', label: '販売' },
  ],
  haichi: [
    { value: 'mfg->sales', label: '製造→販売' },
    { value: 'sales->mfg', label: '販売→製造' },
  ],
}

/** アクションを選んだ直後の補足。選択肢の無いアクションは undefined */
export function defaultOpt(key: string): string | undefined {
  return PLAN_ACTION_OPTS[key]?.[0].value
}

/** 保存データの補足を、そのアクションの選択肢に収める（知らない値・欠けは初期値） */
function optOf(key: string, opt: unknown): string | undefined {
  const opts = PLAN_ACTION_OPTS[key]
  if (!opts) return undefined
  return opts.some((o) => o.value === opt) ? (opt as string) : opts[0].value
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
function fieldsFor(key: string, qty: number, plan: Plan, opt?: string): Fvals {
  switch (key) {
    case 'shiire':
      return { qty, unit: plan.v } // 仕入単価は計画の売上原価 V
    case 'hanbai':
      return { qty, unit: plan.p } // 売価は計画の販売単価 P
    case 'saiyo':
      // 製造・販売のどちらに採用するかで、後ろの行の製造能力・販売能力が変わる
      return opt === 'sales' ? { sales: qty } : { mfg: qty }
    case 'haichi':
      return { n: qty, dir: opt === 'sales->mfg' ? 'sales->mfg' : 'mfg->sales' }
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
  hireMfg: number // 製造スタッフの採用人数
  hireSales: number // 販売スタッフ（販売員）の採用人数
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
 * 盤面は「期首 ＋ 今期の採用（製造・販売）・機械購入・教育・広告」で組む（教育チップは期をまたがない）。
 */
function planCaps(plan: Plan, st: St) {
  return caps({
    ...st,
    staffMfg: st.openingStaffMfg + plan.hireMfg,
    staffSales: st.openingStaffSales + plan.hireSales,
    machines: st.openingMachines + plan.machinesNew,
    edu: plan.edu,
    ads: st.openingAds + plan.ads,
  })
}

/** 期首の盤面（期首の自動行＝法人税納付・支払金利だけを記帳した状態）。元の st は変えない */
function openingBoard(st: St): St {
  const s: St = {
    ...st,
    tx: st.tx.filter((t) => t.isOpeningTax || t.isOpeningInterest).map((t) => ({ ...t })),
    settled: false,
    closingPrep: false,
  }
  recompute(s)
  return s
}

/**
 * 盤面 s で、そのアクションを1回にできる数量の上限。ルールで決まっているものだけ返し、上限が無ければ null。
 * 記帳のバリデーション（lib/game.ts の `validate()`）と同じ根拠にそろえてある。
 * - 仕入れ：材料在庫の上限（matCap）− いまの材料
 * - 製造：製造能力・材料・店舗陳列の空き（prodCap − 製品）の一番小さいもの。機械か製造スタッフが居なければ 0
 * - 販売：販売能力と製品の小さいほう
 * - 教育：期を通して1枚まで（すでに1枚なら 0）／商品開発：記帳フォームが1回1枚で固定なので 1
 * - 配置転換：移す元のスタッフ数まで
 * - 借入：今期借入可能額まで／返済：借入残高まで
 */
function qtyMaxOn(s: St, key: string, opt?: string): number | null {
  const R = getRules()
  const c = caps(s)
  switch (key) {
    case 'shiire':
      return Math.max(0, R.matCap - s.rawCubes)
    case 'seizo':
      if (s.machines <= 0 || s.staffMfg <= 0) return 0
      return Math.max(0, Math.min(c.mfgCap, s.rawCubes, R.prodCap - s.products))
    case 'hanbai':
      return Math.max(0, Math.min(c.salesCap, s.products))
    case 'kyoiku':
      return Math.max(0, EDU_MAX - s.edu)
    case 'kaihatsu':
      return 1
    case 'haichi':
      return opt === 'sales->mfg' ? s.staffSales : s.staffMfg
    case 'kariire':
      return loanRoom(s)
    case 'hensai':
      return s.loan
    default:
      return null // 機械購入・スタッフ採用・広告・保険はルール上の上限なし
  }
}

/** アクションプラン1行の判定結果 */
export interface PlanActionCheck {
  /** この行より前の行をすべて実施した盤面で、1回にできる数量の上限（上限が無ければ null） */
  max: number | null
  /** 記帳と同じバリデーションで引っかかる理由（空なら記帳できる） */
  errors: string[]
  /** 借入の行：記帳と同じく借入と同時に払う金利（借入額 × 金利）。それ以外は 0 */
  interest: number
}

/**
 * アクションプランを上の行から順に「記帳したことにして」盤面を進め、各行を判定する（issue #102）。
 * 盤面の進め方は記帳と同じ（行を足して `recompute()`）なので、途中の採用・機械購入・広告・教育で後ろの行の上限が上がり、
 * 仕入れ → 製造 → 販売 の順に在庫が流れる。
 * - 上限を超えた行も「計画した内容」として盤面に足す（後ろの行は、その行を実施した前提で判定する。
 *   製造・販売は calc の apply が在庫までしか動かさないので盤面は壊れない）
 * - 数量 0 の行は何もしない（判定もしない）
 * - ルールBの「1ターンに1度」は手番の並びで決まるもので、計画の行には手番が無いので見ない
 */
export function planActionChecks(plan: Plan, st: St): PlanActionCheck[] {
  const s = openingBoard(st)
  return plan.actions.map((a) => {
    const def = a.key ? ACTIONS[a.key] : undefined
    if (!def) return { max: null, errors: [], interest: 0 }
    const max = qtyMaxOn(s, a.key, a.opt)
    if (a.qty <= 0) return { max, errors: [], interest: 0 }
    const f = fieldsFor(a.key, a.qty, plan, a.opt)
    const errors = validate(s, a.key, f)
    s.tx.push({ id: s.seq++, key: a.key, fvals: f, col: def.col, amount: Math.abs(a.amount || 0), noCash: def.noCash })
    recompute(s)
    // 借入金利は recompute が借入行の金額から作る派生行と同じ式（金額 × 金利・四捨五入）
    const interest = a.key === 'kariire' ? Math.round(Math.max(0, a.amount || 0) * getRules().loanRate) : 0
    return { max, errors, interest }
  })
}

/** i 行目の数量を、その行の時点の上限に収める（上限が無ければそのまま。マイナスは 0） */
export function clampRowQty(plan: Plan, st: St, i: number): number {
  const n = Math.max(0, Math.round(plan.actions[i].qty))
  const max = planActionChecks(plan, st)[i].max
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
    hireMfg: 0,
    hireSales: 0,
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
    // 採用は製造・販売に分けて持つ。2026-09-15〜26 の間は合計（hire）だけを保存していたので、
    // その計画は配置先が分からないため製造の採用として読む（固定費の合計は配置先によらず同じ）
    ...(o.hireMfg === undefined && o.hireSales === undefined
      ? { hireMfg: int0(o.hire), hireSales: 0 }
      : { hireMfg: int0(o.hireMfg), hireSales: int0(o.hireSales) }),
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
      const key = actionKey(a)
      const opt = optOf(key, a?.opt)
      return { key, qty: int0(a?.qty), amount: num0(a?.amount), ...(opt ? { opt } : {}) }
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
    // 採用：製造・販売それぞれの採用費と、採用した人の期末給料（給料は配置先によらず同じ単価）
    { key: 'hireMfg', label: '一般管理費', detail: `採用費 ${units.hire} × ${plan.hireMfg}人`, amount: unit('saiyo', { mfg: plan.hireMfg }), col: 'new' },
    { key: 'hireSales', label: '一般管理費', detail: `採用費 ${units.hire} × ${plan.hireSales}人`, amount: unit('saiyo', { sales: plan.hireSales }), col: 'new' },
    {
      key: 'hireSalary',
      label: '人件費',
      detail: `給料 ${sal} × ${plan.hireMfg + plan.hireSales}人`,
      amount: sal * (plan.hireMfg + plan.hireSales),
      col: 'new',
    },
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

export interface CashPlanRow extends PlanActionCheck {
  /** 選ばれている記帳アクションのキー（'' ＝未選択） */
  key: string
  qty: number
  amount: number
  /** この行の入出金までの現金残高（借入金利は含まない） */
  balance: number
  /** 借入金利まで払った後の現金残高（借入の行のみ意味がある。それ以外は balance と同じ） */
  afterInterest: number
}
export interface CashPlan {
  /** 前期繰越残高（期首の現金） */
  openingCash: number
  /** 期首処理（法人税納付・支払金利）。期首の自動行の合計をマイナスで */
  openingAuto: number
  rows: CashPlanRow[]
}

/**
 * 7. アクションプラン：前期繰越残高 → 期首処理 → 各行の入出金（借入の行は借入金利も）の順に現金残高を累計する。
 * 各行の上限と記帳できない理由は `planActionChecks()` で出す。
 * 期首処理は記帳済みの自動行（法人税納付・支払金利）の金額をそのまま使う。
 * 期末処理（給料・家賃・元本返済）はアクションプランには載せない。
 */
export function cashPlan(plan: Plan, st: St): CashPlan {
  const openingAuto = -st.tx
    .filter((t) => t.isOpeningTax || t.isOpeningInterest)
    .reduce((s, t) => s + (t.amount || 0), 0)
  let bal = st.openingCash + openingAuto
  const checks = planActionChecks(plan, st)
  const rows = plan.actions.map((a, i) => {
    bal += a.amount || 0
    const balance = bal
    // 借入の行は、記帳と同じく借入金利（前払い）をすぐ払う。画面では借入行の下に金利の行として出す
    bal -= checks[i].interest
    return { key: a.key, qty: a.qty, amount: a.amount || 0, balance, afterInterest: bal, ...checks[i] }
  })
  return { openingCash: st.openingCash, openingAuto, rows }
}

/** 2. の下に出す能力の比較の1行（製造能力・販売能力） */
/** 能力の比較の内訳の1段（投資を1つ足したときに能力がいくつ増えるか） */
export interface CapacityStep {
  key: string
  /** 何をしたか（例：製造スタッフを 2人採用） */
  label: string
  /** この投資で増えた個数 */
  delta: number
  /** この投資まで足したときの能力 */
  after: number
  /** 増え方の根拠。思ったほど増えないときはその理由（機械が足りない など） */
  note: string
  /** 投資したのに増え方が上限で頭打ちになったか（画面で注意の色にする） */
  limited: boolean
}

/** 2. の下に出す能力の比較の1行（製造能力・販売能力） */
export interface CapacityRow {
  key: 'mfg' | 'sales'
  label: string
  /** 期首の盤面での1回あたりの能力 */
  open: number
  /** 戦略的投資を全部実施したときに増える分（total − open） */
  add: number
  /** 投資を全部実施したときの1回あたりの最大 */
  total: number
  /** 根拠（人数・台数・チップ） */
  openDetail: string
  totalDetail: string
  /** 投資ごとの内訳。入力した投資だけ、ゲームの流れ順（採用と機械 → 教育／採用 → 広告）に足していく */
  steps: CapacityStep[]
}

/**
 * 2. 固定費の下に出す「期首の能力」と「戦略的投資を全部実施したときの能力」の比較。
 * 能力の式は calc の `caps()` をそのまま使う（式を二重に持たない）。
 *
 * - 期首：期首のスタッフ・機械・広告チップ。教育チップは期をまたがないので 0 枚
 * - 投資後：製造・販売それぞれの採用、機械購入・教育・広告を足した盤面（`planCaps()` と同じ）
 * - 内訳：能力の式には上限（機械1台で作業できるのは2人まで、広告は販売スタッフ1人につき2枚まで効く）があり、
 *   投資の効果は足し算にならない。そこで投資を**ゲームの流れ順に1つずつ足し**、そのたびに増えた個数を出す
 *   （製造：採用と機械はセットで効くので1段にまとめる → 教育、販売：採用 → 広告）。各段の増分の合計は必ず total − open になる。
 *   上限で思ったほど増えない段・機械が余る段には理由を付ける（判定は両方を足した後の盤面で行う）
 */
export function capacityCompare(plan: Plan, st: St): CapacityRow[] {
  type Board = St
  const open: Board = {
    ...st,
    staffMfg: st.openingStaffMfg,
    staffSales: st.openingStaffSales,
    machines: st.openingMachines,
    edu: 0,
    ads: st.openingAds,
  }
  const c0 = caps(open)
  const c1 = planCaps(plan, st)

  // ---- 製造：（採用・機械）→ 教育 ----
  // 製造スタッフと機械はセットで効く（機械1台で作業できるのは2人まで）。別々の段にすると
  // 「採用の段では機械が足りない」「機械の段ではスタッフが足りない」と両方が不足に見えてしまうので、1つの段にまとめ、
  // 足りない／余るかは両方を足した後の盤面で判定する
  const mfgSteps: CapacityStep[] = []
  let b = open
  let cur = c0.mfgCap
  const addMfg = (key: string, label: string, next: Board, note: (delta: number, nb: Board) => { note: string; limited: boolean }) => {
    const after = caps(next).mfgCap
    const delta = after - cur
    mfgSteps.push({ key, label, delta, after, ...note(delta, next) })
    b = next
    cur = after
  }
  if (plan.hireMfg > 0 || plan.machinesNew > 0) {
    const parts = [
      plan.hireMfg > 0 ? `製造スタッフを ${plan.hireMfg}人採用` : '',
      plan.machinesNew > 0 ? `機械を ${plan.machinesNew}台購入` : '',
    ].filter(Boolean)
    addMfg(
      'staffMachines',
      parts.join('・'),
      { ...b, staffMfg: b.staffMfg + plan.hireMfg, machines: b.machines + plan.machinesNew },
      (_delta, nb) => {
        const slots = nb.machines * 2 // 機械で作業できる人数の上限
        const workers = Math.min(nb.staffMfg, slots)
        const enough = Math.ceil(nb.staffMfg / 2) // 製造スタッフ全員が作業するのに要る台数
        if (nb.staffMfg > slots) {
          // 人が余る：あと何台あれば全員が作業できるか
          const more = enough - nb.machines
          return {
            note: `機械が足りません。機械1台で作業できるのは2人まで（機械 ${nb.machines}台 → ${slots}人）。あと ${more}台で製造スタッフ ${nb.staffMfg}人全員が作業できます`,
            limited: true,
          }
        }
        if (plan.machinesNew > 0 && slots - nb.staffMfg >= 2) {
          // 機械が丸ごと1台以上遊ぶ：今期の購入は何台で足りたか
          const needBuy = Math.max(0, enough - st.openingMachines)
          return plan.hireMfg > 0 || needBuy > 0
            ? {
                note: `機械が余ります。製造スタッフ ${nb.staffMfg}人なら機械は ${enough}台で足ります（今期の購入は ${needBuy}台で十分）`,
                limited: true,
              }
            : { note: `製造スタッフが足りません。機械を買っても作業する人がいません（製造スタッフ ${nb.staffMfg}人 → 機械 ${enough}台で足ります）`, limited: true }
        }
        return { note: `作業する人 ${workers}人 × ${nb.edu > 0 ? 3 : 2}個（機械 ${nb.machines}台で ${slots}人まで作業できる）`, limited: false }
      },
    )
  }
  if (plan.edu > 0)
    addMfg('edu', '教育チップを使う', { ...b, edu: plan.edu }, (_delta, nb) => {
      const workers = Math.min(nb.staffMfg, nb.machines * 2)
      return workers > 0
        ? { note: `作業する人 ${workers}人 × 1個（1人あたり 2個 → 3個）`, limited: false }
        : { note: '作業できる製造スタッフがいないので増えません', limited: true }
    })

  // ---- 販売：採用 → 広告 ----
  const salesSteps: CapacityStep[] = []
  let sb = open
  let scur = c0.salesCap
  const addSales = (key: string, label: string, next: Board, note: (delta: number, nb: Board) => { note: string; limited: boolean }) => {
    const after = caps(next).salesCap
    const delta = after - scur
    salesSteps.push({ key, label, delta, after, ...note(delta, next) })
    sb = next
    scur = after
  }
  if (plan.hireSales > 0)
    addSales('hireSales', `販売員を ${plan.hireSales}人採用`, { ...sb, staffSales: sb.staffSales + plan.hireSales }, (delta) => {
      const base = plan.hireSales * 2
      // 期首の広告が人数の上限で効いていなかった分が、採用で効くようになることがある
      return { note: delta > base ? `1人あたり 2個 ＋ 効くようになった広告 ${delta - base}個` : '1人あたり 2個', limited: false }
    })
  if (plan.ads > 0)
    addSales('ads', `広告を ${plan.ads}枚`, { ...sb, ads: sb.ads + plan.ads }, (delta, nb) => {
      const cap = nb.staffSales * 2 // 広告が効く枚数の上限
      return delta < plan.ads * 2
        ? { note: `広告は販売スタッフ1人につき2枚まで効きます（販売スタッフ ${nb.staffSales}人 → ${cap}枚まで）`, limited: true }
        : { note: '1枚あたり 2個', limited: false }
    })

  const mfgDetail = (staff: number, machines: number, edu: number) =>
    `製造スタッフ ${staff}人・機械 ${machines}台${edu > 0 ? '・教育チップあり' : ''}`
  const salesDetail = (staff: number, ads: number) => `販売スタッフ ${staff}人・広告 ${ads}枚`
  return [
    {
      key: 'mfg',
      label: '製造能力',
      open: c0.mfgCap,
      add: c1.mfgCap - c0.mfgCap,
      total: c1.mfgCap,
      openDetail: mfgDetail(open.staffMfg, open.machines, 0),
      totalDetail: mfgDetail(open.staffMfg + plan.hireMfg, open.machines + plan.machinesNew, plan.edu),
      steps: mfgSteps,
    },
    {
      key: 'sales',
      label: '販売能力',
      open: c0.salesCap,
      add: c1.salesCap - c0.salesCap,
      total: c1.salesCap,
      openDetail: salesDetail(open.staffSales, open.ads),
      totalDetail: salesDetail(open.staffSales + plan.hireSales, open.ads + plan.ads),
      steps: salesSteps,
    },
  ]
}

/** 計画の実施に必要な現金の1項目 */
export interface CashNeedItem {
  key: 'opening' | 'buy' | 'fixed' | 'machine' | 'repay'
  label: string
  detail: string
  amount: number
}
export interface CashNeeds {
  items: CashNeedItem[]
  /** 当期に出ていく現金の合計 */
  total: number
  /** 前期から繰り越した現金（期首の現金） */
  openingCash: number
  /** 今期あらたに借入する金額（2. 固定費の戦略的投資で入れた額）。入金として使える現金に足す */
  loanIn: number
  /** openingCash ＋ loanIn − total。マイナスなら売上の入金前に足りなくなる額（さらに借入などが必要） */
  diff: number
  /** 売上高 PQ。Q が出せないときは null */
  sales: number | null
  /** 期末の現金の見込み ＝ openingCash ＋ loanIn − total ＋ 売上高。Q が出せないときは null */
  endCash: number | null
}

/**
 * 計画の STRAC 図の後に出す「このプランの実施に必要な現金」＝ 当期に出ていく現金の全部。
 * 前期から繰り越した現金と比べる。
 *
 * - 期首処理：記帳済みの期首の自動行（法人税の納付・期首の借入金の金利。`cashPlan()` と同じ）
 * - 仕入代：期首の材料・製品で足りない個数（Q − 期首の材料在庫。`actionNeeds()` と同じ）× 計画の売上原価 V
 * - 固定費：F のうち現金で出ていく分。減価償却は現金が出ないので除き、期首の借入金の金利は期首処理の行に入れたので除く
 * - 機械代：機械購入台数 × 機械の価格（記帳アクションの amount と同じ式）
 * - 元本返済：期末に返す額。期末処理（calc の `closingRepay()`）と同じ「(期首の借入残高 ＋ 今期あらたに借入する金額) × 返済率」（残高が上限）
 *
 * 売上の入金は販売した後なので、合計とは別に「期末の現金の見込み」として足して見せる。
 */
export function cashNeeds(plan: Plan, st: St): CashNeeds {
  const R = getRules()
  const fig = planFigures(plan, st)
  const fc = fixedCosts(plan, st)
  const tax = st.tx.filter((t) => t.isOpeningTax).reduce((sum, t) => sum + (t.amount || 0), 0)
  const interest = st.tx.filter((t) => t.isOpeningInterest).reduce((sum, t) => sum + (t.amount || 0), 0)
  const buyQty = fig.Q == null ? 0 : Math.max(0, fig.Q - st.openingMatQty)
  const amt = (key: string) => fc.items.find((x) => x.key === key)?.amount ?? 0
  const dep = amt('dep') + amt('depNew')
  // 期末処理（calc の closingRepay()）と同じく、期中に借りる分（今期あらたに借入する金額）にも元本返済が発生する
  const loanBase = st.openingLoan + plan.loanNew
  const repay = Math.min(Math.round((loanBase * st.repayRate) / 100), loanBase)
  const items: CashNeedItem[] = [
    {
      key: 'opening',
      label: '期首処理',
      detail: `法人税の納付 ${tax} ＋ 期首の借入金の金利 ${interest}`,
      amount: tax + interest,
    },
    {
      key: 'buy',
      label: '仕入代',
      detail: fig.Q == null ? '売上必要個数（Q）が未確定です' : `仕入 ${buyQty}個 × 売上原価 V ${plan.v}`,
      amount: buyQty * plan.v,
    },
    {
      key: 'fixed',
      label: '固定費',
      detail: `F ${fc.total} − 減価償却 ${dep} − 期首の金利 ${amt('intOpen')}（期首処理に含む）`,
      amount: fc.total - dep - amt('intOpen'),
    },
    {
      key: 'machine',
      label: '機械代',
      detail: `${plan.machinesNew}台 × ${R.machinePrice}`,
      amount: plan.machinesNew > 0 ? ACTIONS.kikai.amount({ n: plan.machinesNew }) : 0,
    },
    {
      key: 'repay',
      label: '元本返済',
      detail:
        st.period <= 1
          ? '第1期は借入なし'
          : `(期首の借入金 ${st.openingLoan} ＋ 今期の借入 ${plan.loanNew}) × 返済率 ${st.repayRate}%`,
      amount: repay,
    },
  ]
  const total = items.reduce((sum, x) => sum + x.amount, 0)
  // 今期借りる予定の額は使える現金に入るので、不足から差し引く（借入の予定を入れれば不足が減る）
  const diff = st.openingCash + plan.loanNew - total
  return {
    items,
    total,
    openingCash: st.openingCash,
    loanIn: plan.loanNew,
    diff,
    sales: fig.PQ,
    endCash: fig.PQ == null ? null : diff + fig.PQ,
  }
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
 *   盤面は「期首 ＋ 今期の採用（製造・販売）・機械購入・教育・広告」で組む。教育チップは期をまたがないので計画の枚数がそのまま効く。
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
  if (plan.hireMfg + plan.hireSales > 0)
    push('saiyo', 1, `製造 ${plan.hireMfg}人・販売 ${plan.hireSales}人（1回でまとめて実施）`)
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

/** 計画アクションの計画回数と、今期に記帳した回数 */
export interface ProgressAction {
  key: string
  label: string
  plan: number
  done: number
}

/** 計画と今の見込みで違う前提（固定費・販売単価・仕入単価）。目標 G までの粗利にどう効くかを出す */
export interface GuideFactor {
  key: 'F' | 'P' | 'V'
  label: string
  plan: number
  now: number
  /** now − plan */
  diff: number
  /** 目標 G に対して有利か（固定費・仕入単価は少ないほど、販売単価は高いほど有利）。差が 0 なら null */
  good: boolean | null
  /** 何が起きていて、どうすればよいか */
  note: string
}

/**
 * 進捗タブ（管理会計の指針）：目標 G を達成するために、今の見込みで何をすればよいか。
 *
 * - 今の盤面のまま期末を迎えた場合の粗利・固定費は、決算そのもの（calc の `settle()`）を盤面の写しで走らせて出す（式を二重に持たない）
 * - 固定費の見込み ＝ その固定費 ＋ 計画に入れたのにまだ実施していない投資の固定費（採用・機械・チップ・借入の金利。`fixedCosts()` と同じ式）
 * - 必要な粗利 MQ ＝ 目標 G ＋ 固定費の見込み。そこから今までに稼いだ粗利を引いた残りを、これからの販売で稼ぐ
 * - これからの1個あたりの粗利 M ＝ 販売単価の見込み − 仕入単価の見込み
 *   販売単価の見込みは今期の販売の平均（売上高 ÷ 売上個数）、仕入単価の見込みは今期の仕入の平均（仕入金額の合計 ÷ 仕入個数）。
 *   まだ販売・仕入が無ければ計画の P・V
 */
export interface Guide {
  targetG: number
  /** 固定費：計画 ／ 今の盤面で期末を迎えた場合 ／ 計画のうち未実施の投資の分 ／ 見込み（＝後の2つの合計） */
  fPlan: number
  fNow: number
  fRemain: number
  fForecast: number
  /** 未実施の投資の内訳（例：販売費 10 × 2枚） */
  remainItems: { label: string; detail: string; amount: number }[]
  /** 今までに稼いだ粗利（今の盤面で決算した場合の mPQ） */
  mqDone: number
  /** 目標 G に必要な粗利 ＝ 目標 G ＋ 固定費の見込み */
  needMQ: number
  /** これからの販売で稼ぐ粗利 ＝ needMQ − mqDone（0 以下なら達成見込み） */
  remainMQ: number
  p: { plan: number; now: number; from: 'sales' | 'plan' }
  v: { plan: number; now: number; from: 'buy' | 'plan'; buyAmt: number; buyQty: number }
  /** これからの1個あたりの粗利（p.now − v.now） */
  m: number
  planQ: number
  soldQ: number
  /** 計画の残り個数（計画の Q − 売上個数） */
  planRemainQ: number
  /** 打ち手①：今の単価のまま、あと何個売れば目標 G に届くか（M ≦ 0 なら null） */
  needQ: number | null
  /** 打ち手②：計画の残り個数のまま、平均いくら以上で売れば届くか（計画の残りが 0 なら null） */
  needP: number | null
  /** 計画の残り個数を今の単価で売った場合の G */
  gIfPlan: number
  /** achieved＝今の時点で届く／onTrack＝計画の残りを今の単価で売れば届く／short＝このままでは届かない */
  status: 'achieved' | 'onTrack' | 'short'
  factors: GuideFactor[]
  salesCap: number
  /** needQ を今の販売能力で売るのに要る販売の回数（能力 0 なら null） */
  salesTimes: number | null
  cash: number
  actions: ProgressAction[]
  plannedTotal: number
  doneTotal: number
}

/** 記帳行の個数（仕入・販売は複数行 items の合計、製造は qty） */
function rowQty(f: Fvals | undefined): number {
  if (!f) return 0
  if (Array.isArray(f.items)) return f.items.reduce((s: number, it: Fvals) => s + (Number(it?.qty) || 0), 0)
  return Number(f.qty) || 0
}

/** 今の盤面のまま期末を迎えた場合の決算。盤面の写しで決算を走らせる（本物の盤面は変えない）。決算済みならその結果 */
function closeNow(st: St): Result | null {
  if (st.settled) return st.result
  return settle(structuredClone(st))
}

/** 今期に記帳した投資の量（計画の戦略的投資と同じ単位） */
function investedSoFar(st: St) {
  const sum = (key: string, field: string) =>
    st.tx.filter((t) => t.key === key).reduce((s, t) => s + (Number(t.fvals?.[field]) || 0), 0)
  return {
    hireMfg: sum('saiyo', 'mfg'),
    hireSales: sum('saiyo', 'sales'),
    machinesNew: sum('kikai', 'n'),
    edu: sum('kyoiku', 'n'),
    ins: sum('hoken', 'n'),
    ads: sum('koukoku', 'n'),
    dev: sum('kaihatsu', 'n'),
    loanNew: sum('kariire', 'a'),
  }
}

export function progressNow(plan: Plan, st: St): Guide | null {
  const fig = planFigures(plan, st)
  if (fig.Q == null || fig.PQ == null || fig.VQ == null) return null
  const res = closeNow(st)
  const mqDone = res ? res.mPQ : 0
  const fNow = res ? res.F : 0

  // 計画に入れたのに、まだ記帳していない投資。その固定費を見込みに足す
  const done = investedSoFar(st)
  const rest: Plan = { ...defaultPlan() }
  for (const k of ['hireMfg', 'hireSales', 'machinesNew', 'edu', 'ins', 'ads', 'dev', 'loanNew'] as const)
    rest[k] = Math.max(0, plan[k] - done[k])
  const restFc = fixedCosts(rest, st)
  const remainItems = restFc.items
    .filter((x) => x.col === 'new' && x.amount > 0)
    .map((x) => ({ label: x.label, detail: x.detail, amount: x.amount }))
  const fRemain = restFc.next
  const fForecast = fNow + fRemain

  // これからの単価の見込み：今期の実績があればその平均、無ければ計画の値
  const buyQty = st.tx.filter((t) => t.key === 'shiire').reduce((s, t) => s + rowQty(t.fvals), 0)
  const buyAmt = st.tx.filter((t) => t.key === 'shiire').reduce((s, t) => s + (t.amount || 0), 0)
  const pNow = st.salesQty > 0 ? Math.round((st.salesAmt / st.salesQty) * 10) / 10 : plan.p
  const vNow = buyQty > 0 ? Math.round((buyAmt / buyQty) * 10) / 10 : plan.v
  const m = Math.round((pNow - vNow) * 10) / 10

  const needMQ = plan.g + fForecast
  const remainMQ = needMQ - mqDone
  const planRemainQ = Math.max(0, fig.Q - st.salesQty)
  const needQ = remainMQ <= 0 ? 0 : m > 0 ? Math.ceil(remainMQ / m) : null
  const needP = remainMQ <= 0 || planRemainQ === 0 ? null : Math.ceil(vNow + remainMQ / planRemainQ)
  const gIfPlan = Math.round(mqDone + planRemainQ * m - fForecast)
  const status = remainMQ <= 0 ? 'achieved' : gIfPlan >= plan.g ? 'onTrack' : 'short'

  // 計画との前提の違い。粗利単価で割って「何個分」に直して見せる
  const units = (money: number) => (m > 0 ? `約 ${Math.ceil(Math.abs(money) / m)}個分` : '')
  const fDiff = fForecast - fig.F
  const pDiff = Math.round((pNow - plan.p) * 10) / 10
  const vDiff = Math.round((vNow - plan.v) * 10) / 10
  const factors: GuideFactor[] = [
    {
      key: 'F',
      label: '固定費 F',
      plan: fig.F,
      now: fForecast,
      diff: fDiff,
      good: fDiff === 0 ? null : fDiff < 0,
      note:
        fDiff > 0
          ? `計画より ${fDiff} 多い。その分の粗利を余分に稼ぐ必要があります（今の粗利単価で${units(fDiff)}）`
          : fDiff < 0
            ? `計画より ${-fDiff} 少ない。その分、必要な粗利が減ります（${units(fDiff)}）`
            : '計画どおり',
    },
    {
      key: 'P',
      label: '販売単価 P',
      plan: plan.p,
      now: pNow,
      diff: pDiff,
      good: pDiff === 0 ? null : pDiff > 0,
      note:
        pDiff > 0
          ? `計画より ${pDiff} 高い。1個あたりの粗利が増えるので、売る個数は計画より少なくて済みます`
          : pDiff < 0
            ? `計画より ${-pDiff} 低い。1個あたりの粗利が減るので、単価を戻すか個数を増やす必要があります`
            : st.salesQty > 0
              ? '計画どおり'
              : 'まだ販売が無いので計画の値',
    },
    {
      key: 'V',
      label: '仕入単価 V',
      plan: plan.v,
      now: vNow,
      diff: vDiff,
      good: vDiff === 0 ? null : vDiff < 0,
      note:
        vDiff > 0
          ? `計画より ${vDiff} 高い。1個あたりの粗利が減るので、安く仕入れるか単価・個数を上げる必要があります`
          : vDiff < 0
            ? `計画より ${-vDiff} 安い。1個あたりの粗利が増えます`
            : buyQty > 0
              ? '計画どおり'
              : 'まだ仕入が無いので計画の値',
    },
  ]

  // アクションの計画回数と実施回数（ルールA・Bのアクションだけ。`planVsActual()` と同じ数え方）
  const planned = new Map<string, number>()
  for (const a of plan.actions) if (a.key) planned.set(a.key, (planned.get(a.key) ?? 0) + 1)
  const doneCnt = new Map<string, number>()
  for (const t of st.tx) if (t.key && PLAN_ACTION_KEYS.includes(t.key)) doneCnt.set(t.key, (doneCnt.get(t.key) ?? 0) + 1)
  const actions = PLAN_ACTION_KEYS.filter((k) => planned.has(k) || doneCnt.has(k)).map((k) => ({
    key: k,
    label: ACTIONS[k].label,
    plan: planned.get(k) ?? 0,
    done: doneCnt.get(k) ?? 0,
  }))
  const salesCap = caps(st).salesCap
  return {
    targetG: plan.g,
    fPlan: fig.F,
    fNow,
    fRemain,
    fForecast,
    remainItems,
    mqDone,
    needMQ,
    remainMQ,
    p: { plan: plan.p, now: pNow, from: st.salesQty > 0 ? 'sales' : 'plan' },
    v: { plan: plan.v, now: vNow, from: buyQty > 0 ? 'buy' : 'plan', buyAmt, buyQty },
    m,
    planQ: fig.Q,
    soldQ: st.salesQty,
    planRemainQ,
    needQ,
    needP,
    gIfPlan,
    status,
    factors,
    salesCap,
    salesTimes: needQ == null ? null : needQ === 0 ? 0 : salesCap > 0 ? Math.ceil(needQ / salesCap) : null,
    cash: cashNow(st),
    actions,
    // 計画に入れた回数を上限に数える（計画より多くやった分・計画外のアクションは「消化」に入れない）
    plannedTotal: actions.reduce((s, a) => s + a.plan, 0),
    doneTotal: actions.reduce((s, a) => s + Math.min(a.plan, a.done), 0),
  }
}
