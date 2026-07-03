// 期末処理 / 決算タブの「勘定の図解」（補助勘定ボックス）
// mock/index.html の renderFigs() ＋ 法人税計算表 ＋ 入金/出金内訳を TypeScript 移植。
// すべてインラインスタイルで組み立てる（Tailwind クラスは使わない — 文字列内クラスは purge されるため）。
// 各関数は確定済みの Result を受け取り、HTML 文字列を返す純関数。
import { fmt, fmtA, type Result } from './calc.ts'

// ---- トークン（mock の Tailwind 設定 → インライン相当）----
// .num 相当（等幅数字フォント）
const NUM = "font-family:'Roboto Mono','Zen Kaku Gothic New',monospace;font-variant-numeric:tabular-nums"
const INK = '#1b2230' // ink DEFAULT
const INK600 = '#3a4252' // text-ink-600
const INK500 = '#6b7280' // text-ink-500（Tailwind デフォルト gray-500 にフォールバック）
const INK400 = '#6b7384' // text-ink-400
const INK300 = '#a0a7b4' // text-ink-300
const LINE = '#e4e7ec' // border-line
const CARD = 'box-shadow:0 1px 2px rgba(27,34,48,.04), 0 8px 24px -16px rgba(27,34,48,.20)' // shadow-card
// カード外枠（bg-white rounded-2xl shadow-card border border-line）
const CARDBOX = `background:#fff;border-radius:16px;${CARD};border:1px solid ${LINE};overflow:hidden`

// ---- ボックス配色（PDFの淡色。mock renderFigs と厳密一致）----
interface Tone {
  bg: string
  bd: string
}
const GN: Tone = { bg: '#e2f0e1', bd: '#a9cfa7' }
const TN: Tone = { bg: '#fdeacf', bd: '#e9bd8a' }
const PK: Tone = { bg: '#fbe0ea', bd: '#ecaac3' }
const SM: Tone = { bg: '#f7d0c8', bd: '#e2a094' }
const PP: Tone = { bg: '#e8e0f2', bd: '#bcabe0' }
const YL: Tone = { bg: '#fdf3c7', bd: '#e3cf72' }
const BL: Tone = { bg: '#d6e6f7', bd: '#9dbfe4' }
const AQ: Tone = { bg: '#d3ecf2', bd: '#9ed3df' }
const WT: Tone = { bg: '#ffffff', bd: '#e1e5ea' }

// ---- セル：丸数字＋ラベル（＋科目）／値（＋単位）／式 ----
// mock: flex-1 flex flex-col rounded-md px-2 py-1.5 min-height:52px
function cell(c: Tone, head: string, val: number, unit?: string, cap?: string, sub?: string): string {
  return (
    `<div style="flex:1;display:flex;flex-direction:column;border-radius:6px;padding:6px 8px;background:${c.bg};border:1px solid ${c.bd};min-height:52px">` +
    `<div style="font-size:10.5px;color:${INK600};line-height:1.25">${head}</div>` +
    `<div style="${NUM};font-weight:700;font-size:15px;line-height:1;margin-top:auto;padding-top:4px">${fmt(val)}${unit ? `<span style="font-size:9px;color:${INK400};font-weight:400;margin-left:2px">${unit}</span>` : ''}</div>` +
    (sub ? `<div style="font-size:9px;color:${INK400};line-height:1;margin-top:2px">${sub}</div>` : '') +
    (cap ? `<div style="font-size:9px;color:${INK400};line-height:1;margin-top:2px">${cap}</div>` : '') +
    `</div>`
  )
}

// ---- 在庫用セル：金額を大きく＋個数を併記 ----
// mock: flex-1 flex flex-col rounded-md px-2 py-2 min-height:66px
function cell2(c: Tone, head: string, qty: number | null, amount: number, cap?: string): string {
  return (
    `<div style="flex:1;display:flex;flex-direction:column;border-radius:6px;padding:8px 8px;background:${c.bg};border:1px solid ${c.bd};min-height:66px">` +
    `<div style="font-size:10.5px;color:${INK600};line-height:1.25">${head}</div>` +
    `<div style="${NUM};font-weight:900;font-size:20px;line-height:1;margin-top:auto;padding-top:4px">${fmt(amount)}</div>` +
    (qty != null
      ? `<div style="${NUM};font-size:12px;font-weight:700;color:${INK500};line-height:1.25;margin-top:4px">${fmt(qty)}<span style="font-size:9px;color:${INK400};font-weight:400;margin-left:2px">個</span></div>`
      : '') +
    (cap ? `<div style="font-size:9px;color:${INK400};line-height:1.25;margin-top:4px">${cap}</div>` : '') +
    `</div>`
  )
}

// ---- 列（縦積み）----
// mock: flex flex-col gap-1.5 flex-1
function colWrap(cells: string[]): string {
  return `<div style="display:flex;flex-direction:column;gap:6px;flex:1">${cells.join('')}</div>`
}

// ---- ヘッダ（色つき）----
// mock: px-4 py-2 text-sm font-bold text-white
function headBar(t: string, c: string): string {
  return `<div style="padding:8px 16px;font-size:14px;font-weight:700;color:#fff;background:${c}">${t}</div>`
}

