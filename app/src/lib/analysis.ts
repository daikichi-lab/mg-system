// 第4表 MG経営戦略分析表（業績アップ・経営計画）と、損益分岐点比率（f/m比率）による S〜DD の評価。
//
// 紙の様式の「実績／計画」を期ごとに並べる表と、その右側のグラフ用紙（純資産・シェア・f/m比率）の数字を作る。
// 実績は決算（Result）、計画はその期の経営計画書（plan.ts の planFigures）から取る。式は二重に持たない。
// 画面（ui/AnalysisCard.tsx）はここで作った値を並べるだけにする。issue #109
import { newState, type Result, type St } from './calc.ts'
import { normalizePlan, planFigures, stateAtPeriod } from './plan.ts'

/** 評価の段階。損益分岐点比率が低いほど良い */
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'DD'

/**
 * 評価の基準（様式のグラフ用紙の右に印刷されている区分）。上から良い順。
 * max は「この % 以下ならこの評価」。比率は整数に丸めてから当てはめる（fmRatio() と同じ丸め）。
 * 様式の C は「90〜99%」、D は「100%以上」・DD は「200%以上」なので、D は 100〜199%。
 */
export const GRADES: { grade: Grade; name: string; range: string; max: number }[] = [
  { grade: 'S', name: '超優良', range: '59%以下', max: 59 },
  { grade: 'A', name: '優良企業', range: '60〜79%', max: 79 },
  { grade: 'B', name: '普通企業', range: '80〜89%', max: 89 },
  { grade: 'C', name: '危険企業', range: '90〜99%', max: 99 },
  { grade: 'D', name: '赤字企業', range: '100%以上', max: 199 },
  { grade: 'DD', name: '倒産路線企業', range: '200%以上', max: Infinity },
]

/**
 * 損益分岐点比率（f/m比率）＝ 固定費 F ÷ 粗利 MQ × 100（整数に丸める）。
 * 粗利が 0 以下だと割れない（固定費をまったく賄えない）ので null を返す。評価は gradeOf() が DD にする。
 */
export function bepRatio(MQ: number, F: number): number | null {
  return MQ > 0 ? Math.round((F / MQ) * 100) : null
}

/**
 * 比率から評価を決める。
 * - 比率が出ない（粗利 0 以下）とき：固定費があれば DD（固定費をまったく賄えない）、固定費も無ければ評価しない（null）
 */
export function gradeOf(ratio: number | null, F: number): Grade | null {
  if (ratio == null) return F > 0 ? 'DD' : null
  return GRADES.find((g) => ratio <= g.max)!.grade
}

/** 表の1列（ある期の実績、または計画）。様式の丸数字の順。出せない値は null（画面では「—」） */
export interface AnalysisCol {
  /** ① 平均単価 P */
  P: number | null
  /** ② 変動単価 V（vP） */
  V: number | null
  /** ③ 付加価値単価 M（mP）＝ P − V */
  M: number | null
  /** ④ 売上個数 Q */
  Q: number | null
  /** ④ のシェア（%・小数1桁）＝ 自分の売上個数 ÷ 研修の全社の売上個数 × 100 */
  share: number | null
  /** ⑤ 売上高 PQ */
  PQ: number | null
  /** ⑥ 売上原価（変動費）VQ */
  VQ: number | null
  /** ⑦ 売上総利益（付加価値）MQ */
  MQ: number | null
  /** ⑧ 固定費 F */
  F: number | null
  /** ⑨ 経常利益 G */
  G: number | null
  /** ⑩ 負債（B/S：未払法人税＋借入金） */
  debt: number | null
  /** ⑪ 純資産（B/S：資本金＋利益剰余金） */
  equity: number | null
  /** ⑫ 損益分岐点比率（%） */
  ratio: number | null
  /** ⑫ 評価 */
  grade: Grade | null
}

export interface AnalysisRow {
  period: number
  /** 決算が無い期は null */
  actual: AnalysisCol | null
  /** 経営計画書が無い・単価が未記入で個数が出ない期は null */
  plan: AnalysisCol | null
}

/**
 * 研修の他社の売上個数。期番号 → 会社名ごとの売上個数。
 * 組織 API（/api/org/:code）の results から作る。取れなかったときは空でよい（シェアが「—」になるだけ）。
 */
export type OrgQ = Map<number, Map<string, number>>

/** 組織 API の会社一覧から OrgQ を作る。results は決算（Result）の JSON */
export function orgQOf(companies: { name: string; results?: { period?: unknown; Q?: unknown }[] }[]): OrgQ {
  const out: OrgQ = new Map()
  for (const c of companies)
    for (const r of c.results || []) {
      const p = Number(r.period)
      const q = Number(r.Q)
      if (!Number.isFinite(p) || !Number.isFinite(q)) continue
      if (!out.has(p)) out.set(p, new Map())
      out.get(p)!.set(c.name, q)
    }
  return out
}

