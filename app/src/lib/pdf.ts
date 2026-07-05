// 決算書 PDF シート（A3縦・1枚）を組み立てる。
// mock/index.html の buildSheet(r) 相当。既存の図関数（figures.ts / figures-account.ts）を再利用し、
// 現金出納帳（記帳）と 損益/貸借/CF の数値表のみここで生成する。
// すべてインラインスタイル（Tailwind クラスは purge されるため文字列内では使わない）。
import { fmt, fmtA, IN_COLS, COL_LABELS, type Result, type TxRow } from './calc.ts'
import { stracHTML, plWaterfallHTML, cfWaterfallHTML, bsFigureHTML } from './figures.ts'
import {
  cashAccountHTML,
  inventoryCountHTML,
  inventoryValueHTML,
  equipHTML,
  loanHTML,
  taxTableHTML,
} from './figures-account.ts'

// ---- ユーザー入力文字列のエスケープ（XSS対策）----
// r.name / r.president / tx.label / tx.note のみユーザー由来。それ以外はすべて数値。
function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---- 現金出納帳（11列 ア〜コ）の配色 [ヘッダ, セル, 文字] ----
const LCOL: readonly (readonly [string, string, string])[] = [
  ['#fbe0ea', '#fdf1f6', '#b03a6a'], // ア 資本金
  ['#fdf3c7', '#fef9e6', '#9a7d10'], // イ 借入金
  ['#fde3c4', '#fef3e6', '#b5630f'], // ウ 売上
  ['#fce8ef', '#fdf4f8', '#b85c7e'], // A 受取保険金
  ['#e4dcf3', '#f3eefb', '#6b4fa0'], // エ 什器
  ['#d8ecd8', '#eef7ee', '#3f7a3f'], // オ 材料仕入
  ['#d6e6f7', '#eef5fc', '#2f5f93'], // カ 人件費
  ['#d3ecf2', '#eef8fb', '#1f7a8c'], // キ 販売費
  ['#dfe2f5', '#f1f2fb', '#4a55a8'], // ク 管理費
  ['#fdf3c7', '#fef9e6', '#9a7d10'], // ケ 借入金返済
  ['#e7e9ec', '#f5f6f7', '#5b6472'], // コ 納税
]

// ---- 出納帳の列見出し（記号 / 名称）。COL_LABELS から分解 ----
function ledgerHead(): { s: string; n: string }[] {
  return COL_LABELS.map((l) => {
    const i = l.indexOf(' ')
    return i >= 0 ? { s: l.slice(0, i), n: l.slice(i + 1) } : { s: '', n: l }
  })
}

// ---- 現金出納帳テーブル（r.rows から。空行で様式の縦長さを再現）----
function ledgerHTML(r: Result): string {
  const drows: TxRow[] = r.rows || []
  const target = Math.max(16, drows.length)
  let bal = r.openCash || 0
  let body = `<tr><td class="rn"></td><td class="kk">期首繰越</td>${'<td></td>'.repeat(11)}<td class="bal">${fmt(bal)}</td></tr>`
  for (let idx = 0; idx < target; idx++) {
    const t = drows[idx]
    if (t) {
      if (t.col != null) bal += IN_COLS.includes(t.col) ? t.amount : -t.amount
      let cells = ''
      for (let c = 0; c < 11; c++) {
        const dv = c === 4 ? 'border-left:1.3px solid #9aa3b2;' : ''
        const on = t.col === c && t.amount
        const col = LCOL[c]!
        cells += `<td style="${dv}${on ? `background:${col[0]};color:${col[2]};font-weight:700;` : ''}">${on ? fmt(t.amount) : ''}</td>`
      }
      const label = escapeHtml(t.label || '')
      const note = t.note ? ` <span class="nt">${escapeHtml(t.note)}</span>` : ''
      body += `<tr><td class="rn">${idx + 1}</td><td class="kk">${label}${note}</td>${cells}<td class="bal">${fmt(bal)}</td></tr>`
    } else {
      let cells = ''
      for (let c = 0; c < 11; c++) {
        const dv = c === 4 ? 'border-left:1.3px solid #9aa3b2;' : ''
        cells += `<td style="${dv}"></td>`
      }
      body += `<tr><td class="rn">${idx + 1}</td><td class="kk"></td>${cells}<td class="bal"></td></tr>`
    }
  }
  const ct = r.colTot || Array(11).fill(0)
  let tcells = ''
  for (let c = 0; c < 11; c++) {
    const dv = c === 4 ? 'border-left:1.3px solid #9aa3b2;' : ''
    const col = LCOL[c]!
    tcells += `<td style="${dv}background:${col[1]};color:${col[2]};font-weight:700">${ct[c] ? fmt(ct[c]!) : ''}</td>`
  }
  const heads = ledgerHead()
  const hcol = heads
    .map(
      (h, c) =>
        `<th style="${c === 4 ? 'border-left:1.3px solid #9aa3b2;' : ''}background:${LCOL[c]![1]};color:${LCOL[c]![2]}"><div class="hs">${h.s}</div><div>${h.n}</div></th>`,
    )
    .join('')
  return `<table class="led">
      <thead>
        <tr><th rowspan="2" class="rn"></th><th rowspan="2" class="kk">勘定科目</th><th colspan="4" class="grp" style="background:#dceaf6;color:#2f5f93">入　金　＋</th><th colspan="7" class="grp" style="background:#e7e9ef;color:#4a55a8;border-left:1.3px solid #9aa3b2">出　金　−</th><th rowspan="2">現金残高</th></tr>
        <tr>${hcol}</tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot><tr class="tot"><td class="rn"></td><td class="kk">合計</td>${tcells}<td class="bal">${fmt(r.cashEnd)}</td></tr></tfoot>
    </table>`
}