// ---- 3列ボックス（色つきヘッダ＋白カード）----
// mock: bg-white rounded-2xl shadow-card border border-line overflow-hidden > head + p-3 > flex gap-1.5 items-stretch
function box(title: string, bar: string, c1: string[], c2: string[], c3: string[]): string {
  return (
    `<div style="${CARDBOX}">` +
    headBar(title, bar) +
    `<div style="padding:12px"><div style="display:flex;gap:6px;align-items:stretch">${colWrap(c1)}${colWrap(c2)}${colWrap(c3)}</div></div>` +
    `</div>`
  )
}

// ============================================================
// ❿ 現金勘定（期首現金 ＋ 入金 − 出金 ＝ 期末現金）
// ============================================================
export function cashAccountHTML(r: Result): string {
  return box(
    '現金勘定',
    '#c2685c',
    [cell(WT, '① 前期繰越', r.openCash, ''), cell(SM, `② 入金合計 <span style="color:${INK400}">⑧</span>`, r.inSum, '')],
    [cell(WT, '③ 合計', r.openCash + r.inSum, '', '(① ＋ ②)')],
    [cell(BL, '④ 出金合計', r.outSum, ''), cell(WT, '⑨ 次期繰越', r.cashEnd, '', '(③ − ④)')],
  )
}

// ============================================================
// ❺ 棚卸（個数計算）
// ① 前期繰越 ② 材料仕入 ③ 合計 ④ 売上 ⑤ 廃棄等 ⑥ 会社盤在庫 ⑦ 差異数
// ============================================================
export function inventoryCountHTML(r: Result): string {
  return box(
    '棚卸（個数計算）',
    '#3f7a3f',
    [
      cell(WT, '① 前期繰越', r.openMatQty, '個'),
      cell(GN, `② 材料仕入の個数 <span style="color:${INK400}">(オ)</span>`, r.matBoughtQty, '個'),
    ],
    [cell(WT, '③ 合計', r.totMatQty, '個', '(① ＋ ②)')],
    [
      cell(TN, `④ 売上の個数 <span style="color:${INK400}">(ウ)</span>`, r.salesQty, '個'),
      cell(SM, `⑤ 廃棄等 <span style="color:${INK400}">(水害・異物)</span>`, r.scrap, '個'),
      cell(TN, '⑥ 会社盤の在庫数', r.boardInvQty, '個'),
      cell(PK, '⑦ 差異数', r.diffQty, '個', '(③−④−⑤−⑥)'),
    ],
  )
}

// ============================================================
// ⓬ 在庫（棚卸資産）・原価計算（個数＋金額。金額を大きく表示）
// ① 前期繰越 ② 材料仕入 ③ 合計 ④ 平均単価 ⑦ 売上原価 ⑥ 廃棄等 ⑤ 次期繰越
// ============================================================
export function inventoryValueHTML(r: Result): string {
  return box(
    '在庫（棚卸資産）・原価計算',
    '#3f7a3f',
    [
      cell2(WT, '① 前期繰越', r.openMatQty, r.openMatVal),
      cell2(GN, `② 材料仕入 <span style="color:${INK400}">(オ)</span>`, r.matBoughtQty, r.matBoughtVal),
    ],
    [cell2(WT, '③ 合計', r.totMatQty, r.totMatVal, '(① ＋ ②)'), cell2(WT, '④ 平均単価', null, r.avg, '金額 ÷ 個数')],
    [
      cell2(GN, '⑦ 売上原価', r.salesQty, r.vPQ, '(③ − ⑤ − ⑥)'),
      cell2(PK, '⑥ 廃棄等', r.scrap, r.scrap * r.avg, '(④ × 個数)'),
      cell2(WT, '⑤ 次期繰越', r.endInvQty, r.endInvVal, '(④ × 個数)'),
    ],
  )
}

// ============================================================
// ⓭ 什器（前期繰越 ＋ 購入 − 減価償却 ＝ 次期繰越）
// ============================================================
export function equipHTML(r: Result): string {
  return box(
    '什器',
    '#6b4fa0',
    [cell(WT, '① 前期繰越', r.eq0, ''), cell(PP, `② 什器 <span style="color:${INK400}">(エ)</span>`, r.equipBought, '')],
    [cell(WT, '③ 合計', r.eq0 + r.equipBought, '', '(① ＋ ②)')],
    [cell(AQ, '④ 減価償却', r.dep, '', '(台数 × 10)'), cell(WT, '⑨ 次期繰越', r.equipEnd, '', '(③ − ④)')],
  )
}

// ============================================================
// ⓮ 借入金（前期繰越 ＋ 借入 − 返済 ＝ 次期繰越）
// ============================================================
export function loanHTML(r: Result): string {
  return box(
    '借入金',
    '#9a7d10',
    [cell(WT, '① 前期繰越', r.loan0, ''), cell(YL, `② 借入金 <span style="color:${INK400}">(イ)</span>`, r.loanBorrow, '')],
    [cell(WT, '③ 合計', r.loan0 + r.loanBorrow, '', '(① ＋ ②)')],
    [
      cell(WT, `④ 借入金返済 <span style="color:${INK400}">(ケ)</span>`, r.loanRepay, ''),
      cell(WT, '⑨ 次期繰越', r.loanEnd, '', '(③ − ④)'),
    ],
  )
}

