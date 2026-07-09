// 振り返り（review）／組織（org comparison）の可視化。
// mock/index.html の lineChart / multiLine / renderStructure / renderScore /
// renderInsights を DOM 非依存の「HTML文字列を返す純関数」に移植。
// Tailwind クラスはすべてインラインスタイルへ展開（色・レイアウト・ラベルを厳密に一致）。

import { fmt, fmtA, fmRatio, type HistLite, type Result } from './calc.ts'

// ---- mock の Tailwind カラー定義（config）をインライン化 ----
// ink: {DEFAULT:#1b2230, 600:#3a4252, 400:#6b7384, 300:#a0a7b4}, 500 は Tailwind 既定 #6b7280
// line:#e4e7ec, canvas:#f6f7f9, accent.ink:#a02620, g.ink:#876a10
const INK = '#1b2230'
const INK600 = '#3a4252'
const INK500 = '#6b7280'
const INK400 = '#6b7384'
const INK300 = '#a0a7b4'
const LINE = '#e4e7ec'
const CANVAS = '#f6f7f9'
const ACCENT_INK = '#a02620'
const G_INK = '#876a10'
const CARD_SHADOW = '0 1px 2px rgba(27,34,48,.04), 0 8px 24px -16px rgba(27,34,48,.20)'

// 組織パレット（先頭8色は mock ORG_COLORS と厳密一致。9色目以降は大人数組織
// （〜16社）でも色が重複しないよう app 側で追加）
export const ORG_COLORS = [
  '#0f766e',
  '#c8322b',
  '#2f6fe0',
  '#d98324',
  '#9d3464',
  '#6b4fa0',
  '#ca9a06',
  '#1f7a8c',
  '#4d7c0f',
  '#7c2d12',
  '#0e7490',
  '#a21caf',
  '#57534e',
  '#15803d',
  '#b45309',
  '#334155',
]

// ---- 派生指標（mock と同一式）----
const mRate = (h: HistLite): number => (h.PQ ? (h.mPQ / h.PQ) * 100 : 0) // 粗利率
const bepRate = (h: HistLite): number => fmRatio(h) // 損益分岐点比率
const equityOf = (h: HistLite): number => h.capEnd + h.retEnd // 自己資本

const round = Math.round

// ============================================================================
// lineChartHTML — 単系列の折れ線グラフ（inline SVG）。振り返りの KPI 推移。
// mock: lineChart(el, getVal, c, opts)
// ============================================================================
export interface LineChartOpts {
  signed?: boolean
  pct?: boolean
  color?: string
}
export function lineChartHTML(points: { x: number; y: number }[], opts?: LineChartOpts): string {
  const o = opts || {}
  const c = o.color || '#e07b2a'
  const vals = points.map((p) => p.y)
  const labels = points.map((p) => '第' + p.x + '期')
  const n = vals.length
  const W = 340,
    H = 128,
    padL = 12,
    padR = 12,
    padT = 16,
    padB = 22
  let mx = vals.length ? Math.max(...vals) : 0
  let mn = vals.length ? Math.min(...vals) : 0
  if (o.signed) {
    mx = Math.max(mx, 0)
    mn = Math.min(mn, 0)
  } else {
    mn = Math.min(mn, 0)
    if (mx <= 0) mx = 1
  }
  if (mx === mn) mx = mn + 1
  const span = mx - mn
  const X = (i: number): number =>
    n <= 1 ? padL + (W - padL - padR) / 2 : padL + (i * (W - padL - padR)) / (n - 1)
  const Y = (v: number): number => padT + ((mx - v) / span) * (H - padT - padB)
  const fmtV = o.pct
    ? (v: number) => round(v) + '%'
    : o.signed
      ? (v: number) => fmtA(v)
      : (v: number) => fmt(v)
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" preserveAspectRatio="xMidYMid meet">`
  if (mn < 0) {
    const zy = Y(0).toFixed(1)
    s += `<line x1="${padL}" y1="${zy}" x2="${W - padR}" y2="${zy}" stroke="#cbd2da" stroke-width="1" stroke-dasharray="3 3"/>`
  }
  if (n > 1) {
    const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
    s += `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`
  }
  vals.forEach((v, i) => {
    const x = X(i),
      y = Y(v)
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="#fff" stroke="${c}" stroke-width="2"/>`
    s += `<text x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${o.signed && v < 0 ? '#c8322b' : c}">${fmtV(v)}</text>`
    s += `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#9aa3b2">${labels[i]}</text>`
  })
  s += '</svg>'
  return s
}