// ---- box / kv ヘルパ（右カラムの数値表用）----
function kv(l: string, v: string, c?: string): string {
  return `<div class="kv"><span>${l}</span><b class="num"${c ? ` style="color:${c}"` : ''}>${v}</b></div>`
}
function box(mk: string, title: string, inner: string, bd: string): string {
  const b = bd || '#5b6472'
  return `<div class="box" style="border-color:${b}"><div class="bt" style="background:${b}">${mk ? `<span class="mkn">${mk}</span>` : ''}${title}</div><div class="bb">${inner}</div></div>`
}
// 図を包むだけの薄いラッパ（色つきヘッダ＋中身）
function figWrap(mk: string, title: string, inner: string, bd: string): string {
  return box(mk, title, inner, bd)
}

// ---- 損益の数値表（P/L）----
function plTable(r: Result): string {
  const costRate = r.PQ ? Math.round((r.vPQ / r.PQ) * 100) : 0
  const grossRate = r.PQ ? Math.round((r.mPQ / r.PQ) * 100) : 0
  const bep = r.mPQ ? Math.round((r.F / r.mPQ) * 100) : 0
  return box(
    '',
    '損益の数値表（P/L）',
    kv('売上高 PQ (ウ)', fmt(r.PQ), '#b5630f') +
      kv('変動費 vPQ（売上原価）', fmt(r.vPQ), '#2f7d54') +
      kv('粗利益 mPQ (PQ−vPQ)', fmt(r.mPQ), '#cf4d80') +
      `<div class="sub">固定費 F ＝ ${fmt(r.F)}</div>` +
      kv('　人件費 (カ)', fmt(r.laborF)) +
      kv('　販売費 (キ)', fmt(r.sellF)) +
      kv('　管理費 (ク)', fmt(r.adminF)) +
      kv('　減価償却', fmt(r.depF)) +
      kv('経常利益 G (mPQ−F)', fmtA(r.G), '#9a7d10') +
      kv('法人税 (コ)', fmt(r.tax)) +
      kv('当期純利益', fmtA(r.net), '#b85c7e') +
      kv('原価率／粗利率／損益分岐点', `${costRate}% ／ ${grossRate}% ／ ${bep}%`),
    '#2f5f93',
  )
}

// ---- 貸借の数値表（B/S）----
function bsTable(r: Result): string {
  const liab = r.tax + r.loanEnd
  const equity = r.capEnd + r.retEnd
  return box(
    '⓲',
    '貸借の数値表（B/S）',
    `<div class="bs"><div class="bsc">` +
      kv('現金', fmt(r.cashEnd)) +
      kv('在庫', fmt(r.endInvVal)) +
      kv('什器', fmt(r.equipEnd)) +
      `<div class="kv tt"><span>資産合計</span><b class="num">${fmt(r.assets)}</b></div></div><div class="bsc">` +
      kv('未払法人税等', fmt(r.tax)) +
      kv('借入金', fmt(r.loanEnd)) +
      `<div class="kv st"><span>負債合計</span><b class="num">${fmt(liab)}</b></div>` +
      kv('資本金', fmt(r.capEnd)) +
      kv('利益剰余金', fmtA(r.retEnd)) +
      `<div class="kv st"><span>純資産合計</span><b class="num">${fmt(equity)}</b></div>` +
      `<div class="kv tt"><span>負債・純資産合計</span><b class="num">${fmt(r.liabEq)}</b></div></div></div>` +
      `<div class="diff">差 ＝ ${fmtA(r.diff)} ${Math.abs(r.diff) < 0.5 ? '（0でOK）' : '（要確認）'}</div>`,
    '#2f5f93',
  )
}