/**
 * シェア（%・小数1桁）。分母は「その期に決算した研修の全社の売上個数の合計」。
 * 自社の値は手元の決算で上書きする（決算直後で組織 API にまだ載っていない場合があるため）。
 * 他社のデータが無い（研修に参加していない・取得できない）ときは null。自社だけでも 100% と出すと誤解を招くので出さない。
 */
export function shareOf(period: number, myName: string, myQ: number, orgQ: OrgQ | null): number | null {
  const all = new Map(orgQ?.get(period) ?? [])
  all.set(myName, myQ)
  if (all.size < 2) return null
  const total = [...all.values()].reduce((s, q) => s + q, 0)
  return total > 0 ? Math.round((myQ / total) * 1000) / 10 : null
}

/** 決算から実績の列を作る。単価は決算の合計から割り戻す（planVsActual・決算書の STRAC 図と同じ出し方） */
export function actualCol(r: Result, share: number | null): AnalysisCol {
  const P = r.Q ? Math.round(r.PQ / r.Q) : null
  const V = r.Q ? Math.round(r.vPQ / r.Q) : null
  const ratio = bepRatio(r.mPQ, r.F)
  return {
    P,
    V,
    M: P != null && V != null ? P - V : null,
    Q: r.Q,
    share,
    PQ: r.PQ,
    VQ: r.vPQ,
    MQ: r.mPQ,
    F: r.F,
    G: r.G,
    debt: r.tax + r.loanEnd,
    equity: r.capEnd + r.retEnd,
    ratio,
    grade: gradeOf(ratio, r.F),
  }
}

/**
 * その期の経営計画書から計画の列を作る。
 * 経営計画書に無い項目（シェア・負債・純資産）は null。単価が未記入で必要販売数が出ない計画は列ごと null。
 * 計画の固定費は計画を書いたときの期首の盤面で決まるので、stateAtPeriod() で組み直してから planFigures() を通す。
 */
export function planCol(period: number, plans: Record<string, unknown>, history: Result[], base: St): AnalysisCol | null {
  const saved = plans[String(period)]
  if (!saved) return null
  const st = period === base.period ? base : stateAtPeriod(period, history, base)
  if (!st) return null
  const plan = normalizePlan(saved)
  const fig = planFigures(plan, st)
  if (fig.Q == null || fig.PQ == null || fig.VQ == null) return null
  const MQ = fig.PQ - fig.VQ
  const ratio = bepRatio(MQ, fig.F)
  return {
    P: plan.p,
    V: plan.v,
    M: plan.p - plan.v,
    Q: fig.Q,
    share: null,
    PQ: fig.PQ,
    VQ: fig.VQ,
    MQ,
    F: fig.F,
    G: MQ - fig.F,
    debt: null,
    equity: null,
    ratio,
    grade: gradeOf(ratio, fig.F),
  }
}

/**
 * 第4表の全体。第1期から「決算のある最後の期」と「今の期」の遅いほうまで、期ごとに実績と計画を並べる。
 * 今の期は決算前でも計画だけ出す（計画を立てて記帳している最中に見比べられるように）。
 */
export function analysisTable(
  history: Result[],
  plans: Record<string, unknown>,
  base: St,
  orgQ: OrgQ | null,
): AnalysisRow[] {
  const last = Math.max(base.period, ...history.map((r) => r.period))
  const rows: AnalysisRow[] = []
  for (let p = 1; p <= last; p++) {
    const r = history.find((h) => h.period === p)
    rows.push({
      period: p,
      actual: r ? actualCol(r, shareOf(p, base.name, r.Q, orgQ)) : null,
      plan: planCol(p, plans, history, base),
    })
  }
  return rows
}

/**
 * 管理画面用：研修の会社1社分の第4表（組織 API の会社データから作る）。issue #111
 * 参加者アプリのような「今の盤面」は持たないので、計画の期首の盤面はすべて前の期の決算から組み直す
 * （base.period を 0 にして planCol() が必ず stateAtPeriod() を通るようにする）。
 * 並べる期は第1期から「決算のある最後の期」と「その会社の今の期」の遅いほうまで。
 * 計画の固定費は数値ルールで決まるので、呼び出し側でその研修のルールを setRules() しておくこと。
 */
export function companyAnalysis(
  c: { name: string; period?: number; results?: unknown[]; plans?: Record<string, unknown> },
  orgQ: OrgQ | null,
): AnalysisRow[] {
  const history = (c.results || []) as Result[]
  const base = newState()
  base.name = c.name
  base.period = 0
  const last = Math.max(Number(c.period) || 0, ...history.map((r) => r.period))
  const rows: AnalysisRow[] = []
  for (let p = 1; p <= last; p++) {
    const r = history.find((h) => h.period === p)
    rows.push({
      period: p,
      actual: r ? actualCol(r, shareOf(p, c.name, r.Q, orgQ)) : null,
      plan: planCol(p, c.plans || {}, history, base),
    })
  }
  return rows
}
