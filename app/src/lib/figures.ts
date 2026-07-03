// 決算書ビジュアル図（STRAC / P/L・CF ウォーターフォール / B/S）
// mock/index.html の図描画関数を TypeScript 移植。
// すべてインラインスタイルで組み立てる（Tailwind クラスは使わない — 文字列内クラスは purge されるため）。
import { fmt, fmtA, type Result } from './calc.ts'

// .num 相当（等幅数字フォント）
const NUM = "font-family:'Roboto Mono','Zen Kaku Gothic New',monospace;font-variant-numeric:tabular-nums"

// ============================================================
// STRAC 面積図（インラインCSS・自己完結）
// 売上単価P → 変動単価V/粗利単価M → 個数Q → 売上高PQ柱 → 変動費vPQ(上) / 粗利mPQ ｜ 固定費F＋利益G
// ============================================================
export function stracHTML(r: Result): string {
  const f = fmt
  const fA = fmtA
  const Q = r.Q || 0
  const P = Q ? Math.round(r.PQ / Q) : 0
  const vP = Q ? Math.round(r.vPQ / Q) : 0
  const mP = P - vP
  const costRate = r.PQ ? Math.round((r.vPQ / r.PQ) * 100) : 0
  const grossRate = r.PQ ? Math.round((r.mPQ / r.PQ) * 100) : 0
  const bep = r.mPQ ? Math.round((r.F / r.mPQ) * 100) : 0

  const PQv = Math.max(r.PQ, 1)
  const MAXH = 140
  const maxVal = Math.max(PQv, r.vPQ + r.F, 1)
  const sc = MAXH / maxVal
  const hpx = (v: number) => Math.max(2, Math.round(Math.abs(v) * sc))
  const loss = r.G < 0
  const pqH = Math.max(34, Math.round(PQv * sc))
  const vH = hpx(r.vPQ)
  const mH = Math.max(2, pqH - vH)
  let fH = 0
  let gH = 0
  let lossH = 0
  let fHloss = 0
  if (!loss) {
    fH = Math.min(mH, hpx(r.F))
    gH = Math.max(2, mH - fH)
  } else {
    lossH = hpx(-r.G)
    fHloss = mH + lossH
  }

  const blk = (h: number, bg: string, col: string, label: string, val: string, note: string) =>
    `<div style="height:${h}px;background:${bg};color:${col};display:grid;place-items:center;text-align:center;overflow:hidden;padding:0 2px"><div><div style="font-size:8px;line-height:1.05">${label}</div><div style="${NUM};font-weight:800;font-size:11px;line-height:1.05">${val}</div>${note ? `<div style="font-size:6.5px;opacity:.8;line-height:1.05">${note}</div>` : ''}</div></div>`
  const pillar = (w: number, bg: string, bd: string, inner: string) =>
    `<div style="width:${w}px;height:${pqH}px;background:${bg};border:1px solid ${bd};border-radius:4px;display:grid;place-items:center;text-align:center;overflow:hidden;flex:none">${inner}</div>`

  const fig = `<div style="max-width:560px;margin:0 auto;overflow-x:auto"><div style="display:flex;align-items:flex-start;gap:4px;min-width:max-content">
        ${pillar(34, '#fbe7d3', '#e08a3c', `<div><div style="font-size:7px;color:#b5630f">売上単価</div><div style="font-size:8px;font-weight:700;color:#b5630f">P</div><div style="${NUM};font-weight:900;font-size:12px;color:#b5630f">${f(P)}</div></div>`)}
        <div style="width:34px;height:${pqH}px;border:1px solid #e1e5ea;border-radius:4px;overflow:hidden;display:flex;flex-direction:column;flex:none">
          <div style="height:${vH}px;background:#37a36b;color:#fff;display:grid;place-items:center;text-align:center"><div><div style="font-size:7px">変動単価</div><div style="${NUM};font-weight:700;font-size:10px">${f(vP)}</div></div></div>
          <div style="height:${mH}px;background:#fbe4ee;color:#9d3464;display:grid;place-items:center;text-align:center"><div><div style="font-size:7px">粗利単価</div><div style="${NUM};font-weight:700;font-size:10px">${f(mP)}</div></div></div>
        </div>
        <div style="height:${pqH}px;display:flex;align-items:center;flex:none"><div style="background:#eaeef3;border:1px solid #b9c2cf;border-radius:4px;padding:3px 5px;text-align:center"><div style="font-size:7px;color:#5b6472">個数 Q</div><div style="${NUM};font-weight:800;font-size:12px">× ${f(Q)}</div></div></div>
        ${pillar(56, '#fbe7d3', '#e08a3c', `<div><div style="font-size:8px;font-weight:700;color:#b5630f">売上高 PQ</div><div style="${NUM};font-weight:900;font-size:13px;color:#b5630f">${f(r.PQ)}</div><div style="font-size:6.5px;color:#9aa3b2">P × Q</div></div>`)}
        <div style="width:240px;max-width:60vw;flex:none;display:flex;flex-direction:column;min-width:0">
          <div style="height:${vH}px;background:#37a36b;color:#fff;border:1px solid #2f8d5c;border-bottom:0;border-radius:4px 4px 0 0;display:grid;place-items:center;text-align:center"><div><div style="font-size:8px">変動費 vPQ</div><div style="${NUM};font-weight:800;font-size:11px">${f(r.vPQ)}</div><div style="font-size:6.5px;opacity:.85">売上原価</div></div></div>
          <div style="display:flex;align-items:flex-start">
            ${
              loss
                ? `<div style="flex:1;height:${fHloss}px;border:1px solid #e1e5ea;border-right:0;border-radius:0 0 0 4px;overflow:hidden;display:flex;flex-direction:column">${blk(mH, '#fbe4ee', '#9d3464', '粗利益 mPQ', f(r.mPQ), '売上−変動費')}${blk(lossH, '#f7d0c8', '#b23a36', '経常損失 G', fA(r.G), '固定費に不足')}</div>
                 <div style="flex:1;height:${fHloss}px;background:#3b6fd4;color:#fff;border:1px solid #335fb8;border-radius:0 0 4px 0;display:grid;place-items:center;text-align:center"><div><div style="font-size:8px">固定費 F</div><div style="${NUM};font-weight:800;font-size:11px">${f(r.F)}</div></div></div>`
                : `<div style="flex:1;height:${mH}px;background:#fbe4ee;color:#9d3464;border:1px solid #e1e5ea;border-right:0;border-radius:0 0 0 4px;display:grid;place-items:center;text-align:center"><div><div style="font-size:8px">粗利益 mPQ</div><div style="${NUM};font-weight:800;font-size:11px">${f(r.mPQ)}</div><div style="font-size:6.5px;opacity:.8">売上−変動費</div></div></div>
                 <div style="flex:1;height:${mH}px;border:1px solid #e1e5ea;border-radius:0 0 4px 0;overflow:hidden;display:flex;flex-direction:column">${blk(fH, '#3b6fd4', '#fff', '固定費 F', f(r.F), '')}${blk(gH, '#f6cf4b', '#6b5300', '経常利益 G', f(r.G), '粗利−固定費')}</div>`
            }
          </div>
        </div>
      </div></div>`

  const chip = (l: string, v: string) =>
    `<span style="border:1px solid #d6dae0;border-radius:5px;padding:1px 6px;font-size:9px">${l} <b style="${NUM}">${v}</b></span>`

  return (
    fig +
    `<div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:center;background:#f4f6f8;border-radius:5px;padding:3px 5px;margin-top:5px;font-size:9px"><b style="color:#46505f">固定費 F ${f(r.F)} ＝</b><span>人件費 <b style="${NUM}">${f(r.laborF)}</b></span><span>販売費 <b style="${NUM}">${f(r.sellF)}</b></span><span>管理費 <b style="${NUM}">${f(r.adminF)}</b></span><span>減価償却 <b style="${NUM}">${f(r.depF)}</b></span></div>` +
    `<div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin-top:4px">${chip('売上個数 Q', f(Q))}${chip('原価率', costRate + '%')}${chip('粗利率', grossRate + '%')}${chip('損益分岐点', bep + '%')}${chip('経常利益 G', fA(r.G))}</div>`
  )
}