// ---- CF の数値表 ----
function cfTable(r: Result): string {
  const c = r.colTot || Array(11).fill(0)
  const opCF = c[2]! + c[3]! - c[5]! - c[6]! - c[7]! - c[8]! - c[10]!
  const invCF = -c[4]!
  const finCF = c[0]! + c[1]! - c[9]!
  const netCF = opCF + invCF + finCF
  return box(
    '',
    'キャッシュフローの数値表',
    `<div class="sub">営業活動によるCF</div>` +
      kv('　売上収入 (ウ)', fmt(c[2]!)) +
      kv('　受取保険金 (A)', fmt(c[3]!)) +
      kv('　材料仕入 (オ)', fmtA(-c[5]!)) +
      kv('　人件費 (カ)', fmtA(-c[6]!)) +
      kv('　販売費 (キ)', fmtA(-c[7]!)) +
      kv('　管理費 (ク)', fmtA(-c[8]!)) +
      kv('　法人税 (コ)', fmtA(-c[10]!)) +
      kv('営業CF', fmtA(opCF), '#0f766e') +
      `<div class="sub">投資活動によるCF</div>` +
      kv('　什器の購入 (エ)', fmtA(-c[4]!)) +
      kv('投資CF', fmtA(invCF), '#6b4fa0') +
      `<div class="sub">財務活動によるCF</div>` +
      kv('　資本金 (ア)', fmt(c[0]!)) +
      kv('　借入 (イ)', fmt(c[1]!)) +
      kv('　借入金返済 (ケ)', fmtA(-c[9]!)) +
      kv('財務CF', fmtA(finCF), '#9a7d10') +
      kv('現金の増減（営業＋投資＋財務）', fmtA(netCF)) +
      kv('期首現金', fmt(r.openCash)) +
      kv('期末現金', fmt((r.openCash || 0) + netCF)),
    '#5b8fc9',
  )
}

// ---- スタイル（mock #pdf-sheet 相当。A3縦・コンパクト印刷）----
const SHEET_CSS = `<style>
  #pdf-inner{ width:283mm; min-height:402mm; background:#fff; color:#1b2230; font-family:"Zen Kaku Gothic New",sans-serif; font-size:11px; line-height:1.3; display:flex; flex-direction:column; }
  #pdf-inner .num{ font-family:"Roboto Mono","Zen Kaku Gothic New",monospace; font-variant-numeric:tabular-nums; }
  #pdf-inner .hd{ display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2.5px solid #1b2230; padding-bottom:3px; margin-bottom:6px; }
  #pdf-inner .hd .t1{ font-weight:900; font-size:17px; }
  #pdf-inner .hd .t2{ font-size:10px; color:#5b6472; }
  #pdf-inner .hd .co b{ font-size:15px; }
  #pdf-inner .wrap{ flex:1; display:grid; grid-template-columns:43% 57%; gap:6px; align-items:stretch; }
  #pdf-inner .ledcol{ display:flex; flex-direction:column; gap:5px; }
  #pdf-inner .ledcol .ledbox{ flex:1; display:flex; flex-direction:column; }
  #pdf-inner .ledcol .ledbox .bb{ flex:1; display:flex; padding:2px; }
  #pdf-inner table.led{ width:100%; height:100%; border-collapse:collapse; font-size:8.5px; }
  #pdf-inner table.led th,#pdf-inner table.led td{ border:0.5px solid #c2c7ce; padding:0 2px; text-align:right; }
  #pdf-inner table.led th{ font-weight:700; vertical-align:bottom; padding:1px 2px; }
  #pdf-inner table.led .grp{ text-align:center; font-size:9.5px; padding:2px; }
  #pdf-inner table.led .hs{ font-size:7px; opacity:.7; }
  #pdf-inner table.led td.rn,#pdf-inner table.led th.rn{ width:5mm; text-align:center; color:#9aa3b2; font-size:7px; }
  #pdf-inner table.led td.kk,#pdf-inner table.led th.kk{ text-align:left; white-space:nowrap; width:29mm; max-width:29mm; overflow:hidden; }
  #pdf-inner table.led .nt{ color:#9aa3b2; font-size:7px; }
  #pdf-inner table.led td.bal{ font-family:"Roboto Mono",monospace; font-weight:700; width:13mm; }
  #pdf-inner table.led tfoot td{ background:#eef0f2; font-weight:700; border-top:1.3px solid #5b6472; }
  #pdf-inner .right{ display:flex; flex-direction:column; gap:5px; }
  #pdf-inner .col2{ display:grid; grid-template-columns:1fr 1fr; gap:5px; }
  #pdf-inner .col3{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; }
  #pdf-inner .box{ border:1.2px solid #5b6472; border-radius:5px; overflow:hidden; }
  #pdf-inner .box .bt{ color:#fff; font-weight:700; padding:2px 7px; font-size:11px; }
  #pdf-inner .box .mkn{ display:inline-block; margin-right:5px; }
  #pdf-inner .box .bb{ padding:2px 3px; }
  #pdf-inner .kv{ display:flex; justify-content:space-between; gap:8px; padding:0.5px 6px; border-bottom:0.5px dotted #dfe2e6; font-size:10px; line-height:1.25; }
  #pdf-inner .kv:last-child{ border-bottom:0; }
  #pdf-inner .kv span{ color:#46505f; }
  #pdf-inner .kv b{ font-size:10.5px; }
  #pdf-inner .sub{ font-weight:700; padding:1px 6px 0; color:#2f5f93; font-size:10.5px; }
  #pdf-inner .bs{ display:grid; grid-template-columns:1fr 1fr; gap:6px; }
  #pdf-inner .kv.st{ border-top:0.5px dashed #9aa3b2; border-bottom:0; font-weight:700; }
  #pdf-inner .kv.tt{ border-top:1.2px solid #5b6472; border-bottom:0; font-weight:800; }
  #pdf-inner .diff{ text-align:right; font-weight:700; padding:3px 6px 0; font-size:11px; }
  #pdf-inner, #pdf-inner *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; box-sizing:border-box; }
</style>`

