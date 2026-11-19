// 振り返りタブの「第4表 MG経営戦略分析表」・推移グラフ（純資産・シェア・f/m比率）・S〜DD の評価表。issue #109
//
// 紙の様式（第4表と右側のグラフ用紙）を画面に起こしたもの。数字はすべて lib/analysis.ts で作り、ここは並べるだけ。
// シェアは研修の他社の決算が要るので、組織 API を読み込んでから出す（読めないときは「—」のまま）。
import { useEffect, useState } from 'react'
import { fmtA, type Result, type St } from '../lib/calc'
import { analysisTable, GRADES, orgQOf, type AnalysisCol, type AnalysisRow, type Grade, type OrgQ } from '../lib/analysis'
import type { ApiOrgCompany } from '../lib/api'

/** 評価ごとの色（文字・帯）。良い順に 緑 → 青緑 → 青 → 黄 → 橙 → 赤 */
export const GRADE_COLOR: Record<Grade, { fg: string; bg: string }> = {
  S: { fg: '#15803d', bg: '#e8f5ec' },
  A: { fg: '#0f766e', bg: '#e6f4f2' },
  B: { fg: '#2f6fe0', bg: '#eaf1fd' },
  C: { fg: '#a16207', bg: '#fdf6e0' },
  D: { fg: '#c2410c', bg: '#fdeee6' },
  DD: { fg: '#a02620', bg: '#fbe9e8' },
}

/** グラフの横軸は様式と同じく第1期〜第5期。5期を超えて進めた場合はその期まで伸ばす */
const MIN_PERIODS = 5

