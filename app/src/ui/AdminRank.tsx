// 成績一覧（表形式・グラフ形式）と CSV 出力。Admin.tsx から切り出したもので、中身は変えていない。
import { useState } from 'react'
import type { ApiOrgCompany } from '../lib/api'
import { fmt, fmtA, fmRatio } from '../lib/calc'
import { ORG_COLORS } from '../lib/figures-review'
import { OrgLineChart } from './OrgLineChart'

// ---- 成績一覧：表形式（転置＝行が指標・列が会社×期。指標クリックでソート）----
const RANK_ROWS: { k: string; label: string; get: (r: any) => number; cell: (r: any) => string }[] = [
  { k: 'PQ', label: '売上PQ', get: (r) => r.PQ, cell: (r) => fmt(r.PQ) },
  { k: 'mPQ', label: '粗利', get: (r) => r.mPQ, cell: (r) => fmtA(r.mPQ) },
  { k: 'F', label: '固定費', get: (r) => r.F, cell: (r) => fmtA(r.F) },
  { k: 'G', label: '経常G', get: (r) => r.G, cell: (r) => fmtA(r.G) },
  { k: 'net', label: '当期純', get: (r) => r.net, cell: (r) => fmtA(r.net) },
  { k: 'eq', label: '純資産', get: (r) => r.capEnd + r.retEnd, cell: (r) => fmtA(r.capEnd + r.retEnd) },
  { k: 'margin', label: '粗利率', get: (r) => (r.PQ ? (r.mPQ / r.PQ) * 100 : 0), cell: (r) => (r.PQ ? Math.round((r.mPQ / r.PQ) * 100) + '%' : '—') },
  { k: 'fm', label: 'FM比率', get: (r) => fmRatio(r), cell: (r) => fmRatio(r) + '%' },
  { k: 'cash', label: '現金', get: (r) => r.cashEnd, cell: (r) => fmtA(r.cashEnd) },
  { k: 'turns', label: 'ターン', get: (r) => r.turns, cell: (r) => String(r.turns) },
  { k: 'dec', label: '意思決定', get: (r) => r.decisions, cell: (r) => String(r.decisions) },
]