// multiLineHTML（複数系列の折れ線・組織比較）は、ホバー表示・縦軸目盛り対応の
// インタラクティブ版 ui/OrgLineChart.tsx へ移行した。

// ============================================================================
// structureHTML — 利益構造(STRAC)の推移。期ごとに積み上げ横バー
//   [変動費 #37a36b | 固定費 #3b6fd4 | 利益 #d98a06 or 損失 #c8322b] ＋ PQ 線
// mock: renderStructure()
// 注: mock は history に full Result を保持し r.vPQ を使う。HistLite に vPQ が
//     無いため、変動費(vPQ)を含む Result（の部分集合）を受け取る。
// ============================================================================
export type StructInput = Pick<Result, 'period' | 'PQ' | 'vPQ' | 'F' | 'G'>
export function structureHTML(history: StructInput[]): string {
  const scaleMax = Math.max(1, ...history.map((r) => Math.max(r.PQ, r.vPQ + r.F)))
  const W = (x: number): number => (x / scaleMax) * 100
  const seg = (w: number, c: string, t: string): string =>
    w > 0
      ? `<div style="height:100%;width:${W(w)}%;background:${c}" title="${t}"></div>`
      : ''
  return history
    .map((r) => {
      const v = r.vPQ,
        fCov = Math.min(r.F, Math.max(0, r.PQ - v)),
        prof = Math.max(0, r.G),
        loss = Math.max(0, -r.G)
      const gCol = r.G < 0 ? ACCENT_INK : G_INK
      return `<div style="font-size:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><span style="color:${INK500};font-weight:700">第${r.period}期 <span style="color:${INK300};font-weight:400">PQ ${fmt(r.PQ)}</span></span><span style="font-weight:700;color:${gCol}">G ${fmtA(r.G)}</span></div>
        <div style="position:relative;height:28px;border-radius:6px;overflow:hidden;background:${CANVAS};border:1px solid ${LINE}">
          <div style="position:absolute;inset:0;display:flex">${seg(v, '#37a36b', '変動費 ' + fmt(v))}${seg(fCov, '#3b6fd4', '固定費 ' + fmt(r.F))}${seg(prof, '#d98a06', '利益 ' + fmt(prof))}${seg(loss, '#c8322b', '損失 ' + fmt(loss))}</div>
          <div style="position:absolute;top:0;bottom:0;border-right:2px solid rgba(27,34,48,.55);left:${W(r.PQ)}%"></div>
        </div>
      </div>`
    })
    .join('')
}

// ============================================================================
// scoreCardsHTML — 最新期のハイライト4カード（経常利益G/売上PQ/粗利率/自己資本）
//   ＋前期比。 mock: renderScore() / delta()
// 返り値: { title, cards } を1つの HTML にまとめる（見出し＋カードグリッド）。
// ============================================================================
export function scoreCardsHTML(history: HistLite[]): string {
  if (!history.length) return ''
  const last = history[history.length - 1]!
  const prev = history.length > 1 ? history[history.length - 2]! : null

  const delta = (
    cur: number,
    pre: number | null,
    dUnit: string,
    higherGood = true,
  ): string => {
    if (pre == null)
      return `<span style="color:${INK300};font-size:11px">前期比 —</span>`
    const d = round(cur - pre)
    if (d === 0)
      return `<span style="color:${INK300};font-size:11px;font-weight:700">前期比 ±0</span>`
    const up = d > 0,
      c = up === higherGood ? '#15803d' : '#c8322b' // ＋＝増・▲＝減
    return `<span style="font-size:11px;font-weight:700;color:${c}">前期比 ${up ? '＋' : '▲'}${fmt(Math.abs(d))}${dUnit}</span>`
  }

  const card = (label: string, valHtml: string, deltaHtml: string): string =>
    `<div style="background:#fff;border-radius:16px;box-shadow:${CARD_SHADOW};border:1px solid ${LINE};padding:16px">
      <div style="color:${INK400};font-size:11px;font-weight:700;margin-bottom:4px">${label}</div>
      <div style="font-weight:900;font-size:20px;line-height:1">${valHtml}</div>
      <div style="margin-top:6px">${deltaHtml}</div></div>`

  const gCol = last.G < 0 ? ACCENT_INK : G_INK
  const title = `第${last.period}期のハイライト${prev ? `（第${prev.period}期比）` : ''}`
  const cards =
    card('経常利益 G', `<span style="color:${gCol}">${fmtA(last.G)}</span>`, delta(last.G, prev ? prev.G : null, '')) +
    card('売上 PQ', fmt(last.PQ), delta(last.PQ, prev ? prev.PQ : null, '')) +
    card(
      '粗利率',
      `${round(mRate(last))}<span style="font-size:12px;font-weight:700;color:${INK400};margin-left:2px">%</span>`,
      delta(mRate(last), prev ? mRate(prev) : null, 'pt'),
    ) +
    card('自己資本', fmt(equityOf(last)), delta(equityOf(last), prev ? equityOf(prev) : null, ''))

  return `<div style="font-weight:700;margin-bottom:8px">${title}</div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">${cards}</div>`
}

