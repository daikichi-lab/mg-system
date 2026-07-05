// 会社盤（mock renderBoard の忠実移植）。
// Tailwind クラスは本番ビルドでパージされるため、すべてインラインスタイルで描画する。
// 数値データのみから生成し、ユーザ入力文字列は含まない（安全に dangerouslySetInnerHTML 可）。
import { caps, type St } from './calc'

const GREEN = '#69a86a'
const INK600 = '#3a4252'
const INK500 = '#565d6b'
const INK400 = '#6b7384'
const INK300 = '#a0a7b4'
const NUM = "font-family:'Roboto Mono',ui-monospace,monospace"

const CUBE =
  'width:20px;height:20px;border-radius:4px;background:#8b5e3c;box-shadow:inset 0 2px 2px rgba(255,255,255,.45),inset 0 -3px 3px rgba(0,0,0,.34),0 1px 1px rgba(0,0,0,.18)'
const HEX =
  'width:20px;height:20px;background:#8a929e;clip-path:polygon(25% 2%,75% 2%,100% 50%,75% 98%,25% 98%,0 50%);box-shadow:inset 0 -2px 3px rgba(0,0,0,.3)'
const dot = (c: string) =>
  `width:18px;height:18px;border-radius:50%;background:${c};box-shadow:inset 0 2px 2px rgba(255,255,255,.4),inset 0 -2px 3px rgba(0,0,0,.28)`

// 立体駒を n 個並べる（max 超過分は +N 表記）
function pile(n: number, style: string, max = 15): string {
  let h = ''
  const k = Math.min(n, max)
  for (let i = 0; i < k; i++) h += `<span style="display:inline-block;${style}"></span>`
  if (n > max) h += `<span style="display:inline-block;color:${INK500};font-size:12px;margin-left:4px;align-self:center">+${n - max}</span>`
  return h
}

// スタッフの歩(♟)を n 個
function pawns(n: number): string {
  let h = ''
  const k = Math.min(n, 8)
  for (let i = 0; i < k; i++)
    h += `<span style="color:#b9c0cb;font-size:30px;line-height:1;text-shadow:0 1px 1px rgba(0,0,0,.3)">♟</span>`
  if (n > 8) h += `<span style="color:${INK500};font-size:12px;align-self:center">+${n - 8}</span>`
  return h || `<span style="color:${INK300};font-size:12px">—</span>`
}

// 材料/店舗の大きな箱
function box(title: string, pieces: string): string {
  const body = pieces || `<span style="color:${INK300};font-size:14px">空</span>`
  return `<div style="border:2.5px solid ${GREEN};border-radius:14px;background:#fcfefb;width:248px;padding:16px 18px;box-shadow:0 1px 3px rgba(0,0,0,.07)">
    <div style="font-size:14px;font-weight:700;color:${INK600};margin-bottom:12px;text-align:center">${title}</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;align-content:center;min-height:150px">${body}</div>
  </div>`
}

function staffBox(label: string, n: number): string {
  return `<div style="border:2px solid ${GREEN};border-radius:12px;background:#fcfefb;width:248px;padding:8px 12px;box-shadow:0 1px 2px rgba(0,0,0,.06);text-align:center">
    <div style="display:flex;gap:4px;justify-content:center;align-items:flex-end;flex-wrap:wrap;min-height:34px">${pawns(n)}</div>
    <div style="font-size:11px;font-weight:500;color:${INK600};margin-top:4px">${label}</div>
  </div>`
}

// 工程の矢印（材料仕入 / 製造 / 販売）
function barrow(label: string): string {
  return `<div style="display:flex;flex-direction:column;align-items:center;align-self:flex-start;padding-top:34px">
    <span style="font-size:11px;color:${INK600};margin-bottom:4px;white-space:nowrap">${label}</span>
    <span style="display:block;width:48px;height:26px;background:linear-gradient(180deg,#eaf4e8,#cfe6cd);clip-path:polygon(0 30%,60% 30%,60% 4%,100% 50%,60% 96%,60% 70%,0 70%);box-shadow:0 1px 1px rgba(0,0,0,.1)"></span>
  </div>`
}

// 小タイル（什器/保険/教育/商品開発/広告）
function tile(label: string, n: number, style: string): string {
  const pieces = pile(n, style, 8) || `<span style="color:${INK300};font-size:12px">—</span>`
  return `<div style="border:2px solid ${GREEN};border-radius:12px;background:#fcfefb;padding:8px 14px;text-align:center">
    <div style="display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap;min-height:20px">${pieces}</div>
    <div style="font-size:11px;color:${INK600};margin-top:4px;white-space:nowrap">${label}</div>
  </div>`
}

function cap(label: string, val: number, color: string, id: string): string {
  return `<div style="border:2px solid ${color}40;border-radius:12px;background:${color}0d;padding:10px 12px;text-align:center">
    <div style="font-size:11px;color:${INK500}">${label}</div>
    <div data-testid="${id}" style="${NUM};font-weight:700;font-size:24px;line-height:1.1;color:${color}">${val}</div>
  </div>`
}

export function boardHTML(st: St): string {
  const { mfgCap, salesCap, priceComp } = caps(st)
  return `<div style="border:2px solid ${GREEN};border-radius:18px;padding:16px">
    <div style="display:flex;align-items:center;justify-content:center;position:relative;margin-bottom:12px">
      <div style="letter-spacing:.4em;color:#a3bda3;font-weight:700;font-size:13px">会 社 盤</div>
      <div style="position:absolute;right:0;font-size:11px;color:${INK400}">第${st.period}期</div>
    </div>
    <div style="overflow-x:auto;padding-bottom:4px">
      <div style="display:flex;align-items:flex-start;gap:8px;justify-content:center;min-width:720px">
        ${barrow('材料仕入')}
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
          ${box('材料', pile(st.rawCubes, CUBE, 28))}
          ${staffBox('製造スタッフ', st.staffMfg)}
        </div>
        ${barrow('製造')}
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
          ${box('店舗', pile(st.products, CUBE, 28))}
          ${staffBox('販売スタッフ', st.staffSales)}
        </div>
        ${barrow('販売')}
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:12px">
      ${tile('什器', st.machines, HEX)}
      ${tile('保険', st.insurance, dot('#f3c218'))}
      ${tile('教育', st.edu, dot('#e8842a'))}
      ${tile('商品開発', st.dev, dot('#2f6fe0'))}
      ${tile('広告', st.ads, dot('#d64541'))}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px">
      ${cap('製造能力', mfgCap, '#2f6fe0', 'bd-mfgcap')}
      ${cap('販売能力', salesCap, '#e07b2a', 'bd-salescap')}
      ${cap('価格競争力', priceComp, '#2563eb', 'bd-price')}
    </div>
  </div>`
}