/** 値の表示。出せない値は「—」、マイナスは ▲ */
export const show = (v: number | null | undefined, unit = '') => (v == null ? '—' : `${fmtA(v)}${unit}`)
/** シェアは小数1桁まで（lib/analysis.ts の shareOf と同じ桁） */
export const showShare = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`)

/** 表の1行の定義：区分・丸数字・項目名・値の取り出し方 */
export interface Line {
  group: string
  no: string
  label: string
  sub?: string
  get: (c: AnalysisCol) => number | null
  unit?: string
  /** 表示の仕方を変えるとき（シェアの小数1桁） */
  fmt?: (v: number | null) => string
}
export const LINES: Line[] = [
  { group: 'コスト構造', no: '①', label: '平均単価', sub: 'P', get: (c) => c.P },
  { group: 'コスト構造', no: '②', label: '変動単価', sub: 'vP（V）', get: (c) => c.V },
  { group: 'コスト構造', no: '③', label: '付加価値単価', sub: 'mP（M）', get: (c) => c.M },
  { group: '', no: '④', label: '売上個数', sub: 'Q', get: (c) => c.Q },
  { group: '', no: '', label: 'シェア', get: (c) => c.share, fmt: showShare },
  { group: '収益構造', no: '⑤', label: '売上高', sub: 'PQ', get: (c) => c.PQ },
  { group: '収益構造', no: '⑥', label: '売上原価（変動費）', sub: 'vPQ（VQ）', get: (c) => c.VQ },
  { group: '収益構造', no: '⑦', label: '売上総利益（付加価値）', sub: 'mPQ（MQ）', get: (c) => c.MQ },
  { group: '収益構造', no: '⑧', label: '固定費（諸経費）', sub: 'F', get: (c) => c.F },
  { group: '収益構造', no: '⑨', label: '経常利益', sub: 'G', get: (c) => c.G },
  { group: '資本', no: '⑩', label: '負債', sub: 'B/S より', get: (c) => c.debt },
  { group: '資本', no: '⑪', label: '純資産（株主資本）', sub: 'B/S より', get: (c) => c.equity },
  { group: '', no: '⑫', label: '損益分岐点比率', sub: '⑧÷⑦×100', get: (c) => c.ratio, unit: '%' },
]

export function GradeBadge({ g }: { g: Grade | null }) {
  if (!g) return <span className="text-ink-300">—</span>
  return (
    <span
      className="inline-block min-w-[28px] px-1.5 rounded-md text-xs font-black text-center"
      style={{ color: GRADE_COLOR[g].fg, background: GRADE_COLOR[g].bg }}
    >
      {g}
    </span>
  )
}

// ---- 第4表 ----
function StrategyTable({ rows }: { rows: AnalysisRow[] }) {
  const cell = 'px-2 text-right num whitespace-nowrap'
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="text-xs border-collapse min-w-full" data-testid="analysis-table">
        <thead>
          <tr className="text-ink-500">
            <th rowSpan={2} className="sticky left-0 z-10 bg-white text-left font-normal pr-2 border-b border-line align-bottom min-w-[150px]">
              項目
            </th>
            {rows.map((r) => (
              <th key={r.period} colSpan={2} className="font-bold text-ink-600 border-b border-l border-line px-2 h-7">
                第{r.period}期
              </th>
            ))}
          </tr>
          <tr className="text-ink-400">
            {rows.map((r) => (
              <PeriodHeads key={r.period} />
            ))}
          </tr>
        </thead>
        <tbody>
          {LINES.map((l, i) => {
            const groupStart = l.group && LINES[i - 1]?.group !== l.group
            return (
              <tr key={l.label} className={`h-8 border-b border-line/60 ${groupStart ? 'border-t border-t-line' : ''}`}>
                <td className="sticky left-0 z-10 bg-white pr-2 whitespace-nowrap">
                  {groupStart && <span className="block text-[10px] text-ink-400 leading-none mt-1">{l.group}</span>}
                  <span className={l.no ? 'text-ink-600' : 'text-ink-400 pl-4'}>
                    {l.no && <span className="inline-block w-4 text-ink-400">{l.no}</span>}
                    {l.label}
                  </span>
                  {l.sub && <span className="ml-1 text-[10px] text-ink-400">{l.sub}</span>}
                </td>
                {rows.map((r) => (
                  <ValuePair key={r.period} row={r} line={l} cls={cell} />
                ))}
              </tr>
            )
          })}
          <tr className="h-9 border-b border-line bg-canvas/60">
            <td className="sticky left-0 z-10 bg-canvas pr-2 whitespace-nowrap font-bold text-ink-600">
              <span className="inline-block w-4" />
              評価（S〜DD）
            </td>
            {rows.map((r) => (
              <GradePair key={r.period} row={r} />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
function PeriodHeads() {
  return (
    <>
      <th className="font-normal border-b border-l border-line px-2 h-6">実績</th>
      <th className="font-normal border-b border-line px-2 text-p-ink">計画</th>
    </>
  )
}
function ValuePair({ row, line, cls }: { row: AnalysisRow; line: Line; cls: string }) {
  const a = row.actual ? line.get(row.actual) : null
  const p = row.plan ? line.get(row.plan) : null
  return (
    <>
      <td className={`${cls} border-l border-line font-bold ${a != null && a < 0 ? 'text-accent-ink' : ''}`}>
        {line.fmt ? line.fmt(a) : show(a, line.unit)}
      </td>
      <td className={`${cls} text-ink-500`}>{line.fmt ? line.fmt(p) : show(p, line.unit)}</td>
    </>
  )
}
function GradePair({ row }: { row: AnalysisRow }) {
  return (
    <>
      <td className="px-2 text-center border-l border-line" data-testid={`grade-${row.period}`}>
        <GradeBadge g={row.actual?.grade ?? null} />
      </td>
      <td className="px-2 text-center">
        <GradeBadge g={row.plan?.grade ?? null} />
      </td>
    </>
  )
}

// ---- グラフ（様式のグラフ用紙） ----
const W = 640
const PADL = 52
const PADR = 52
const xOf = (p: number, n: number) => PADL + ((p - 0.5) / n) * (W - PADL - PADR)

/** 上段：純資産（◎・結果・左の目盛り）とシェア（○・原因・右の目盛り） */
function EquityShareChart({ rows, n }: { rows: AnalysisRow[]; n: number }) {
  const H = 230
  const top = 16
  const bottom = H - 30
  const eq = rows.filter((r) => r.actual).map((r) => ({ p: r.period, v: r.actual!.equity! }))
  const sh = rows.filter((r) => r.actual?.share != null).map((r) => ({ p: r.period, v: r.actual!.share! }))
  // 純資産の目盛りは様式どおり 0〜500 を基本に、はみ出す値があれば 100 刻みで広げる
  const eLo = Math.min(0, Math.floor(Math.min(...eq.map((d) => d.v), 0) / 100) * 100)
  const eHi = Math.max(500, Math.ceil(Math.max(...eq.map((d) => d.v), 0) / 100) * 100)
  // シェアは 0〜50% を基本に、超えたら 10% 刻みで広げる
  const sHi = Math.max(50, Math.ceil(Math.max(...sh.map((d) => d.v), 0) / 10) * 10)
  const yE = (v: number) => bottom - ((v - eLo) / (eHi - eLo)) * (bottom - top)
  const yS = (v: number) => bottom - (v / sHi) * (bottom - top)
  const eTicks = Array.from({ length: (eHi - eLo) / 100 + 1 }, (_, i) => eLo + i * 100)
  const step = (eHi - eLo) / 100 > 8 ? 2 : 1 // 目盛りが多すぎるときは1つおき
  const path = (pts: { p: number; v: number }[], y: (v: number) => number) =>
    pts.map((d, i) => `${i ? 'L' : 'M'}${xOf(d.p, n)},${y(d.v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="純資産とシェアの推移" data-testid="chart-equity">
      {eTicks.map((t, i) => (
        <g key={t}>
          <line x1={PADL} x2={W - PADR} y1={yE(t)} y2={yE(t)} stroke={t === 0 ? '#a0a7b4' : '#e4e7ec'} />
          {i % step === 0 && (
            <text x={PADL - 6} y={yE(t) + 4} textAnchor="end" fontSize="11" fill="#6b7384">
              {t}
            </text>
          )}
        </g>
      ))}
      {Array.from({ length: sHi / 10 + 1 }, (_, i) => i * 10).map((t) => (
        <text key={t} x={W - PADR + 6} y={yS(t) + 4} fontSize="11" fill="#2f6fe0">
          {t}%
        </text>
      ))}
      <XLabels n={n} y={H - 8} />
      <path d={path(sh, yS)} fill="none" stroke="#2f6fe0" strokeWidth="1.5" strokeDasharray="5 4" />
      {sh.map((d) => (
        <circle key={d.p} cx={xOf(d.p, n)} cy={yS(d.v)} r="5" fill="#fff" stroke="#2f6fe0" strokeWidth="2" />
      ))}
      <path d={path(eq, yE)} fill="none" stroke="#1b2230" strokeWidth="2" />
      {eq.map((d) => (
        <g key={d.p}>
          <circle cx={xOf(d.p, n)} cy={yE(d.v)} r="6" fill="#fff" stroke="#1b2230" strokeWidth="2" />
          <circle cx={xOf(d.p, n)} cy={yE(d.v)} r="2.5" fill="#1b2230" />
        </g>
      ))}
    </svg>
  )
}