// ============================================================
// 法人税・利益剰余金の計算表
// ① 特別損益 ② 税引前当期純利益(G＋①) ③ 前期繰越利益剰余金 ④ 合計(②＋③)
// ⑤ 法人税等（来期期首納税・最低5） ⑥ 当期純利益(②−⑤) ⑦ 次期繰越利益剰余金(⑥＋③)
// 3分岐：②か④が▲なら5／合計が+なら30%（前期繰越が▲のときは合計×30%）
// ============================================================
export function taxTableHTML(r: Result): string {
  // 1行（label / 値）— mock: flex justify-between
  const row = (label: string, valHTML: string, extra = ''): string =>
    `<div style="display:flex;justify-content:space-between;align-items:baseline${extra ? ';' + extra : ''}"><span style="color:${INK600}">${label}</span>${valHTML}</div>`
  const num = (v: string, color = INK): string =>
    `<b style="${NUM};font-weight:700;color:${color}">${v}</b>`

  return (
    `<div style="${CARDBOX.replace('overflow:hidden', 'padding:20px')}">` +
    `<h2 style="font-weight:700;margin:0 0 12px;font-size:16px;color:${INK}">法人税・利益剰余金の計算</h2>` +
    `<div style="display:flex;flex-direction:column;gap:8px;font-size:14px">` +
    row('① 特別損益', num(fmtA(r.special))) +
    row('② 税引前当期純利益（G ＋ ①）', num(fmtA(r.pretax))) +
    row('③ 前期繰越利益剰余金', num(fmtA(r.ret0))) +
    row('④ 合計（② ＋ ③）', num(fmtA(r.total4)), `border-top:1px dashed ${LINE};padding-top:8px`) +
    row(
      `⑤ 法人税等 <span style="color:${INK400};font-size:12px">来期期首納税</span>`,
      num(fmt(r.tax), '#9a7d10'),
    ) +
    row('⑥ 当期純利益（② − ⑤）', num(fmtA(r.net))) +
    row('⑦ 次期繰越利益剰余金（⑥ ＋ ③）', num(fmtA(r.retEnd)), `border-top:2px solid ${LINE};padding-top:8px;font-weight:700`) +
    `</div>` +
    `<p style="color:${INK400};font-size:11px;margin:12px 0 0;line-height:1.625">②か④が▲なら5を納税／合計が+なら30%（前期繰越が▲のときは合計×30%）。※最低納税額は5。</p>` +
    `</div>`
  )
}

// ============================================================
// 入金合計・出金合計（科目別の内訳つき）
// 入金：ア資本金/イ借入金/ウ売上/A受取保険金 ｜ 出金：エ什器/オ材料仕入/カ人件費/キ販売費/ク管理費/ケ返済/コ納税
// ============================================================
const COL_NAMES = [
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

export function inflowOutflowHTML(r: Result): string {
  const tot = r.colTot
  // 科目チップ（該当科目のみ横並び）— mock: chips()
  const chips = (cols: number[], c: string): string => {
    const a = cols.filter((i) => tot[i])
    if (!a.length) return `<div style="color:${INK300};font-size:12px">なし</div>`
    return (
      `<div style="display:flex;flex-wrap:wrap;gap:8px">` +
      a
        .map(
          (i) =>
            `<div style="border-radius:12px;border:1px solid ${c}40;background:#fff;padding:6px 10px;text-align:center">` +
            `<div style="font-size:11px;color:${INK500};white-space:nowrap;line-height:1.25">${COL_NAMES[i]}</div>` +
            `<div style="${NUM};font-weight:700;font-size:14px;line-height:1.25;color:${c}">${fmt(tot[i]!)}</div>` +
            `</div>`,
        )
        .join('') +
      `</div>`
    )
  }
  // 合計カード — mock: sumCard()
  const sumCard = (label: string, total: number, c: string, sign: string, cols: number[]): string =>
    `<div style="border-radius:16px;border:1px solid ${c}55;background:#fff;padding:16px">` +
    `<div style="font-size:14px;font-weight:700;margin-bottom:8px;color:${c}">${label}</div>` +
    chips(cols, c) +
    `<div style="margin-top:12px;padding-top:8px;border-top:1px solid ${LINE};display:flex;align-items:baseline;justify-content:space-between">` +
    `<div style="font-size:12px;color:${INK500}">合計</div>` +
    `<div style="${NUM};font-weight:900;font-size:24px;line-height:1;color:${c}">${sign}${fmt(total)}</div>` +
    `</div></div>`

  return (
    `<div style="display:flex;flex-direction:column;gap:16px">` +
    sumCard('入金合計', r.inSum, '#0f766e', '＋', [0, 1, 2, 3]) +
    sumCard('出金合計', r.outSum, '#5b6472', '−', [4, 5, 6, 7, 8, 9, 10]) +
    `</div>`
  )
}