// ============================================================
// ウォーターフォール共通描画（インラインSVG, viewBox 760x232）
// ============================================================
interface WFBar {
  l: string
  lo: number
  hi: number
  v: number
  c: string
  tc?: string
  top: number
}
function wfSVG(bars: WFBar[], opts?: { plus?: boolean }): string {
  const o = opts || {}
  const sv = (v: number) => (v < 0 ? '▲' + fmt(-v) : (o.plus ? '+' : '') + fmt(v))
  const allV = bars.flatMap((b) => [b.lo, b.hi]).concat([0])
  let maxV = Math.max(...allV)
  let minV = Math.min(...allV)
  if (maxV === minV) maxV = minV + 1
  const padHi = (maxV - minV) * 0.12
  maxV += padHi
  minV -= padHi * 0.5
  const n = bars.length
  const W = 760
  const H = 232
  const padT = 12
  const padB = 38
  const padX = 18
  const span = maxV - minV
  const Y = (v: number) => padT + ((maxV - v) / span) * (H - padT - padB)
  const slot = (W - padX * 2) / n
  const barW = Math.min(110, slot * 0.56)
  const cx = (i: number) => padX + slot * i + slot / 2
  const zeroY = Y(0)
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;min-width:420px">`
  s += `<line x1="${padX}" y1="${zeroY.toFixed(1)}" x2="${W - padX}" y2="${zeroY.toFixed(1)}" stroke="#c0c7d0" stroke-width="1"/>`
  for (let i = 0; i < n - 1; i++) {
    const y = Y(bars[i].top).toFixed(1)
    s += `<line x1="${(cx(i) + barW / 2).toFixed(1)}" y1="${y}" x2="${(cx(i + 1) - barW / 2).toFixed(1)}" y2="${y}" stroke="#b9c2cf" stroke-width="1" stroke-dasharray="3 3"/>`
  }
  bars.forEach((b, i) => {
    const x = cx(i) - barW / 2
    const yTop = Y(b.hi)
    const h = Y(b.lo) - Y(b.hi)
    const zero = Math.abs(b.v) < 0.5
    if (zero) {
      s += `<line x1="${x.toFixed(1)}" y1="${zeroY.toFixed(1)}" x2="${(cx(i) + barW / 2).toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="${b.c}" stroke-width="3.5"/>`
    } else {
      s += `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2, h).toFixed(1)}" rx="2.5" fill="${b.c}"/>`
    }
    const inside = h > 24
    const ly = zero ? zeroY - 8 : inside ? (yTop + Y(b.lo)) / 2 + 5 : b.v >= 0 ? yTop - 6 : Y(b.lo) + 15
    const lc = zero ? '#46505f' : inside ? b.tc || '#fff' : '#46505f'
    s += `<text x="${cx(i).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="${lc}">${sv(b.v)}</text>`
    s += `<text x="${cx(i).toFixed(1)}" y="${H - 20}" text-anchor="middle" font-size="12" font-weight="600" fill="#5b6472">${b.l}</text>`
  })
  return s + '</svg>'
}