/** 下段：f/m比率（△・分析）。評価の帯を敷き、実績は塗りの △、計画は白抜きの △ */
function RatioChart({ rows, n }: { rows: AnalysisRow[]; n: number }) {
  const H = 280
  const top = 14
  const bottom = H - 30
  // 様式は 0〜120% の目盛り。S〜C の差が見えるよう 0〜120% に高さの8割を使い、
  // 残り2割に 120〜220%（D の上側と DD）を詰めて描く。220% を超える値は上端に置いて数字を添える
  const MAX = 220
  const KNEE = 120
  const kneeY = bottom - 0.8 * (bottom - top)
  const y = (v: number) => {
    const c = Math.min(Math.max(v, 0), MAX)
    return c <= KNEE ? bottom - (c / KNEE) * (bottom - kneeY) : kneeY - ((c - KNEE) / (MAX - KNEE)) * (kneeY - top)
  }
  // 比率が出ない（粗利 0 以下）期は DD として上端に置く
  const pts = (pick: (r: AnalysisRow) => AnalysisCol | null) =>
    rows
      .map((r) => ({ p: r.period, c: pick(r) }))
      .filter((d) => d.c?.grade)
      .map((d) => ({ p: d.p, v: d.c!.ratio ?? MAX + 1, raw: d.c!.ratio }))
  const act = pts((r) => r.actual)
  const plan = pts((r) => r.plan)
  const tri = (cx: number, cy: number) => `M${cx},${cy - 7} L${cx + 7},${cy + 5} L${cx - 7},${cy + 5} Z`
  const path = (d: { p: number; v: number }[]) => d.map((x, i) => `${i ? 'L' : 'M'}${xOf(x.p, n)},${y(x.v)}`).join(' ')
  let lo = 0
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="損益分岐点比率の推移" data-testid="chart-ratio">
      {GRADES.map((g) => {
        const from = lo
        const to = Math.min(g.max + 1, MAX)
        lo = to
        return (
          <g key={g.grade}>
            <rect x={PADL} width={W - PADL - PADR} y={y(to)} height={y(from) - y(to)} fill={GRADE_COLOR[g.grade].bg} />
            <text x={W - PADR + 6} y={(y(from) + y(to)) / 2 + 4} fontSize="12" fontWeight="700" fill={GRADE_COLOR[g.grade].fg}>
              {g.grade}
            </text>
          </g>
        )
      })}
      {[0, 20, 40, 60, 80, 90, 100, 120, 200].map((t) => (
        <g key={t}>
          <line x1={PADL} x2={W - PADR} y1={y(t)} y2={y(t)} stroke={t === 100 ? '#a02620' : t === KNEE ? '#a0a7b4' : '#d5dae1'} strokeDasharray={t === 100 || t === KNEE ? '' : '2 3'} />
          <text x={PADL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7384">
            {t}%
          </text>
        </g>
      ))}
      <XLabels n={n} y={H - 8} />
      <path d={path(plan)} fill="none" stroke="#9c5d12" strokeWidth="1.5" strokeDasharray="5 4" />
      {plan.map((d) => (
        <path key={d.p} d={tri(xOf(d.p, n) + 9, y(d.v))} fill="#fff" stroke="#9c5d12" strokeWidth="1.8" />
      ))}
      <path d={path(act)} fill="none" stroke="#1b2230" strokeWidth="2" />
      {act.map((d) => (
        <g key={d.p}>
          <path d={tri(xOf(d.p, n), y(d.v))} fill="#1b2230" />
          <text x={xOf(d.p, n)} y={y(d.v) - 11} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1b2230">
            {d.raw == null ? '—' : `${d.raw}%`}
          </text>
        </g>
      ))}
    </svg>
  )
}
function XLabels({ n, y }: { n: number; y: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <text key={i} x={xOf(i + 1, n)} y={y} textAnchor="middle" fontSize="12" fill="#3a4252">
          第{i + 1}期
        </text>
      ))}
    </>
  )
}