// ============================================================
// 決算書シート（A3縦・1枚）全体を HTML 文字列で返す。
// 左：現金出納帳 ＋ 6補助勘定図（現金勘定/什器 ／ 借入金/棚卸個数 ／ 在庫金額/税金計算）
// 右：STRAC図 / P/Lウォーターフォール / 貸借対照図 / 損益数値表・貸借数値表 / CF図 / CF数値表
// ============================================================
export function buildPdfSheet(r: Result): string {
  const ledger = `<div class="box ledbox" style="border-color:#5b6472"><div class="bt" style="background:#5b6472"><span class="mkn">📒</span>現金出納帳</div><div class="bb">${ledgerHTML(r)}</div></div>`

  // 左カラムの補助勘定図（既存の figures-account.ts を再利用）。
  // これらは自前で色つきヘッダ＋カード枠を持つため、PDF側の外枠(figWrap)で二重に囲まない。
  // 外枠を外した分だけ現金出納帳（記帳欄）を縦に伸ばせる。手順番号(❺〜⓲)はタイトルへ付与。
  const cashAcc = cashAccountHTML(r, '❿')
  const equipAcc = equipHTML(r, '⓭')
  const loanAcc = loanHTML(r, '⓮')
  const invBox = inventoryValueHTML(r, '⓬')
  const countBox = inventoryCountHTML(r, '❺')
  const taxBox = taxTableHTML(r, '⓱')

  // 右カラムの図（既存の figures.ts を再利用）
  const plFig = figWrap('⓯', 'STRAC 図（変動損益）', stracHTML(r), '#2f5f93')
  const wfPL = figWrap('', 'P/L ウォーターフォール図', `<div style="overflow-x:auto">${plWaterfallHTML(r)}</div>`, '#7b93d0')
  const bsFig = figWrap('⓲', '貸借対照表 図', bsFigureHTML(r, 104), '#2f5f93')
  const cfFig = figWrap('', 'キャッシュフロー図（現金の増減）', `<div style="overflow-x:auto">${cfWaterfallHTML(r)}</div>`, '#5b8fc9')

  const name = escapeHtml(r.name) || '—'
  const president = escapeHtml(r.president) || '—'

  return (
    SHEET_CSS +
    `<div class="hd">
        <div><div class="t1">戦略MG 製造業版入門編（ケーキ屋経営）　決算書</div><div class="t2">ゲーム前：前期繰越と❶〜❹　／　ゲーム後：❺〜⓲</div></div>
        <div class="co" style="text-align:right"><div><b>第${r.period}期</b></div><div class="t2">社名：${name}　社長名：${president}</div></div>
      </div>
      <div class="wrap">
        <div class="ledcol">
          ${ledger}
          <div class="col2">${cashAcc}${equipAcc}</div>
          <div class="col2">${loanAcc}${countBox}</div>
          <div class="col2">${invBox}${taxBox}</div>
        </div>
        <div class="right">
          ${plFig}
          ${wfPL}
          ${bsFig}
          <div class="col2">${plTable(r)}${bsTable(r)}</div>
          ${cfFig}
          ${cfTable(r)}
        </div>
      </div>`
  )
}

// ============================================================
// 印刷トリガ：#pdf-sheet に描画し、body.printing を付けて window.print()。
// 印刷後に printing クラスを外す。
// ============================================================
export function savePdf(r: Result): void {
  const el = document.getElementById('pdf-sheet')
  if (el) el.innerHTML = '<div id="pdf-inner">' + buildPdfSheet(r) + '</div>'
  document.body.classList.add('printing')
  const done = (): void => {
    document.body.classList.remove('printing')
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
}