// ============================================================
// P/L ウォーターフォール：売上高 → −変動費 → 粗利 → −人件費 −減価償却 −販売費 −管理費 → 経常利益
// ============================================================
export function plWaterfallHTML(r: Result): string {
  const PQ = r.PQ
  const vPQ = r.vPQ
  const mPQ = r.mPQ
  const G = r.G
  let run = 0
  const bars: WFBar[] = []
  bars.push({ l: '売上高', lo: Math.min(0, PQ), hi: Math.max(0, PQ), v: PQ, c: '#7b93d0', tc: '#fff', top: PQ })
  run = PQ
  const add = (l: string, d: number, col: string, tc?: string) => {
    const s = run
    run += d
    bars.push({ l, lo: Math.min(s, run), hi: Math.max(s, run), v: d, c: col, tc: tc || '#fff', top: run })
  }
  add('変動費', -vPQ, '#f2e3b0', '#8a6d12')
  bars.push({ l: '粗利', lo: Math.min(0, mPQ), hi: Math.max(0, mPQ), v: mPQ, c: '#c2dab8', tc: '#357036', top: mPQ })
  run = mPQ
  add('人件費', -r.laborF, '#7e8794')
  add('減価償却', -r.depF, '#8fc4e2', '#1f5e85')
  add('販売費', -r.sellF, '#b23b34')
  add('管理費', -r.adminF, '#bf9b1e')
  bars.push({ l: '経常利益', lo: Math.min(0, G), hi: Math.max(0, G), v: G, c: G < 0 ? '#d98a86' : '#caa12a', tc: '#fff', top: G })
  return wfSVG(bars, { plus: false })
}

