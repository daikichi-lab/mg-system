// 参加者の「組織」タブ（issue #65）。同じ研修の各社の最新決算の指数を並べ、
// 指数を押すとその指数の順位と推移グラフを出す。グラフに出す会社はチェックボックスで選ぶ。
// 数値はすべて各社の決算結果（results）から。記帳中の途中の数字は使わない（期の途中で順位が動かないように）。
import { useEffect, useState } from 'react'
import type { ApiOrgCompany } from '../lib/api'
import { fmt, fmtA, fmRatio } from '../lib/calc'
import { ORG_COLORS } from '../lib/figures-review'
import type { Game } from '../state/useGame'
import { OrgLineChart } from './OrgLineChart'

interface Metric {
  k: string
  label: string
  get: (r: any) => number
  f: (v: number) => string
  /** グラフの目盛り：signed＝マイナスあり／pct＝％ */
  opt: { signed?: boolean; pct?: boolean }
  /** 少ないほど良い指数（損益分岐点比率）は昇順で順位を付ける */
  low?: boolean
}

const METRICS: Metric[] = [
  { k: 'PQ', label: '売上', get: (r) => r.PQ, f: fmt, opt: {} },
  { k: 'G', label: '経常利益', get: (r) => r.G, f: fmtA, opt: { signed: true } },
  { k: 'net', label: '当期純利益', get: (r) => r.net, f: fmtA, opt: { signed: true } },
  { k: 'eq', label: '純資産', get: (r) => r.capEnd + r.retEnd, f: fmtA, opt: { signed: true } },
  { k: 'margin', label: '粗利率', get: (r) => (r.PQ ? Math.round((r.mPQ / r.PQ) * 100) : 0), f: (v) => `${v}%`, opt: { pct: true } },
  { k: 'fm', label: '損益分岐点比率', get: (r) => fmRatio(r), f: (v) => `${v}%`, opt: { pct: true }, low: true },
]

/** 各社の最新の決算結果（期の一番新しいもの）。決算が無ければ null */
const latestOf = (c: ApiOrgCompany): any | null => {
  const rs = c.results || []
  return rs.length ? rs.reduce((a: any, b: any) => (b.period > a.period ? b : a)) : null
}

