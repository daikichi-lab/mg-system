// 組織比較チャート（複数系列折れ線・インタラクティブ）。
// figures-review.ts の multiLineHTML（静的SVG文字列）の置き換え:
// - 縦軸の目盛り数値＋横破線グリッド
// - ホバー/タップで最寄りの期にスナップし、各社の値を降順のツールチップで表示
import { useRef, useState } from 'react'
import { fmt, fmtA } from '../lib/calc'

export interface OrgSeries {
  name: string
  color: string
  me?: boolean
  pts: { x: number; y: number }[]
}

const W = 340
const H = 160
const PAD_L = 40 // 縦軸ラベル分
const PAD_R = 12
const PAD_T = 12
const PAD_B = 22

// 1-2-5系列の「切りのいい」目盛り幅（ゲームの数値は整数なので最小1）
function niceStep(span: number): number {
  const raw = span / 4
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)))
  const norm = raw / mag
  return Math.max(1, mag * (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10))
}

export function OrgLineChart({ series, signed, pct }: { series: OrgSeries[]; signed?: boolean; pct?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const allY = series.flatMap((se) => se.pts.map((p) => p.y))
  if (!allY.length) return <div className="text-ink-300 text-xs py-6 text-center">データなし</div>

  const maxP = Math.max(5, ...series.flatMap((se) => se.pts.map((p) => p.x)))
  const dataPeriods = [...new Set(series.flatMap((se) => se.pts.map((p) => p.x)))].sort((a, b) => a - b)

  // ---- スケール（目盛り境界まで丸めてグリッドを揃える）----
  let mx = Math.max(...allY)
  let mn = Math.min(...allY)
  if (signed) {
    mx = Math.max(mx, 0)
    mn = Math.min(mn, 0)
  } else {
    mn = Math.min(mn, 0)
    if (mx <= 0) mx = 1
  }
  if (mx === mn) mx = mn + 1
  let step = niceStep(mx - mn)
  let lo = Math.floor(mn / step) * step
  let hi = Math.ceil(mx / step) * step
  while ((hi - lo) / step > 6) {
    step *= 2
    lo = Math.floor(mn / step) * step
    hi = Math.ceil(mx / step) * step
  }
  if (hi === lo) hi = lo + step
  const span = hi - lo
  const ticks = Array.from({ length: Math.round(span / step) + 1 }, (_, i) => lo + i * step)

  const X = (p: number): number =>
    maxP <= 1 ? PAD_L + (W - PAD_L - PAD_R) / 2 : PAD_L + ((p - 1) * (W - PAD_L - PAD_R)) / (maxP - 1)
  const Y = (v: number): number => PAD_T + ((hi - v) / span) * (H - PAD_T - PAD_B)
  const fmtV = pct ? (v: number) => Math.round(v) + '%' : signed ? fmtA : fmt
  const isZero = (t: number) => Math.abs(t) < step * 1e-6

  // ---- ホバー：カーソルに最も近い「データのある期」へスナップ ----
  const pick = (clientX: number) => {
    const el = boxRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vx = ((clientX - rect.left) / rect.width) * W
    let best = dataPeriods[0]!
    let bd = Infinity
    for (const p of dataPeriods) {
      const d = Math.abs(X(p) - vx)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    setHover(best)
  }
  const rows =
    hover == null
      ? []
      : series
          .map((se) => ({ se, pt: se.pts.find((p) => p.x === hover) }))
          .filter((r) => r.pt)
          .sort((a, b) => b.pt!.y - a.pt!.y)

  return (
    <div>
      <div
        ref={boxRef}
        className="relative"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 'auto' }}
          preserveAspectRatio="xMidYMid meet"
          className="cursor-crosshair select-none"
        >
          {/* 横破線グリッド＋縦軸目盛り（0の線は濃いめ） */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_L}
                y1={Y(t).toFixed(1)}
                x2={W - PAD_R}
                y2={Y(t).toFixed(1)}
                stroke={isZero(t) ? '#b6bfca' : '#e7eaf0'}
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <text x={PAD_L - 5} y={(Y(t) + 2.8).toFixed(1)} textAnchor="end" fontSize="8" fill="#9aa3b2">
                {fmtV(t)}
              </text>
            </g>
          ))}
          {/* X軸（期）ラベル */}
          {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
            <text
              key={p}
              x={X(p).toFixed(1)}
              y={H - 6}
              textAnchor="middle"
              fontSize="8.5"
              fill={hover === p ? '#3a4252' : '#9aa3b2'}
              fontWeight={hover === p ? 700 : 400}
            >
              第{p}期
            </text>
          ))}
          {/* ホバー中の期の縦ガイド */}
          {hover != null && (
            <line
              x1={X(hover).toFixed(1)}
              y1={PAD_T}
              x2={X(hover).toFixed(1)}
              y2={H - PAD_B}
              stroke="#8f98a8"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
          )}
          {/* 系列（「あなた」は太線・大点。ホバー期の点は拡大） */}
          {series.map((se) => {
            const sp = [...se.pts].sort((a, b) => a.x - b.x)
            return (
              <g key={se.name}>
                {sp.length > 1 && (
                  <polyline
                    points={sp.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}
                    fill="none"
                    stroke={se.color}
                    strokeWidth={se.me ? 3 : 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={se.me ? 1 : 0.85}
                  />
                )}
                {sp.map((p) => (
                  <circle
                    key={p.x}
                    cx={X(p.x).toFixed(1)}
                    cy={Y(p.y).toFixed(1)}
                    r={p.x === hover ? (se.me ? 4.6 : 3.8) : se.me ? 3.6 : 2.8}
                    fill="#fff"
                    stroke={se.color}
                    strokeWidth="2"
                  />
                ))}
              </g>
            )
          })}
        </svg>
        {/* ツールチップ：ホバー期の各社の値（降順） */}
        {hover != null && rows.length > 0 && (
          <div
            className="absolute z-10 pointer-events-none bg-white/95 border border-line rounded-lg shadow-card px-2.5 py-2"
            style={{
              left: `${(X(hover) / W) * 100}%`,
              top: `${(PAD_T / H) * 100}%`,
              transform: X(hover) > W / 2 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
            }}
          >
            <div className="text-[10px] font-bold text-ink-400 mb-1">第{hover}期</div>
            <table className="text-[11px] leading-4">
              <tbody>
                {rows.map(({ se, pt }) => (
                  <tr key={se.name}>
                    <td className="pr-1">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: se.color }} />
                    </td>
                    <td className={`pr-2 whitespace-nowrap ${se.me ? 'font-bold' : ''}`}>
                      {se.name}
                      {se.me ? '（あなた）' : ''}
                    </td>
                    <td className={`num text-right font-bold whitespace-nowrap ${pt!.y < 0 ? 'text-[#c8322b]' : ''}`}>
                      {fmtV(pt!.y)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* 凡例 */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px]">
        {series.map((se) => (
          <span key={se.name} className={`inline-flex items-center gap-1 ${se.me ? 'font-bold' : ''}`}>
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: se.color }} />
            {se.name}
            {se.me ? '（あなた）' : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