export function RankTable({ companies }: { companies: ApiOrgCompany[] }) {
  const [period, setPeriod] = useState(0) // 0 = 全期
  const [sort, setSort] = useState<{ k: string; dir: 'desc' | 'asc' } | null>(null)
  const periods = [...new Set(companies.flatMap((c) => (c.results || []).map((r: any) => r.period as number)))].sort((a, b) => a - b)
  let entries: { c: ApiOrgCompany; r: any }[] = companies.flatMap((c) =>
    (c.results || [])
      .slice()
      .sort((a: any, b: any) => a.period - b.period)
      .map((r: any) => ({ c, r })),
  )
  if (period) entries = entries.filter((e) => e.r.period === period)
  if (sort) {
    const row = RANK_ROWS.find((x) => x.k === sort.k)!
    entries = entries.slice().sort((a, b) => (sort.dir === 'desc' ? row.get(b.r) - row.get(a.r) : row.get(a.r) - row.get(b.r)))
  }
  // クリック: 降順 → 昇順 → 解除（会社・期の順に戻る）
  const clickSort = (k: string) => setSort((s) => (s?.k !== k ? { k, dir: 'desc' } : s.dir === 'desc' ? { k, dir: 'asc' } : null))

  if (!entries.length && !periods.length)
    return <p className="text-ink-300 text-sm p-6 text-center">成績データがありません。参加者が決算すると各期の成績が表示されます。</p>
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-xs">
        <label className="text-ink-400 font-bold">期</label>
        <select
          data-testid="rank-period"
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
        <span className="text-ink-300">指標名をクリックすると並べ替えできます（▼降順 → ▲昇順 → 解除）</span>
      </div>
      <table className="text-[12px] border-collapse" data-testid="admin-rank">
        <thead>
          <tr className="text-ink-600 border-b border-line bg-canvas">
            <th className="sticky left-0 z-10 bg-canvas px-2 py-1.5 text-left font-bold whitespace-nowrap">会社</th>
            {entries.map((e, i) => (
              <th key={i} className="px-2 py-1.5 text-right font-bold whitespace-nowrap border-l border-line/60">
                {e.c.name}
                <div className="text-ink-400 text-[10px] font-normal">{e.c.president || '—'}</div>
              </th>
            ))}
          </tr>
          <tr className="text-ink-400 border-b-2 border-line bg-canvas">
            <th className="sticky left-0 z-10 bg-canvas px-2 py-1 text-left font-bold">期</th>
            {entries.map((e, i) => (
              <th key={i} className="px-2 py-1 text-right num font-bold whitespace-nowrap border-l border-line/60">
                第{e.r.period}期
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RANK_ROWS.map((row) => (
            <tr key={row.k} className="border-b border-line/60">
              <th
                data-testid={`sort-${row.k}`}
                onClick={() => clickSort(row.k)}
                className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left font-bold whitespace-nowrap cursor-pointer select-none hover:bg-canvas"
                title="クリックで並べ替え"
              >
                {row.label}{' '}
                <span className={sort?.k === row.k ? 'text-ink' : 'text-ink-200'}>
                  {sort?.k === row.k ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                </span>
              </th>
              {entries.map((e, i) => (
                <td key={i} className={`px-2 py-1.5 text-right num whitespace-nowrap border-l border-line/40 ${row.get(e.r) < 0 ? 'text-accent-ink' : ''}`}>
                  {row.cell(e.r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- 成績一覧：グラフ形式（組織比較チャートを講師用に表示）----
export function RankCharts({ companies }: { companies: ApiOrgCompany[] }) {
  const withHist = companies.filter((c) => (c.results || []).length)
  if (!withHist.length)
    return <p className="text-ink-300 text-sm p-6 text-center">成績データがありません。参加者が決算すると各期の成績が表示されます。</p>
  const series = (get: (r: any) => number) =>
    withHist.map((c, i) => ({
      name: c.name,
      color: ORG_COLORS[i % ORG_COLORS.length],
      pts: (c.results || []).map((r: any) => ({ x: r.period, y: get(r) })),
    }))
  const CHARTS: { title: string; get: (r: any) => number; opt: { signed?: boolean; pct?: boolean } }[] = [
    { title: '売上 PQ の推移', get: (r) => r.PQ, opt: {} },
    { title: '経常利益 G の推移', get: (r) => r.G, opt: { signed: true } },
    { title: '当期純利益の推移', get: (r) => r.net, opt: { signed: true } },
    { title: '純資産の推移', get: (r) => r.capEnd + r.retEnd, opt: { signed: true } },
    { title: '粗利率の推移', get: (r) => (r.PQ ? (r.mPQ / r.PQ) * 100 : 0), opt: { pct: true } },
    { title: 'FM比率（損益分岐点比率）の推移', get: (r) => fmRatio(r), opt: { pct: true } },
  ]
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="admin-charts">
      {CHARTS.map((ch) => (
        <div key={ch.title} className="rounded-xl border border-line p-4">
          <h3 className="font-bold text-sm mb-2">{ch.title}</h3>
          <OrgLineChart series={series(ch.get)} signed={ch.opt.signed} pct={ch.opt.pct} />
        </div>
      ))}
    </div>
  )
}

export function downloadCsv(org: string, companies: ApiOrgCompany[]) {
  const header = ['組織コード', '会社名', '社長名', '期', '売上PQ', '粗利', '固定費', '経常利益', '当期純利益', '純資産', '粗利率%', 'FM比率%', '現金', 'ターン数', '意思決定回数']
  const lines = [header]
  companies.forEach((c) => {
    ;(c.results || [])
      .slice()
      .sort((a: any, b: any) => a.period - b.period)
      .forEach((r: any) => {
        lines.push([
          org,
          c.name,
          c.president || '',
          String(r.period),
          String(Math.round(r.PQ)),
          String(Math.round(r.mPQ)),
          String(Math.round(r.F)),
          String(Math.round(r.G)),
          String(Math.round(r.net)),
          String(Math.round(r.capEnd + r.retEnd)),
          r.PQ ? String(Math.round((r.mPQ / r.PQ) * 100)) : '',
          String(fmRatio(r)),
          String(Math.round(r.cashEnd)),
          String(r.turns),
          String(r.decisions),
        ])
      })
  })
  const csv = '﻿' + lines.map((row) => row.map((v) => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `MG成績_${org}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