// ============================================================================
// insightsHTML — 自動の気づき（黒字赤字/最高益/粗利率トレンド/損益分岐点/
//   現金増減/自己資本成長）を箇条書き<ul>で生成。 mock: renderInsights()
// ============================================================================
export function insightsHTML(history: HistLite[]): string {
  if (!history.length) return ''
  const last = history[history.length - 1]!
  const prev = history.length > 1 ? history[history.length - 2]! : null
  const li = (ic: string, txt: string): string =>
    `<li style="display:flex;gap:8px"><span style="flex-shrink:0">${ic}</span><span style="color:${INK600}">${txt}</span></li>`
  const o: string[] = []
  o.push(
    li(
      last.G >= 0 ? '🟢' : '🔴',
      `第${last.period}期は<b>${last.G >= 0 ? '黒字' : '赤字'}</b>（経常利益 ${fmtA(last.G)}・当期利益 ${fmtA(last.net)}）。`,
    ),
  )
  if (history.length > 1) {
    const best = history.reduce((a, b) => (b.G > a.G ? b : a))
    const worst = history.reduce((a, b) => (b.G < a.G ? b : a))
    o.push(
      li(
        '🏆',
        `最高益は<b>第${best.period}期</b>（G ${fmtA(best.G)}）${worst.G !== best.G ? `、要改善は<b>第${worst.period}期</b>（G ${fmtA(worst.G)}）` : ''}。`,
      ),
    )
  }
  if (prev) {
    const d = round(mRate(last) - mRate(prev))
    o.push(
      li(
        d >= 0 ? '📈' : '📉',
        `粗利率 ${round(mRate(prev))}% → <b>${round(mRate(last))}%</b>（${d >= 0 ? '＋' : '▲'}${Math.abs(d)}pt）。${d < 0 ? '原価率の上昇か売価の下落。仕入単価・売価を点検。' : '付加価値づくりが効いています。'}`,
      ),
    )
  } else {
    o.push(li('🧮', `粗利率は <b>${round(mRate(last))}%</b>（売上に占める粗利の割合）。`))
  }
  const bep = bepRate(last)
  o.push(
    li(
      bep <= 80 ? '🟢' : bep <= 100 ? '🟡' : '🔴',
      `損益分岐点比率 <b>${round(bep)}%</b>（${bep < 100 ? `安全余裕 ${round(100 - bep)}%＝売上がこれだけ減っても黒字` : '固定費が粗利を超過。固定費の削減か粗利拡大が必要'}）。`,
    ),
  )
  if (prev) {
    const d = round(last.cashEnd - prev.cashEnd)
    o.push(
      li(
        d >= 0 ? '💰' : '⚠️',
        `現金 ${fmt(prev.cashEnd)} → <b>${fmt(last.cashEnd)}</b>（${d >= 0 ? '＋' : '▲'}${fmt(Math.abs(d))}）。${d < 0 ? '資金繰りに注意。' : ''}`,
      ),
    )
  }
  if (prev) {
    const d = round(equityOf(last) - equityOf(prev))
    o.push(
      li(
        '🏛️',
        `自己資本 ${fmt(equityOf(prev))} → <b>${fmt(equityOf(last))}</b>（${d >= 0 ? '＋' : '▲'}${fmt(Math.abs(d))}）。利益の蓄積が会社を強くします。`,
      ),
    )
  }
  return `<ul style="display:flex;flex-direction:column;gap:8px;list-style:none;margin:0;padding:0;color:${INK};font-size:13px">${o.join('')}</ul>`
}

// 未使用インポート回避のための型再エクスポート（呼び出し側が Result 履歴を扱うため）。
export type { HistLite, Result }
