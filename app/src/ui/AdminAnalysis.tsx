// 研修の管理画面・成績一覧の「経営戦略分析表」。issue #111
//
// 参加者アプリの振り返りタブにある第4表（ui/AnalysisCard.tsx・issue #109）を、講師が全社まとめて見るためのもの。
// 上に表、下にグラフ（純資産◎・シェア○・f/m比率△）。数字はすべて lib/analysis.ts の companyAnalysis() で作る。
// - 全期：会社ごとに各期を並べる。グラフの横軸は期、会社ごとに線で結ぶ
// - 期ごと：選んだ1期で会社を横に並べて比べる。グラフの横軸は会社（線は引かず、点と値だけ）
// 計画の固定費は数値ルールで決まるので、その研修のルールを読み込んで setRules() してから計算する。
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type ApiOrgCompany } from '../lib/api'
import { setRules } from '../lib/calc'
import { companyAnalysis, GRADES, orgQOf, type AnalysisCol, type AnalysisRow } from '../lib/analysis'
import { ORG_COLORS } from '../lib/figures-review'
import { GRADE_COLOR, GradeBadge, LINES, show } from './AnalysisCard'

interface CoRows {
  c: ApiOrgCompany
  color: string
  rows: AnalysisRow[]
}

export default function AdminAnalysis({ org, companies }: { org: string; companies: ApiOrgCompany[] }) {
  // その研修の数値ルール（計画の固定費の計算に使う）。読み込むまでは計算しない（既定ルールで出すと数字がずれるため）
  const [rulesReady, setRulesReady] = useState(false)
  useEffect(() => {
    let alive = true
    setRulesReady(false)
    api
      .orgRules(org)
      .then((d) => {
        if (!alive) return
        setRules(d.rules)
        setRulesReady(true)
      })
      .catch(() => {
        // 取れないときは既定ルールで出す（決算の実績は数値ルールに関係しない）
        if (!alive) return
        setRules(null)
        setRulesReady(true)
      })
    return () => {
      alive = false
    }
  }, [org])

  const [period, setPeriod] = useState(0) // 0 = 全期
  const [showPlan, setShowPlan] = useState(true)
  const [hidden, setHidden] = useState<Set<string>>(new Set()) // 表・グラフから外した会社

  // 第4表のある会社（決算か経営計画のどちらかがある）。色は会社の並び順で固定（外しても他社の色が変わらない）
  const all: CoRows[] = useMemo(() => {
    if (!rulesReady) return []
    const orgQ = orgQOf(companies)
    return companies
      .map((c) => ({ c, rows: companyAnalysis(c, orgQ) }))
      .filter((x) => x.rows.some((r) => r.actual || r.plan))
      .map((x, i) => ({ ...x, color: ORG_COLORS[i % ORG_COLORS.length] }))
  }, [companies, rulesReady])
  const shown = all.filter((x) => !hidden.has(x.c.name))
  const periods = [...new Set(all.flatMap((x) => x.rows.map((r) => r.period)))].sort((a, b) => a - b)

  if (!rulesReady) return <div className="text-ink-400 text-sm p-6 text-center">読み込み中…</div>
  if (!all.length)
    return (
      <div className="text-ink-400 text-sm p-6 text-center" data-testid="aa-empty">
        まだ決算・経営計画のある会社がありません。
      </div>
    )

  const toggle = (name: string) => {
    const next = new Set(hidden)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setHidden(next)
  }

  return (
    <div className="space-y-4" data-testid="admin-analysis">
      {/* 表示の条件：期（全期／期ごと）・計画の列・会社 */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <label className="flex items-center gap-1.5">
            <span className="text-ink-500 font-bold">期</span>
            <select
              data-testid="aa-period"
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
              className="h-8 border border-line rounded-lg px-2 bg-white"
            >
              <option value={0}>全期</option>
              {periods.map((p) => (
                <option key={p} value={p}>
                  第{p}期
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input data-testid="aa-plan" type="checkbox" checked={showPlan} onChange={(e) => setShowPlan(e.target.checked)} className="w-4 h-4" />
            計画も出す
          </label>
          <span className="text-ink-300">
            {period ? `第${period}期の各社を横に並べて比べます` : '会社ごとに各期を並べます'}。計画書に無い項目（シェア・負債・純資産）の計画は「—」
          </span>
        </div>
        <div className="flex items-start gap-2 flex-wrap text-xs">
          <span className="text-ink-500 font-bold pt-1">会社</span>
          <button data-testid="aa-all" onClick={() => setHidden(new Set())} className="h-7 px-2 rounded-md border border-line hover:bg-canvas">
            全員
          </button>
          <button
            data-testid="aa-none"
            onClick={() => setHidden(new Set(all.map((x) => x.c.name)))}
            className="h-7 px-2 rounded-md border border-line hover:bg-canvas"
          >
            全員外す
          </button>
          {all.map((x) => {
            const on = !hidden.has(x.c.name)
            return (
              <label
                key={x.c.name}
                className={`h-7 flex items-center gap-1.5 px-2 rounded-md border cursor-pointer select-none ${
                  on ? 'border-line bg-white' : 'border-line/60 bg-canvas opacity-60'
                }`}
              >
                <input
                  type="checkbox"
                  data-testid={`aa-check-${x.c.name}`}
                  checked={on}
                  onChange={() => toggle(x.c.name)}
                  className="w-3.5 h-3.5"
                  style={{ accentColor: x.color }}
                />
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: x.color }} />
                {x.c.name}
              </label>
            )
          })}
        </div>
      </div>

      {shown.length ? (
        <>
          <AnalysisTable list={shown} period={period} periods={periods} showPlan={showPlan} />
          <Charts list={shown} period={period} periods={periods} showPlan={showPlan} />
        </>
      ) : (
        <div className="text-ink-400 text-sm p-6 text-center">表に出す会社にチェックを入れてください。</div>
      )}
    </div>
  )
}

// ---- 表（上） ----
/** 表の列：どの会社のどの期の、実績か計画か */
interface Col {
  x: CoRows
  period: number
  kind: 'actual' | 'plan'
}
function colsOf(list: CoRows[], period: number, periods: number[], showPlan: boolean): Col[] {
  const kinds: Col['kind'][] = showPlan ? ['actual', 'plan'] : ['actual']
  const ps = period ? [period] : periods
  return list.flatMap((x) => ps.flatMap((p) => kinds.map((kind) => ({ x, period: p, kind }))))
}
const valueOf = (col: Col): AnalysisCol | null => {
  const r = col.x.rows.find((r) => r.period === col.period)
  return r ? r[col.kind] : null
}

function AnalysisTable({ list, period, periods, showPlan }: { list: CoRows[]; period: number; periods: number[]; showPlan: boolean }) {
  const cols = colsOf(list, period, periods, showPlan)
  const per = showPlan ? 2 : 1 // 1期あたりの列数
  const span = (period ? 1 : periods.length) * per // 1社あたりの列数
  // 見出しは thead ごと上に固定する（行ごとに top を測らずに済む）。左上のセルは左にも固定
  const head = 'bg-canvas'
  // 会社・期の区切り：その会社の最初の列と、各期の最初の列に左罫線
  const edge = (i: number) => (i % span === 0 ? 'border-l-2 border-l-line' : i % per === 0 ? 'border-l border-line' : '')
  return (
    <div className="overflow-auto max-h-[60vh] border border-line rounded-lg">
      <table className="text-[12px] border-collapse" data-testid="aa-table">
        <thead className="sticky top-0 z-20">
          <tr className="text-ink-600">
            <th rowSpan={showPlan ? (period ? 2 : 3) : period ? 1 : 2} className={`${head} sticky left-0 z-30 px-2 text-left align-bottom min-w-[170px] border-b border-line`}>
              {period ? `第${period}期` : '項目'}
            </th>
            {list.map((x) => (
              <th key={x.c.name} colSpan={span} className={`${head} px-2 py-1 whitespace-nowrap border-l-2 border-line border-b`}>
                <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: x.color }} />
                {x.c.name}
              </th>
            ))}
          </tr>
          {!period && (
            <tr className="text-ink-500">
              {list.flatMap((x) =>
                periods.map((p, j) => (
                  <th
                    key={`${x.c.name}-${p}`}
                    colSpan={per}
                    className={`bg-canvas px-2 h-6 font-bold whitespace-nowrap border-b border-line ${j === 0 ? 'border-l-2 border-l-line' : 'border-l border-line'}`}
                  >
                    第{p}期
                  </th>
                )),
              )}
            </tr>
          )}
          {showPlan && (
            <tr className="text-ink-400">
              {cols.map((c, i) => (
                <th key={i} className={`bg-canvas px-2 h-6 font-normal border-b border-line ${edge(i)} ${c.kind === 'plan' ? 'text-p-ink' : ''}`}>
                  {c.kind === 'actual' ? '実績' : '計画'}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {LINES.map((l, li) => {
            const groupStart = l.group && LINES[li - 1]?.group !== l.group
            return (
              <tr key={l.label} className={`h-8 border-b border-line/60 ${groupStart ? 'border-t border-t-line' : ''}`}>
                <td className="sticky left-0 z-10 bg-white px-2 whitespace-nowrap">
                  {groupStart && <span className="block text-[10px] text-ink-400 leading-none mt-1">{l.group}</span>}
                  <span className={l.no ? 'text-ink-600' : 'text-ink-400 pl-4'}>
                    {l.no && <span className="inline-block w-4 text-ink-400">{l.no}</span>}
                    {l.label}
                  </span>
                  {l.sub && <span className="ml-1 text-[10px] text-ink-400">{l.sub}</span>}
                </td>
                {cols.map((c, i) => {
                  const col = valueOf(c)
                  const v = col ? l.get(col) : null
                  return (
                    <td
                      key={i}
                      className={`px-2 text-right num whitespace-nowrap ${edge(i)} ${
                        c.kind === 'actual' ? `font-bold ${v != null && v < 0 ? 'text-accent-ink' : ''}` : 'text-ink-500'
                      }`}
                    >
                      {l.fmt ? l.fmt(v) : show(v, l.unit)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
          <tr className="h-9 bg-canvas/60">
            <td className="sticky left-0 z-10 bg-canvas px-2 whitespace-nowrap font-bold text-ink-600">
              <span className="inline-block w-4" />
              評価（S〜DD）
            </td>
            {cols.map((c, i) => (
              <td key={i} className={`px-2 text-center ${edge(i)}`} data-testid={`aa-grade-${c.x.c.name}-${c.period}-${c.kind}`}>
                <GradeBadge g={valueOf(c)?.grade ?? null} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ---- グラフ（下） ----
interface Series {
  name: string
  color: string
  /** 横軸の各カテゴリの値。無い所は null */
  values: (number | null)[]
  /** 点と点を線で結ぶか（全期＝結ぶ／期ごと＝結ばずに値を添える） */
  line: boolean
  /** 計画の系列（白抜き・破線） */
  plan?: boolean
}

function Charts({ list, period, periods, showPlan }: { list: CoRows[]; period: number; periods: number[]; showPlan: boolean }) {
  // 全期：横軸＝期、系列＝会社。期ごと：横軸＝会社、系列＝会社（自分の位置にだけ値を持つ）
  const cats = period ? list.map((x) => x.c.name) : periods.map((p) => `第${p}期`)
  const seriesOf = (pick: (c: AnalysisCol) => number | null, kind: 'actual' | 'plan' = 'actual'): Series[] =>
    list.map((x, i) => {
      const at = (p: number) => {
        const col = x.rows.find((r) => r.period === p)?.[kind]
        return col ? pick(col) : null
      }
      return {
        name: `${x.c.name}${kind === 'plan' ? '（計画）' : ''}`,
        color: x.color,
        values: period ? cats.map((_, j) => (j === i ? at(period) : null)) : periods.map(at),
        line: !period,
        plan: kind === 'plan',
      }
    })
  // f/m比率：比率が出ない（粗利 0 以下）けれど DD の期は上端に置く（RATIO_TOP）
  const ratioPick = (c: AnalysisCol) => (c.ratio != null ? c.ratio : c.grade === 'DD' ? RATIO_TOP : null)
  const ratioSeries = [...seriesOf(ratioPick), ...(showPlan ? seriesOf(ratioPick, 'plan') : [])]
  return (
    <div className="space-y-4" data-testid="aa-charts">
      <div className="grid lg:grid-cols-2 gap-4">
        <ChartBox title="純資産（株主資本額）の推移" note="◎ 結果">
          <PointChart cats={cats} series={seriesOf((c) => c.equity)} kind="amount" marker="dcircle" testid="aa-chart-equity" w={520} />
        </ChartBox>
        <ChartBox title="シェアの推移" note="○ 原因（自分の売上個数 ÷ 全社の売上個数）">
          <PointChart cats={cats} series={seriesOf((c) => c.share)} kind="pct" marker="circle" testid="aa-chart-share" w={520} />
        </ChartBox>
      </div>
      <ChartBox title="f/m比率（損益分岐点比率）の推移" note={`▲ 実績${showPlan ? '／△ 計画（破線）' : ''}。低いほど良い。100% を超えると赤字`}>
        <PointChart cats={cats} series={ratioSeries} kind="ratio" marker="tri" testid="aa-chart-ratio" />
      </ChartBox>
    </div>
  )
}

function ChartBox({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="font-bold text-sm">{title}</div>
      <div className="text-[11px] text-ink-400 mb-1">{note}</div>
      {children}
    </div>
  )
}

const PADR = 40
const RATIO_MAX = 220
const RATIO_KNEE = 120
/** 比率が出ない DD の期を置く位置（上端より上＝上端に張り付く） */
const RATIO_TOP = RATIO_MAX + 1

/**
 * 点のグラフ。kind で縦軸が変わる：
 * - amount：金額。0 を含む「切りのいい」目盛り
 * - pct：シェア。0〜50% を基本に 10% 刻みで広げる
 * - ratio：f/m比率。評価の帯を敷き、0〜120% に高さの8割、120〜220% を上の2割に詰める（参加者アプリの RatioChart と同じ）
 */
function PointChart({
  cats,
  series,
  kind,
  marker,
  testid,
  w = 760,
}: {
  cats: string[]
  series: Series[]
  kind: 'amount' | 'pct' | 'ratio'
  marker: 'dcircle' | 'circle' | 'tri'
  testid: string
  /** 描画座標系の幅。半分の幅に置くグラフは小さくして、文字が縮みすぎないようにする */
  w?: number
}) {
  const CW = w
  // 横軸が会社（期ごと）で会社が多いときは、名前を斜めにして重ならないようにする。その分だけ下を空ける
  const slant = cats.length > 5
  const labelH = slant ? 70 : 24
  const H = (kind === 'ratio' ? 280 : 210) + labelH
  const top = 14
  const bottom = H - labelH - 10
  // 斜めの会社名は左下へ伸びるので、左端の名前が切れないよう左の余白を広げる
  const PADL = slant ? 84 : 54
  const xOf = (i: number) => PADL + ((i + 0.5) / cats.length) * (CW - PADL - PADR)
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v != null))

  // 縦軸
  let y: (v: number) => number
  let ticks: { v: number; label: string }[]
  if (kind === 'ratio') {
    const kneeY = bottom - 0.8 * (bottom - top)
    y = (v) => {
      const c = Math.min(Math.max(v, 0), RATIO_MAX)
      return c <= RATIO_KNEE
        ? bottom - (c / RATIO_KNEE) * (bottom - kneeY)
        : kneeY - ((c - RATIO_KNEE) / (RATIO_MAX - RATIO_KNEE)) * (kneeY - top)
    }
    ticks = [0, 20, 40, 60, 80, 90, 100, 120, 200].map((v) => ({ v, label: `${v}%` }))
  } else if (kind === 'pct') {
    const hi = Math.max(50, Math.ceil(Math.max(0, ...vals) / 10) * 10)
    y = (v) => bottom - (v / hi) * (bottom - top)
    ticks = Array.from({ length: hi / 10 + 1 }, (_, i) => ({ v: i * 10, label: `${i * 10}%` }))
  } else {
    const lo0 = Math.min(0, ...vals)
    const hi0 = Math.max(100, ...vals)
    const step = [50, 100, 200, 500, 1000, 2000, 5000].find((s) => (hi0 - lo0) / s <= 8) ?? 10000
    const lo = Math.floor(lo0 / step) * step
    const hi = Math.ceil(hi0 / step) * step
    y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top)
    ticks = Array.from({ length: (hi - lo) / step + 1 }, (_, i) => ({ v: lo + i * step, label: String(lo + i * step) }))
  }

  const mark = (s: Series, cx: number, cy: number) => {
    if (marker === 'tri') {
      const d = `M${cx},${cy - 7} L${cx + 7},${cy + 5} L${cx - 7},${cy + 5} Z`
      return s.plan ? <path d={d} fill="#fff" stroke={s.color} strokeWidth="1.8" /> : <path d={d} fill={s.color} />
    }
    if (marker === 'dcircle')
      return (
        <>
          <circle cx={cx} cy={cy} r="6" fill="#fff" stroke={s.color} strokeWidth="2" />
          <circle cx={cx} cy={cy} r="2.5" fill={s.color} />
        </>
      )
    return <circle cx={cx} cy={cy} r="5" fill="#fff" stroke={s.color} strokeWidth="2" />
  }
  const label = (v: number) => (kind === 'ratio' ? (v === RATIO_TOP ? '—' : `${v}%`) : kind === 'pct' ? `${v.toFixed(1)}%` : String(v))

  let lo = 0
  return (
    <svg viewBox={`0 0 ${CW} ${H}`} className="w-full h-auto" role="img" aria-label="推移のグラフ" data-testid={testid}>
      {kind === 'ratio' &&
        GRADES.map((g) => {
          const from = lo
          const to = Math.min(g.max + 1, RATIO_MAX)
          lo = to
          return (
            <g key={g.grade}>
              <rect x={PADL} width={CW - PADL - PADR} y={y(to)} height={y(from) - y(to)} fill={GRADE_COLOR[g.grade].bg} />
              <text x={CW - PADR + 6} y={(y(from) + y(to)) / 2 + 4} fontSize="12" fontWeight="700" fill={GRADE_COLOR[g.grade].fg}>
                {g.grade}
              </text>
            </g>
          )
        })}
      {ticks.map((t) => (
        <g key={t.v}>
          <line
            x1={PADL}
            x2={CW - PADR}
            y1={y(t.v)}
            y2={y(t.v)}
            stroke={kind === 'ratio' && t.v === 100 ? '#a02620' : t.v === 0 ? '#a0a7b4' : '#e4e7ec'}
          />
          <text x={PADL - 6} y={y(t.v) + 4} textAnchor="end" fontSize="11" fill="#6b7384">
            {t.label}
          </text>
        </g>
      ))}
      {cats.map((c, i) =>
        slant ? (
          <text
            key={i}
            x={xOf(i)}
            y={bottom + 14}
            textAnchor="end"
            fontSize="11"
            fill="#3a4252"
            transform={`rotate(-35 ${xOf(i)} ${bottom + 14})`}
          >
            {c.length > 9 ? `${c.slice(0, 8)}…` : c}
          </text>
        ) : (
          <text key={i} x={xOf(i)} y={bottom + 20} textAnchor="middle" fontSize="12" fill="#3a4252">
            {c}
          </text>
        ),
      )}
      {series.map((s, si) => {
        const pts = s.values.map((v, i) => (v == null ? null : { i, v })).filter((p): p is { i: number; v: number } => !!p)
        // 計画の点は実績と重ならないよう少し右にずらす
        const dx = s.plan ? 9 : 0
        return (
          <g key={si}>
            {s.line && pts.length > 1 && (
              <path
                d={pts.map((p, k) => `${k ? 'L' : 'M'}${xOf(p.i) + dx},${y(p.v)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={s.plan ? 1.4 : 2}
                strokeDasharray={s.plan ? '5 4' : undefined}
                opacity={s.plan ? 0.8 : 1}
              />
            )}
            {pts.map((p) => (
              <g key={p.i}>
                <title>{`${s.name} ${cats[p.i]}：${label(p.v)}`}</title>
                {mark(s, xOf(p.i) + dx, y(p.v))}
                {!s.line && !s.plan && (
                  <text x={xOf(p.i)} y={y(p.v) - 11} textAnchor="middle" fontSize="11" fontWeight="700" fill={s.color}>
                    {label(p.v)}
                  </text>
                )}
              </g>
            ))}
          </g>
        )
      })}
    </svg>
  )
}