/** グラフから外した会社はブラウザごとに覚えておく（研修ごと）。読めない環境では毎回全員を出す */
const hiddenKey = (org: string) => `mg-org-hidden:${org}`
function loadHidden(org: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(hiddenKey(org)) || '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
function saveHidden(org: string, hidden: Set<string>) {
  try {
    localStorage.setItem(hiddenKey(org), JSON.stringify([...hidden]))
  } catch {
    // 保存できなくても表示には影響しない
  }
}

/** 「グラフに出す会社」の開閉。研修によらず同じ好みなので研修ごとには分けない */
const LIST_OPEN_KEY = 'mg-org-pick-open'
function loadListOpen(): boolean {
  try {
    return localStorage.getItem(LIST_OPEN_KEY) !== '0'
  } catch {
    return true
  }
}
function saveListOpen(open: boolean) {
  try {
    localStorage.setItem(LIST_OPEN_KEY, open ? '1' : '0')
  } catch {
    // 保存できなくても表示には影響しない
  }
}

export default function OrgTab({ game, toast }: { game: Game; toast: (msg: string) => void }) {
  const st = game.st
  const [companies, setCompanies] = useState<ApiOrgCompany[] | null>(null)
  const [metricKey, setMetricKey] = useState('PQ')
  // チェックを外した会社（＝グラフに出さない）。新しく参加した会社は最初から出るよう「外した側」を持つ
  const [hidden, setHidden] = useState<Set<string>>(() => loadHidden(st.org))
  // 「グラフに出す会社」の欄を開いているか。ブラウザごとに覚える（読めない環境では開いた状態）
  const [listOpen, setListOpen] = useState<boolean>(() => loadListOpen())
  const toggleList = (open: boolean) => {
    setListOpen(open)
    saveListOpen(open)
  }
  const load = async () => setCompanies(await game.refreshOrg())
  // 更新ボタン用：取得後にトースト表示
  const reload = async () => {
    await load()
    toast('更新しました')
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.version])

  if (!companies)
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-line p-6 text-center">
        <button data-testid="org-refresh" onClick={reload} className="h-10 px-4 rounded-lg bg-ink text-white font-bold text-sm">
          最新を取得
        </button>
      </div>
    )

  const metric = METRICS.find((m) => m.k === metricKey) ?? METRICS[0]
  // 決算のある会社だけを比べる。色は会社の並び順で固定（チェックを外しても他社の色が変わらない）
  const withHist = companies.filter((c) => latestOf(c))
  const colorOf = new Map(withHist.map((c, i) => [c.name, ORG_COLORS[i % ORG_COLORS.length]]))
  const noHist = companies.filter((c) => !latestOf(c))

  // 「グラフに出す会社」でチェックした会社。順位表・指数のタブの順位・グラフのすべてをこの会社だけで出す
  const shown = withHist.filter((c) => !hidden.has(c.name))
  // 指数ごとの順位（最新決算の値・チェックした会社の中で）。同じ値は同じ順位にする
  const ranking = (m: Metric) => {
    const arr = shown
      .map((c) => ({ c, r: latestOf(c), v: m.get(latestOf(c)) }))
      .sort((a, b) => (m.low ? a.v - b.v : b.v - a.v))
    return arr.map((x) => ({ ...x, rank: 1 + arr.filter((y) => (m.low ? y.v < x.v : y.v > x.v)).length }))
  }
  const rows = ranking(metric)
  const mine = (m: Metric) => ranking(m).find((x) => x.c.name === st.name)
  // 自社の最新決算（チェックを外していても値は出す。順位は出さない）
  const myCompany = withHist.find((c) => c.name === st.name)

  const toggle = (name: string) => {
    const next = new Set(hidden)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setHidden(next)
    saveHidden(st.org, next)
  }
  const setAll = (show: boolean) => {
    const next = show ? new Set<string>() : new Set(withHist.map((c) => c.name))
    setHidden(next)
    saveHidden(st.org, next)
  }
  const series = shown.map((c) => ({
      name: c.name,
      color: colorOf.get(c.name)!,
      me: c.name === st.name,
      pts: (c.results || []).map((r: any) => ({ x: r.period, y: metric.get(r) })),
    }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-bold">
          組織 {st.org}{' '}
          <span className="text-ink-300 text-sm font-normal" data-testid="org-count">
            （{withHist.length}社）
          </span>
        </h2>
        <button data-testid="org-refresh" onClick={reload} className="h-9 px-3 rounded-lg border border-line text-sm font-bold">
          更新
        </button>
      </div>

      {!withHist.length ? (
        <p className="text-ink-300 text-sm p-4 bg-white rounded-2xl border border-line">まだ成績がありません。各社が決算すると表示されます。</p>
      ) : (
        <>
          {/* グラフに出す会社を選ぶ欄。会社名・社長名とチェックボックスだけ（順位や値は下の順位表に出す）。折りたためる */}
          <div className="bg-white rounded-2xl shadow-card border border-line p-4" data-testid="org-pick">
            <div className={`flex items-center justify-between gap-2 flex-wrap ${listOpen ? 'mb-3' : ''}`}>
              {/* 見出しを押すと折りたたむ／開く */}
              <button
                data-testid="org-pick-toggle"
                onClick={() => toggleList(!listOpen)}
                aria-expanded={listOpen}
                className="font-bold text-sm text-left flex items-baseline gap-1.5"
              >
                <span className="text-ink-400 text-xs w-3 inline-block">{listOpen ? '▼' : '▶'}</span>
                グラフに出す会社
                <span className="text-ink-400 text-[11px] font-normal">
                  {withHist.length - withHist.filter((c) => hidden.has(c.name)).length}／{withHist.length}社
                </span>
              </button>
              {listOpen && (
                <div className="flex gap-1 text-[11px] font-bold">
                  <button data-testid="org-check-all" onClick={() => setAll(true)} className="h-7 px-2 rounded-md border border-line">
                    全員を出す
                  </button>
                  <button data-testid="org-check-none" onClick={() => setAll(false)} className="h-7 px-2 rounded-md border border-line">
                    全員外す
                  </button>
                </div>
              )}
            </div>
            {listOpen && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
                  {withHist.map((c) => {
                    const me = c.name === st.name
                    const on = !hidden.has(c.name)
                    return (
                      <label
                        key={c.name}
                        className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer select-none transition ${
                          on ? 'border-line bg-white' : 'border-line/60 bg-canvas opacity-60'
                        } ${me ? 'ring-1 ring-amber-300' : ''}`}
                      >
                        <input
                          type="checkbox"
                          data-testid={`org-check-${c.name}`}
                          checked={on}
                          onChange={() => toggle(c.name)}
                          className="w-4 h-4 shrink-0"
                          style={{ accentColor: colorOf.get(c.name) }}
                        />
                        <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorOf.get(c.name) }} />
                        <span className="min-w-0 leading-tight">
                          <span className="block text-[13px] font-bold truncate">
                            {c.name}
                            {me && <span className="text-ink-400 text-[11px] font-normal"> (あなた)</span>}
                          </span>
                          <span className="block text-[11px] text-ink-400 truncate">社長：{c.president || '—'}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
                {noHist.length > 0 && (
                  <p className="mt-2 text-[11px] text-ink-400" data-testid="org-nohist">
                    決算前（グラフには出ません）：{noHist.map((c) => `${c.name}（${c.president || '—'}）`).join('、')}
                  </p>
                )}
              </>
            )}
          </div>

          {/* 指数のタブ。押すとその指数の順位とグラフに切り替わる。自社の最新値と順位も出す */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2" data-testid="org-metrics">
            {METRICS.map((m) => {
              const me = mine(m)
              const on = m.k === metric.k
              return (
                <button
                  key={m.k}
                  data-testid={`org-metric-${m.k}`}
                  onClick={() => setMetricKey(m.k)}
                  className={`text-left rounded-xl border px-3 py-2 transition ${
                    on ? 'bg-ink text-white border-ink shadow-sm' : 'bg-white border-line hover:border-ink-300'
                  }`}
                >
                  <div className={`text-[11px] font-bold ${on ? 'text-white/80' : 'text-ink-500'}`}>{m.label}</div>
                  {myCompany ? (
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="num font-black text-lg">{m.f(m.get(latestOf(myCompany)))}</span>
                      {/* 順位はチェックした会社の中で。自社のチェックを外しているときは順位を出さない */}
                      <span className={`num text-[11px] ${on ? 'text-white/80' : 'text-ink-400'}`} data-testid={`org-metric-${m.k}-rank`}>
                        {me ? `${me.rank}/${shown.length}位` : '順位外'}
                      </span>
                    </div>
                  ) : (
                    <div className={`text-[11px] ${on ? 'text-white/70' : 'text-ink-300'}`}>自社は決算前</div>
                  )}
                </button>
              )
            })}
          </div>

          {/* 選んだ指数の推移。チェックの付いた会社だけ。画面幅いっぱいに出す */}
          <div className="bg-white rounded-2xl shadow-card border border-line p-4" data-testid="org-chart">
            <h3 className="font-bold text-sm mb-2">{metric.label}の推移</h3>
            {series.length ? (
              <OrgLineChart series={series} signed={metric.opt.signed} pct={metric.opt.pct} fluid />
            ) : (
              <p className="text-ink-300 text-xs py-6 text-center">グラフに出す会社を上の「グラフに出す会社」でチェックしてください。</p>
            )}
          </div>


          {/* 選んだ指数の順位（最新の決算・チェックした会社の中で）。グラフの下に全幅で出す */}
          <div className="bg-white rounded-2xl shadow-card border border-line p-4">
            <h3 className="font-bold text-sm mb-2">
              {metric.label}の順位
              <span className="text-ink-400 text-[11px] font-normal ml-1">
                最新の決算・チェックした {shown.length}社の中で{metric.low ? '・低いほど上位' : ''}
              </span>
            </h3>
            {!rows.length && <p className="text-ink-300 text-xs py-4 text-center">上の「グラフに出す会社」でチェックした会社の順位が出ます。</p>}
            {rows.length > 0 && (
            <table className="w-full text-[13px]" data-testid="org-rank">
              <thead>
                <tr className="text-[11px] text-ink-400">
                  <th className="font-normal text-left py-1 w-12">順位</th>
                  <th className="font-normal text-left py-1 px-1">会社名／社長名</th>
                  <th className="font-normal text-right py-1 pl-1">{metric.label}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => {
                  const me = x.c.name === st.name
                  return (
                    <tr key={x.c.name} className={`border-t border-line/60 ${me ? 'bg-amber-50' : ''}`} data-testid={`org-row-${x.c.name}`}>
                      <td className="py-1.5 font-bold num">{x.rank}位</td>
                      <td className="py-1.5 px-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorOf.get(x.c.name) }} />
                          <span className="font-bold truncate">{x.c.name}</span>
                          {me && <span className="text-ink-400 text-[11px] shrink-0">(あなた)</span>}
                        </div>
                        <div className="text-[11px] text-ink-400 pl-4">
                          社長：{x.c.president || '—'}
                          <span className="num text-ink-300 ml-1.5">第{x.r.period}期</span>
                        </div>
                      </td>
                      <td className={`py-1.5 pl-1 text-right num font-bold ${x.v < 0 ? 'text-accent-ink' : ''}`}>{metric.f(x.v)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