// ============================================================
// CF ウォーターフォール：期首現金 → 営業CF → 投資CF → 財務CF → 期末現金
// ============================================================
export function cfWaterfallHTML(r: Result): string {
  const c = r.colTot || Array(11).fill(0)
  const opCF = c[2] + c[3] - c[5] - c[6] - c[7] - c[8] - c[10]
  const invCF = -c[4]
  const finCF = c[0] + c[1] - c[9]
  const open = r.openCash || 0
  const end = open + opCF + invCF + finCF
  let run = 0
  const bars: WFBar[] = []
  bars.push({ l: '期首現金', lo: Math.min(0, open), hi: Math.max(0, open), v: open, c: '#334155', tc: '#fff', top: open })
  run = open
  const add = (l: string, d: number, col: string) => {
    const s = run
    run += d
    bars.push({ l, lo: Math.min(s, run), hi: Math.max(s, run), v: d, c: col, tc: '#fff', top: run })
  }
  add('営業CF', opCF, '#c0392b')
  add('投資CF', invCF, '#d98324')
  add('財務CF', finCF, '#7e6bb0')
  bars.push({ l: '期末現金', lo: Math.min(0, end), hi: Math.max(0, end), v: end, c: '#5b8fc9', tc: '#fff', top: end })
  return wfSVG(bars, { plus: true })
}

// ============================================================
// B/S 図：資産カラム（現金/在庫/什器） vs 負債・純資産カラム（未払税/借入/資本/剰余）
// ============================================================
export function bsFigureHTML(r: Result, h?: number): string {
  const tot = Math.max(1, r.assets, r.liabEq)
  const ht = h || 180
  // 淡色の背景＋濃色の文字（[背景,文字]）
  const PAL: Record<string, [string, string]> = {
    cash: ['#cdebe6', '#0c6a60'],
    inv: ['#d8ecd8', '#357036'],
    eq: ['#e4dcf3', '#5e44a0'],
    tax: ['#e7e9ec', '#535b67'],
    loan: ['#fdf3c7', '#8a6f0e'],
    cap: ['#fbe0ea', '#a83567'],
    ret: ['#fdeacf', '#a85a10'],
  }
  const seg = (v: number, p: [string, string], label: string) =>
    v > 0
      ? `<div style="height:${((v / tot) * 100).toFixed(2)}%;background:${p[0]};color:${p[1]};border-bottom:1px solid rgba(255,255,255,.85);display:grid;place-items:center;overflow:hidden"><span style="font-size:10px;font-weight:700;line-height:1.15;padding:0 4px;text-align:center">${label}<br><span style="${NUM}">${fmt(v)}</span></span></div>`
      : ''
  const assetCol = seg(r.cashEnd, PAL.cash, '現金') + seg(r.endInvVal, PAL.inv, '在庫') + seg(r.equipEnd, PAL.eq, '什器')
  let liabCol = seg(r.tax, PAL.tax, '未払税') + seg(r.loanEnd, PAL.loan, '借入金')
  if (r.retEnd >= 0) liabCol += seg(r.capEnd, PAL.cap, '資本金') + seg(r.retEnd, PAL.ret, '剰余金')
  else liabCol += seg(r.capEnd + r.retEnd, PAL.cap, '純資産')
  const colSty =
    'display:flex;flex-direction:column;border-radius:8px;overflow:hidden;border:1px solid #e4e7ec;background:#f6f7f9'
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;height:${ht}px">
        <div style="${colSty}">${assetCol || '<div style="margin:auto;color:#9aa3b2;font-size:11px">—</div>'}</div>
        <div style="${colSty}">${liabCol || '<div style="margin:auto;color:#9aa3b2;font-size:11px">—</div>'}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center;font-size:11px;font-weight:700;color:#5b6472;margin-top:4px"><span>資産 ${fmt(r.assets)}</span><span>負債・純資産 ${fmt(r.liabEq)}</span></div>`
}