// ---- 評価表 ----
function GradeTable({ rows }: { rows: AnalysisRow[] }) {
  const settled = rows.filter((r) => r.actual)
  const latest = settled[settled.length - 1]?.actual?.grade ?? null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse" data-testid="grade-table">
        <thead>
          <tr className="h-8 text-xs text-ink-400 border-b border-line">
            <th className="text-left font-normal pr-2">評価</th>
            <th className="text-left font-normal px-2">区分</th>
            <th className="text-left font-normal px-2 whitespace-nowrap">損益分岐点比率</th>
            {settled.map((r) => (
              <th key={r.period} className="font-normal px-2 whitespace-nowrap">
                第{r.period}期
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GRADES.map((g) => {
            const now = g.grade === latest
            return (
              <tr
                key={g.grade}
                className="h-10 border-b border-line/60"
                style={now ? { background: GRADE_COLOR[g.grade].bg } : undefined}
                data-testid={`grade-row-${g.grade}`}
              >
                <td className="pr-2">
                  <span className="font-black text-base" style={{ color: GRADE_COLOR[g.grade].fg }}>
                    {g.grade}
                  </span>
                </td>
                <td className="px-2 whitespace-nowrap">
                  {g.name}
                  {now && <span className="ml-2 text-[10px] font-bold text-ink-600">← 最新の決算</span>}
                </td>
                <td className="px-2 num whitespace-nowrap text-ink-600">{g.range}</td>
                {settled.map((r) => (
                  <td key={r.period} className="px-2 text-center num whitespace-nowrap">
                    {r.actual!.grade === g.grade ? (
                      <span className="font-bold" style={{ color: GRADE_COLOR[g.grade].fg }}>
                        ● {r.actual!.ratio == null ? '—' : `${r.actual!.ratio}%`}
                      </span>
                    ) : (
                      ''
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function AnalysisCard({
  history,
  plans,
  st,
  loadOrg,
}: {
  history: Result[]
  plans: Record<string, unknown>
  st: St
  loadOrg: () => Promise<ApiOrgCompany[]>
}) {
  // 研修の他社の売上個数（シェアの分母）。決算が増えたら取り直す。研修に入っていない・取れないときは null のまま
  const [orgQ, setOrgQ] = useState<OrgQ | null>(null)
  useEffect(() => {
    if (!st.org) return
    let alive = true
    loadOrg()
      .then((cs) => alive && setOrgQ(orgQOf(cs)))
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.org, history.length])

  const rows = analysisTable(history, plans, st, orgQ)
  const n = Math.max(MIN_PERIODS, rows.length)
  return (
    <>
      <div className="bg-white rounded-2xl shadow-card border border-line p-4 sm:p-5" data-testid="analysis">
        <h2 className="font-bold mb-1">第4表 MG経営戦略分析表</h2>
        <p className="text-xs text-ink-400 mb-3">
          期ごとに、決算の実績と経営計画書の計画を並べています。計画書に無い項目（シェア・負債・純資産）は「—」です。
        </p>
        <StrategyTable rows={rows} />
        <p className="mt-2 text-[10px] text-ink-400 leading-relaxed">
          ※ 評価の要素は ① P（平均単価）・② vP（変動単価）・④ Q（売上個数）・⑧ F（固定費）。
          シェア ＝ 自分の売上個数 ÷ 研修の全社の売上個数 × 100（その期に決算した会社で計算）。
          PLAN（計画）→ DO（実行）→ SEE（評価）のマネジメントサイクルを回しましょう。
        </p>
      </div>
      <div className="bg-white rounded-2xl shadow-card border border-line p-4 sm:p-5">
        <h2 className="font-bold mb-1">純資産とシェアの推移</h2>
        <p className="text-xs text-ink-500 mb-2 flex flex-wrap gap-x-4">
          <span>◎ 純資産（株主資本額）＝ 結果・左の目盛り</span>
          <span className="text-[#2f6fe0]">○ シェア ＝ 原因・右の目盛り</span>
        </p>
        <EquityShareChart rows={rows} n={n} />
        <h2 className="font-bold mt-5 mb-1">f/m比率（損益分岐点比率）の推移</h2>
        <p className="text-xs text-ink-500 mb-2 flex flex-wrap gap-x-4">
          <span>▲ 実績 ＝ 分析</span>
          <span className="text-p-ink">△ 計画</span>
          <span className="text-ink-400">低いほど良い。100% を超えると赤字</span>
        </p>
        <RatioChart rows={rows} n={n} />
      </div>
      <div className="bg-white rounded-2xl shadow-card border border-line p-4 sm:p-5">
        <h2 className="font-bold mb-1">評価（S〜DD）</h2>
        <p className="text-xs text-ink-400 mb-3">損益分岐点比率（固定費 F ÷ 粗利 MQ × 100）で会社の状態を6段階で評価します。</p>
        <GradeTable rows={rows} />
      </div>
    </>
  )
}
