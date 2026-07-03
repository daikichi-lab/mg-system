import { useEffect, useState } from 'react'
import {
  ACTIONS,
  caps,
  cashNow,
  colTotals,
  fmt,
  fmtA,
  ratios,
  cashflow,
  loanCap,
  fmRatio,
  IN_COLS,
  SALARY_TABLE,
  type St,
  type Result,
  type Fvals,
} from '../lib/calc'
import { eventFvals } from '../lib/game'
import { stracHTML, plWaterfallHTML, cfWaterfallHTML, bsFigureHTML } from '../lib/figures'
import {
  cashAccountHTML,
  inventoryCountHTML,
  inventoryValueHTML,
  equipHTML,
  loanHTML,
  taxTableHTML,
  inflowOutflowHTML,
} from '../lib/figures-account'
import { scoreCardsHTML, structureHTML, insightsHTML, lineChartHTML, multiLineHTML, ORG_COLORS } from '../lib/figures-review'
import { savePdf } from '../lib/pdf'
import { FORMS, A_KEYS, B_KEYS, EVENTS, type Field } from './actions'
import { useGame } from '../state/useGame'

// 数値データから生成した図解HTML（ユーザ入力を含まない）を描画
function Figure({ html, testid }: { html: string; testid?: string }) {
  return <div data-testid={testid} className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
}

const TABS = [
  ['company', '会社情報'],
  ['opening', '期首処理'],
  ['play', '記帳'],
  ['closing', '期末処理'],
  ['statement', '決算書'],
  ['history', '履歴'],
  ['review', '振り返り'],
  ['org', '組織'],
] as const
type TabKey = (typeof TABS)[number][0]

export default function Participant() {
  const game = useGame()
  const [tab, setTab] = useState<TabKey>('company')
  const [modalKey, setModalKey] = useState<string | null>(null)
  const [stmtView, setStmtView] = useState<Result | null>(null)
  const st = game.st

  if (!game.ready) return <div className="p-10 text-center text-ink-400">読み込み中…</div>

  const go = (t: TabKey) => {
    if (t === 'statement') setStmtView(null)
    setTab(t)
  }

  return (
    <div className="min-h-screen">
      <Header st={st} />
      <nav className="max-w-5xl mx-auto px-3 sm:px-6 pb-2 pt-3">
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1 bg-canvas border border-line rounded-xl p-1">
          {TABS.map(([k, label]) => {
            const locked = !st.started && k !== 'company'
            return (
              <button
                key={k}
                data-testid={`tab-${k}`}
                disabled={locked}
                onClick={() => go(k)}
                className={`rounded-lg py-2 text-[12px] sm:text-sm font-bold transition ${
                  tab === k ? 'bg-ink text-white shadow-sm' : locked ? 'text-ink-300' : 'text-ink-400 hover:text-ink'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
        {game.resumed && (
          <div
            data-testid="resume-banner"
            className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
          >
            <div className="text-sm text-emerald-800">
              🔄 <b>前回の続きを復元しました</b>
              <span className="text-emerald-700 font-normal">
                （{st.name}・第{st.period}期・記帳
                {st.tx.filter((t) => !t.isCapital && !t.isBorrowInterest).length}件）
              </span>
            </div>
            <button
              data-testid="reset-new"
              onClick={() => {
                if (confirm('現在のデータを破棄して新しく始めますか？')) game.resetAll()
              }}
              className="h-9 px-3 rounded-lg border border-emerald-400 text-emerald-800 text-xs font-bold hover:bg-emerald-100"
            >
              新しく始める
            </button>
          </div>
        )}
        {game.error && (
          <div data-testid="error" className="mb-4 rounded-xl border border-accent/40 bg-accent/5 text-accent-ink px-4 py-2.5 text-sm">
            {game.error}
            <button className="ml-2 underline" onClick={() => game.setError(null)}>
              閉じる
            </button>
          </div>
        )}

        {tab === 'company' && <CompanyTab game={game} onStarted={() => go('opening')} />}
        {tab === 'opening' && <OpeningTab st={st} />}
        {tab === 'play' && <PlayTab game={game} onOpen={setModalKey} onSettleTab={() => go('closing')} />}
        {tab === 'closing' && (
          <ClosingTab game={game} onStatement={() => go('statement')} onBackToPlay={() => go('play')} />
        )}
        {tab === 'statement' && (
          <StatementTab st={st} view={stmtView} onNext={() => game.next()} onBack={() => go('history')} />
        )}
        {tab === 'history' && (
          <HistoryTab
            history={game.history}
            onDetail={(r) => {
              setStmtView(r)
              setTab('statement')
            }}
          />
        )}
        {tab === 'review' && <ReviewTab history={game.history} />}
        {tab === 'org' && <OrgTab game={game} />}
      </main>

      {modalKey && (
        <ActionModal
          st={st}
          keyName={modalKey}
          onClose={() => setModalKey(null)}
          onAct={(k, f) => {
            const err = game.act(k, f)
            if (!err) setModalKey(null)
          }}
          onEvent={(k) => {
            const err = game.actEvent(k)
            if (!err) setModalKey(null)
          }}
        />
      )}
    </div>
  )
}

function Header({ st }: { st: St }) {
  return (
    <header className="bg-white border-b border-line sticky top-0 z-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent text-white font-black text-xs">MG</span>
          <div className="truncate">
            <div className="font-black leading-tight truncate">
              <span data-testid="hd-name">{st.name || '（未設定）'}</span>{' '}
              <span className="text-ink-300 font-normal text-sm" data-testid="hd-period">
                第{st.period}期
              </span>
            </div>
            <div className="text-ink-400 text-[11px] leading-tight">社長：{st.president || '—'}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-ink-400 text-[10px]">現金残高</div>
          <div className="num font-bold text-xl leading-none" data-testid="hd-cash">
            {fmt(cashNow(st))}
          </div>
        </div>
      </div>
    </header>
  )
}

// ------- 会社情報 -------
function CompanyTab({ game, onStarted }: { game: ReturnType<typeof useGame>; onStarted: () => void }) {
  const st = game.st
  const [name, setName] = useState(st.name)
  const [pres, setPres] = useState(st.president)
  const [org, setOrg] = useState(st.org || game.joinOrg)
  const [capital, setCapital] = useState(300)
  const started = st.started
  const canStart = name.trim() && pres.trim() && org.trim()

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-line p-5 space-y-4">
        <h1 className="text-xl font-black">会社情報</h1>
        <label className="block">
          <span className="text-sm font-medium">会社名</span>
          <input
            data-testid="c-name"
            value={name}
            disabled={started}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 h-11 w-full border border-line rounded-lg px-3 disabled:bg-canvas"
            placeholder="例）サンプル製菓"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">社長名</span>
          <input
            data-testid="c-pres"
            value={pres}
            disabled={started}
            onChange={(e) => setPres(e.target.value)}
            className="mt-1 h-11 w-full border border-line rounded-lg px-3 disabled:bg-canvas"
            placeholder="例）山田 太郎"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">組織コード</span>
          <input
            data-testid="c-org"
            value={org}
            disabled={started || !!game.joinOrg}
            onChange={(e) => setOrg(e.target.value)}
            className="mt-1 h-11 w-full border border-line rounded-lg px-3 disabled:bg-canvas"
            placeholder="例）MG2026"
          />
          <span className="text-ink-400 text-xs">同じ組織コードの会社を「組織」タブで比較できます。</span>
        </label>
        {!started && (
          <label className="block">
            <span className="text-sm font-medium">開業資本金</span>
            <input
              data-testid="c-capital"
              type="number"
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
              className="mt-1 h-11 w-full border border-line rounded-lg px-3 num"
            />
          </label>
        )}
        {started ? (
          <div className="rounded-lg bg-emerald-50 text-emerald-800 text-sm p-3">✓ 開始済みです。各タブをご利用ください。</div>
        ) : (
          <button
            data-testid="start"
            disabled={!canStart}
            onClick={async () => {
              await game.start(name.trim(), pres.trim(), org.trim(), capital)
              if (!game.error) onStarted()
            }}
            className="w-full h-11 rounded-xl bg-ink text-white font-bold disabled:opacity-40"
          >
            この内容で開始（資本金を記帳）
          </button>
        )}
      </div>
    </div>
  )
}

// ------- 期首処理 -------
function OpeningTab({ st }: { st: St }) {
  const first = st.period <= 1
  const openTax = st.tx.find((t) => t.isOpeningTax)?.amount || 0
  const openInt = st.tx.find((t) => t.isOpeningInterest)?.amount || 0
  const kv = (l: string, v: string, accent?: boolean) => (
    <div className="flex justify-between border-b border-line/70 py-1.5">
      <span className="text-ink-500">{l}</span>
      <span className={`num font-bold ${accent ? 'text-p-ink' : ''}`}>{v}</span>
    </div>
  )
  const token = (l: string, v: number) => (
    <div className="rounded-lg bg-cin-bg border border-cin-base/30 px-2 py-2 text-center">
      <div className="text-[10px] text-cin-ink whitespace-nowrap">{l}</div>
      <div className="num font-black text-lg text-cin-base">{v}</div>
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-cin-base/30 bg-cin-bg px-5 py-3">
        <h2 className="font-black text-cin-ink">第{st.period}期 期首</h2>
        <p className="text-cin-ink/80 text-xs mt-0.5">
          {first
            ? '第1期は前期繰越がありません。開業資本金からスタートします。'
            : '前期からの繰越です。第2期以降は借入・金利・期末返済があります。'}
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl shadow-card border border-line p-5 text-sm">
          <h2 className="font-bold mb-2">前期繰越</h2>
          {kv('現金', fmt(st.openingCash))}
          {kv('材料在庫（個数）', fmt(st.openingMatQty))}
          {kv('うち製品（個数）', fmt(st.openingProducts))}
          {kv('什器（簿価）', fmt(st.openingEquipVal))}
          {kv('資本金', fmt(st.openingCapital))}
          {kv('利益剰余金', fmtA(st.retained))}
          {kv('借入残高', fmt(st.openingLoan))}
          {!first && openTax > 0 && kv('法人税納付（期首）', '▲' + fmt(openTax), true)}
          {!first && openInt > 0 && kv('支払金利（期首）', '▲' + fmt(openInt), true)}
        </div>
        <div className="bg-white rounded-2xl shadow-card border border-line p-5">
          <h2 className="font-bold mb-3">盤面セットアップ</h2>
          <div className="grid grid-cols-4 gap-2">
            {token('製造ｽﾀｯﾌ', st.openingStaffMfg)}
            {token('販売ｽﾀｯﾌ', st.openingStaffSales)}
            {token('材料', st.openingMatQty - st.openingProducts)}
            {token('製品', st.openingProducts)}
            {token('開発', st.openingDev)}
            {token('広告', st.openingAds)}
            {token('機械', st.openingMachines)}
          </div>
          {!first && (
            <div className="mt-4 rounded-lg bg-canvas border border-line p-3 text-xs text-ink-500 space-y-1">
              <div className="font-bold text-ink">借入・金利・返済（第2期以降）</div>
              <div>借入可能枠 ＝ 純資産 × {st.loanMult}（現在の枠 {fmt(loanCap(st))}）</div>
              <div>金利 5% ／ 期末返済率 {st.repayRate}%</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ------- 記帳 -------
function PlayTab({
  game,
  onOpen,
  onSettleTab,
}: {
  game: ReturnType<typeof useGame>
  onOpen: (k: string) => void
  onSettleTab: () => void
}) {
  const st = game.st
  const c = caps(st)
  const disabled = st.settled || st.closingPrep
  const btn = (k: string) => (
    <button
      key={k}
      data-testid={`act-${k}`}
      disabled={disabled}
      onClick={() => onOpen(k)}
      className="h-11 rounded-xl border border-line bg-white font-bold text-sm hover:border-ink/40 disabled:opacity-40"
    >
      {ACTIONS[k].label}
    </button>
  )
  return (
    <div className="space-y-4">
      <StatusPanel st={st} />
      <div className="bg-white rounded-2xl shadow-sm border border-line p-4">
        <div className="text-xs font-bold text-ink-400 mb-2">ルールA（意思決定）</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{A_KEYS.map(btn)}</div>
        <div className="text-xs font-bold text-ink-400 mb-2 mt-4">ルールB（1ターン1回）</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{B_KEYS.map(btn)}</div>
        <div className="text-xs font-bold text-ink-400 mb-2 mt-4">イベントカード</div>
        <EventPicker disabled={disabled} onPick={onOpen} />
        <div className="text-ink-300 text-[11px] mt-2">
          製造能力 {c.mfgCap} / 販売能力 {c.salesCap}
        </div>
      </div>

      <Ledger st={st} onDelete={game.del} />

      <div className="flex gap-2 flex-wrap">
        <button
          data-testid="ledger-clear"
          onClick={() => {
            if (confirm('この期の記帳をすべて消去しますか？')) game.clear()
          }}
          className="h-11 px-4 rounded-xl border border-line text-ink-600 font-bold text-sm"
        >
          記帳を全消去
        </button>
        {!st.closingPrep && !st.settled && (
          <button
            data-testid="closing"
            onClick={() => {
              game.closing()
              onSettleTab()
            }}
            className="h-11 px-6 rounded-xl bg-ink text-white font-bold ml-auto"
          >
            期末処理を行う（給与・家賃を計上）→
          </button>
        )}
      </div>
    </div>
  )
}

function EventPicker({ disabled, onPick }: { disabled: boolean; onPick: (k: string) => void }) {
  const [key, setKey] = useState('')
  const cats = Array.from(new Set(EVENTS.map((e) => e.cat)))
  return (
    <div className="flex gap-2">
      <select
        data-testid="event-select"
        value={key}
        disabled={disabled}
        onChange={(e) => setKey(e.target.value)}
        className="flex-1 h-11 border border-line rounded-lg px-2 text-sm bg-white disabled:opacity-40"
      >
        <option value="">イベントを選択…</option>
        {cats.map((cat) => (
          <optgroup key={cat} label={cat}>
            {EVENTS.filter((e) => e.cat === cat).map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        data-testid="event-go"
        disabled={disabled || !key}
        onClick={() => onPick(key)}
        className="h-11 px-4 rounded-xl bg-ink text-white font-bold text-sm disabled:opacity-40"
      >
        記帳
      </button>
    </div>
  )
}

// 現金出納帳 11列（ア〜コ）の配色（決算書PDF準拠）と見出し
const LCOL = [
  { h: '#fbe0ea', c: '#fdf1f6', t: '#b03a6a' },
  { h: '#fdf3c7', c: '#fef9e6', t: '#9a7d10' },
  { h: '#fde3c4', c: '#fef3e6', t: '#b5630f' },
  { h: '#fce8ef', c: '#fdf4f8', t: '#b85c7e' },
  { h: '#e4dcf3', c: '#f3eefb', t: '#6b4fa0' },
  { h: '#d8ecd8', c: '#eef7ee', t: '#3f7a3f' },
  { h: '#d6e6f7', c: '#eef5fc', t: '#2f5f93' },
  { h: '#d3ecf2', c: '#eef8fb', t: '#1f7a8c' },
  { h: '#dfe2f5', c: '#f1f2fb', t: '#4a55a8' },
  { h: '#fdf3c7', c: '#fef9e6', t: '#9a7d10' },
  { h: '#e7e9ec', c: '#f5f6f7', t: '#5b6472' },
]
const LHEAD = [
  { s: 'ア', n: '資本金' },
  { s: 'イ', n: '借入金' },
  { s: 'ウ', n: '売上' },
  { s: 'A', n: '保険金' },
  { s: 'エ', n: '什器' },
  { s: 'オ', n: '材料仕入' },
  { s: 'カ', n: '人件費' },
  { s: 'キ', n: '販売費' },
  { s: 'ク', n: '管理費' },
  { s: 'ケ', n: '返済' },
  { s: 'コ', n: '納税' },
]

function StatusPanel({ st }: { st: St }) {
  const c = caps(st)
  const cell = (l: string, v: number | string, id?: string, accent?: boolean) => (
    <div className={`rounded-lg border px-2 py-1.5 text-center ${accent ? 'bg-cin-bg border-cin-base/30' : 'bg-canvas border-line'}`}>
      <div className="text-[10px] text-ink-400 whitespace-nowrap">{l}</div>
      <div className="num font-bold text-[15px]" data-testid={id}>
        {v}
      </div>
    </div>
  )
  return (
    <div className="bg-white rounded-2xl shadow-card border border-line p-3">
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
        {cell('製造ｽﾀｯﾌ', st.staffMfg, 'sp-mfg')}
        {cell('販売ｽﾀｯﾌ', st.staffSales, 'sp-sales')}
        {cell('材料', st.rawCubes, 'sp-raw')}
        {cell('製品', st.products, 'sp-prod')}
        {cell('開発', st.dev)}
        {cell('広告', st.ads)}
        {cell('機械', st.machines, 'sp-machines')}
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mt-2">
        {cell('保険', st.insurance)}
        {cell('教育', st.edu)}
        {cell('借入', fmt(st.loan), 'sp-loan')}
        {cell('現金', fmt(cashNow(st)), undefined, true)}
        {cell('製造能力', c.mfgCap)}
        {cell('販売能力', c.salesCap)}
        {st.period > 1 ? cell('借入枠', fmt(loanCap(st))) : cell('借入枠', '—')}
      </div>
    </div>
  )
}

function Ledger({ st, onDelete }: { st: St; onDelete: (id: number) => void }) {
  const tot = colTotals(st)
  let bal = st.openingCash
  const th = (i: number) => (
    <th
      key={i}
      className="px-1 py-1 text-center align-bottom whitespace-nowrap font-semibold"
      style={{ background: LCOL[i].h, color: LCOL[i].t }}
    >
      <div className="text-[9px] opacity-70 leading-none">{LHEAD[i].s}</div>
      <div className="text-[10px] leading-tight">{LHEAD[i].n}</div>
    </th>
  )
  return (
    <div className="bg-white rounded-2xl shadow-card border border-line overflow-x-auto">
      <table className="text-[11px] min-w-[920px] w-full" data-testid="ledger">
        <thead>
          <tr className="border-b border-line">
            <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left align-bottom font-semibold">摘要</th>
            {LHEAD.map((_, i) => th(i))}
            <th className="px-2 py-1 text-right align-bottom font-semibold">残高</th>
            <th className="px-1 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {st.tx.map((t) => {
            const hasCol = t.col !== null && t.col !== undefined
            if (hasCol && IN_COLS.includes(t.col as number)) bal += t.amount
            else if (hasCol) bal -= t.amount
            const locked = t.isClosing || t.isOpeningTax || t.isOpeningInterest || t.isBorrowInterest || t.isCapital
            const label = t.label || (t.key ? ACTIONS[t.key]?.label : '') || ''
            return (
              <tr key={t.id} className="border-b border-line/60">
                <td className="sticky left-0 z-10 bg-white px-2 py-1 whitespace-nowrap">
                  {label}
                  {t.note ? <span className="text-ink-300 ml-1">{t.note}</span> : null}
                </td>
                {LHEAD.map((_, i) => (
                  <td
                    key={i}
                    className="px-1 py-1 text-right num"
                    style={t.col === i ? { background: LCOL[i].c, color: LCOL[i].t } : undefined}
                  >
                    {t.col === i ? fmt(t.amount) : ''}
                  </td>
                ))}
                <td className="px-2 py-1 text-right num font-medium">{hasCol ? fmt(bal) : ''}</td>
                <td className="px-1 py-1 text-center">
                  {!locked && (
                    <button
                      data-testid={`del-${t.id}`}
                      onClick={() => onDelete(t.id)}
                      className="text-ink-300 hover:text-accent text-[10px]"
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-bold bg-canvas">
            <td className="sticky left-0 z-10 bg-canvas px-2 py-1.5">合計</td>
            {LHEAD.map((_, i) => (
              <td key={i} className="px-1 py-1.5 text-right num" style={{ color: LCOL[i].t }}>
                {tot[i] ? fmt(tot[i]) : ''}
              </td>
            ))}
            <td className="px-2 py-1.5 text-right num" data-testid="ledger-balance">
              {fmt(cashNow(st))}
            </td>
            <td></td>
          </tr>
          <tr className="text-ink-400 border-t border-line">
            <td className="sticky left-0 z-10 bg-white px-2 py-1 text-left">勘定科目</td>
            {LHEAD.map((h, i) => (
              <td key={i} className="px-1 py-1 text-center whitespace-nowrap" style={{ color: LCOL[i].t }}>
                <span className="text-[9px] opacity-70">{h.s}</span> {h.n}
              </td>
            ))}
            <td></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ------- 期末処理 -------
function ClosingTab({
  game,
  onStatement,
  onBackToPlay,
}: {
  game: ReturnType<typeof useGame>
  onStatement: () => void
  onBackToPlay: () => void
}) {
  const st = game.st
  if (st.settled && st.result) {
    const r = st.result
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl shadow-card border border-line p-4 flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm font-bold">第{r.period}期 決算済み・勘定の図解</p>
          <button data-testid="to-statement" onClick={onStatement} className="h-11 px-6 rounded-xl bg-ink text-white font-bold">
            決算書をみる →
          </button>
        </div>
        <Figure html={inflowOutflowHTML(r)} />
        <div className="grid sm:grid-cols-2 gap-4">
          <Figure html={cashAccountHTML(r)} />
          <Figure html={inventoryCountHTML(r)} />
          <Figure html={inventoryValueHTML(r)} />
          <Figure html={equipHTML(r)} />
          <Figure html={loanHTML(r)} />
          <Figure html={taxTableHTML(r)} />
        </div>
      </div>
    )
  }
  const SAL = SALARY_TABLE[st.period] || 28
  const head = st.staffMfg + st.staffSales
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-line p-5 space-y-2 text-sm">
        <h2 className="font-bold">期末処理（第{st.period}期）</h2>
        <div className="flex justify-between border-b border-line/70 py-1.5">
          <span>給料（人数 {head} × 給料表 {SAL}）</span>
          <span className="num font-bold">計上済み</span>
        </div>
        <div className="flex justify-between border-b border-line/70 py-1.5">
          <span>家賃</span>
          <span className="num font-bold">25</span>
        </div>
        <p className="text-ink-400 text-xs">
          {st.closingPrep
            ? '給与・家賃（と期末返済）を記帳に計上しました。決算にするか、記帳に戻れます。'
            : '記帳タブの「期末処理を行う」で計上します。'}
        </p>
      </div>
      <div className="flex gap-2">
        {st.closingPrep && (
          <button
            data-testid="undo-closing"
            onClick={() => {
              game.undoClose()
              onBackToPlay()
            }}
            className="h-11 px-4 rounded-xl border border-line font-bold text-ink-600"
          >
            記帳に戻る
          </button>
        )}
        <button
          data-testid="settle"
          onClick={() => {
            game.settleNow()
            onStatement()
          }}
          className="h-11 px-6 rounded-xl bg-accent text-white font-bold ml-auto"
        >
          この期を決算にする →
        </button>
      </div>
    </div>
  )
}

// ------- 決算書 -------
function StatementTab({
  st,
  view,
  onNext,
  onBack,
}: {
  st: St
  view: Result | null
  onNext: () => void
  onBack: () => void
}) {
  const [plView, setPlView] = useState<'strac' | 'wf'>('strac')
  const r = view || st.result
  if (!r) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-line p-8 text-center text-ink-400">
        決算するとここに決算書（P/L・貸借対照表・キャッシュフロー）が表示されます。
      </div>
    )
  }
  const rt = ratios(r)
  const cf = cashflow(r)
  const row = (l: string, v: string, testid?: string, bold?: boolean) => (
    <div className={`flex justify-between py-1 ${bold ? 'font-bold border-t border-line' : ''}`}>
      <span className={bold ? '' : 'text-ink-500'}>{l}</span>
      <span className="num" data-testid={testid}>
        {v}
      </span>
    </div>
  )
  return (
    <div className="space-y-4" data-testid="statement">
      {view && (
        <div className="flex items-center justify-between rounded-xl bg-ink/5 border border-line px-4 py-2.5">
          <span className="text-sm font-bold text-ink-600">📄 第{r.period}期の決算書を表示中</span>
          <button data-testid="stmt-back" onClick={onBack} className="h-9 px-4 rounded-lg bg-ink text-white font-bold text-sm">
            ← 履歴に戻る
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-line p-5">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="font-bold">戦略会計 STRAC 図</h2>
          <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5 text-xs font-bold">
            <button
              data-testid="pl-strac"
              onClick={() => setPlView('strac')}
              className={`px-3 py-1 rounded-md ${plView === 'strac' ? 'bg-ink text-white shadow-sm' : 'text-ink-400'}`}
            >
              STRAC
            </button>
            <button
              data-testid="pl-wf"
              onClick={() => setPlView('wf')}
              className={`px-3 py-1 rounded-md ${plView === 'wf' ? 'bg-ink text-white shadow-sm' : 'text-ink-400'}`}
            >
              ウォーターフォール
            </button>
          </div>
        </div>
        <Figure testid="strac-fig" html={plView === 'strac' ? stracHTML(r) : plWaterfallHTML(r)} />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl shadow-card border border-line p-5 text-sm">
          <h2 className="font-bold mb-2">損益計算（STRAC）</h2>
          {row('売上高 PQ', fmt(r.PQ), 'st-pq')}
          {row('変動費 vPQ', '▲' + fmt(r.vPQ), 'st-vpq')}
          {row('粗利益 mPQ', fmt(r.mPQ), 'st-mpq', true)}
          {row('固定費 F', '▲' + fmt(r.F), 'st-f')}
          {row('経常利益 G', fmtA(r.G), 'st-g', true)}
          <div className="text-ink-300 text-[11px] mt-1">
            粗利率 {rt.grossRate}% / 損益分岐点比率 {rt.bepRate}%
          </div>
          <div className="mt-2 pt-2 border-t border-line/70">
            {row('特別損益（保険金−廃棄損）', fmtA(r.special), 'st-special')}
            {row('税引前利益', fmtA(r.pretax), 'st-pretax')}
            {row('法人税', '▲' + fmt(r.tax), 'st-tax')}
            {row('当期純利益', fmtA(r.net), 'st-net', true)}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-card border border-line p-5 text-sm">
          <h2 className="font-bold mb-2">貸借対照表</h2>
          <Figure testid="bs-fig" html={bsFigureHTML(r, 150)} />
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div>
              <div className="text-ink-400 text-xs mb-1">資産</div>
              {row('現金', fmt(r.cashEnd), 'bs-cash')}
              {row('棚卸資産', fmt(r.endInvVal), 'bs-inv')}
              {row('什器', fmt(r.equipEnd), 'bs-equip')}
              {row('資産合計', fmt(r.assets), 'bs-assets', true)}
            </div>
            <div>
              <div className="text-ink-400 text-xs mb-1">負債・純資産</div>
              {row('未払法人税', fmt(r.tax), 'bs-tax')}
              {row('借入金', fmt(r.loanEnd), 'bs-loan')}
              {row('資本金', fmt(r.capEnd), 'bs-cap')}
              {row('利益剰余金', fmtA(r.retEnd), 'bs-ret')}
              {row('負債純資産計', fmt(r.liabEq), 'bs-liabeq', true)}
            </div>
          </div>
          <div
            data-testid="bs-check"
            className={`mt-2 text-center text-xs font-bold rounded py-1 ${
              Math.abs(r.diff) < 0.5 ? 'bg-emerald-50 text-emerald-700' : 'bg-accent/10 text-accent-ink'
            }`}
          >
            {Math.abs(r.diff) < 0.5 ? '✓ 貸借一致（差額0）' : `差額 ${fmtA(r.diff)}`}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-line p-5 text-sm">
        <h2 className="font-bold mb-2">キャッシュフロー</h2>
        <Figure testid="cf-fig" html={cfWaterfallHTML(r)} />
        <div className="grid sm:grid-cols-4 gap-2 mt-3">
          {row('営業CF', fmtA(cf.opCF), 'cf-op')}
          {row('投資CF', fmtA(cf.invCF), 'cf-inv')}
          {row('財務CF', fmtA(cf.finCF), 'cf-fin')}
          {row('現金増減', fmtA(cf.netCF), 'cf-net', true)}
        </div>
        <div className="text-ink-300 text-[11px] mt-1">
          期首現金 {fmt(r.openCash)} ＋ 増減 {fmtA(cf.netCF)} ＝ 期末現金 {fmt(r.cashEnd)}
        </div>
      </div>

      {!view && (
        <div className="flex">
          {r.period < 5 ? (
            <button
              data-testid="next-period"
              onClick={onNext}
              className="h-12 px-6 rounded-xl bg-emerald-600 text-white font-bold ml-auto"
            >
              次の期へ進む →
            </button>
          ) : (
            <div className="ml-auto text-ink-400 text-sm py-3">第5期まで完了しました。</div>
          )}
        </div>
      )}
    </div>
  )
}

// ------- 履歴 -------
function HistoryTab({ history, onDetail }: { history: Result[]; onDetail: (r: Result) => void }) {
  if (!history.length)
    return <div className="bg-white rounded-2xl shadow-sm border border-line p-8 text-center text-ink-400">まだ決算がありません。</div>
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-line overflow-x-auto">
      <table className="w-full text-[13px] min-w-[560px]" data-testid="history">
        <thead>
          <tr className="text-ink-400 border-b border-line bg-canvas">
            <th className="px-2 py-2 text-left">期</th>
            <th className="px-2 py-2 text-right">売上PQ</th>
            <th className="px-2 py-2 text-right">経常G</th>
            <th className="px-2 py-2 text-right">当期純</th>
            <th className="px-2 py-2 text-right">自己資本</th>
            <th className="px-2 py-2 text-right">現金</th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {history.map((r) => (
            <tr key={r.period} className="border-b border-line/60">
              <td className="px-2 py-2">第{r.period}期</td>
              <td className="px-2 py-2 text-right num">{fmt(r.PQ)}</td>
              <td className="px-2 py-2 text-right num">{fmtA(r.G)}</td>
              <td className="px-2 py-2 text-right num">{fmtA(r.net)}</td>
              <td className="px-2 py-2 text-right num">{fmt(r.capEnd + r.retEnd)}</td>
              <td className="px-2 py-2 text-right num">{fmt(r.cashEnd)}</td>
              <td className="px-2 py-2 text-right whitespace-nowrap">
                <button
                  data-testid={`detail-${r.period}`}
                  onClick={() => onDetail(r)}
                  className="h-7 px-3 rounded-lg border border-line text-ink-600 text-[12px] font-bold"
                >
                  詳細
                </button>{' '}
                <button
                  data-testid={`pdf-${r.period}`}
                  onClick={() => savePdf(r)}
                  className="h-7 px-3 rounded-lg border border-accent/40 text-accent-ink text-[12px] font-bold hover:bg-accent/5"
                >
                  PDF保存
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ------- 振り返り -------
function ChartCard({ title, sub, html }: { title: string; sub?: string; html: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-card border border-line p-4">
      <h3 className="font-bold text-sm mb-2">
        {title}
        {sub ? <span className="text-ink-300 text-xs font-normal ml-1">{sub}</span> : null}
      </h3>
      <Figure html={html} />
    </div>
  )
}

function ReviewTab({ history }: { history: Result[] }) {
  if (!history.length)
    return (
      <div className="bg-white rounded-2xl shadow-card border border-line p-8 text-center text-ink-400">
        まだ決算がありません。決算を確定すると推移が表示されます。
      </div>
    )
  const pts = (f: (r: Result) => number) => history.map((r) => ({ x: r.period, y: f(r) }))
  return (
    <div className="space-y-4" data-testid="review">
      <Figure html={scoreCardsHTML(history)} />
      <div className="bg-white rounded-2xl shadow-card border border-line p-5">
        <h2 className="font-bold mb-2">利益構造 STRAC の推移</h2>
        <Figure html={structureHTML(history)} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <ChartCard title="経常利益 G の推移" html={lineChartHTML(pts((r) => r.G), { signed: true })} />
        <ChartCard title="売上 PQ の推移" html={lineChartHTML(pts((r) => r.PQ), {})} />
        <ChartCard title="粗利率の推移" html={lineChartHTML(pts((r) => (r.PQ ? (r.mPQ / r.PQ) * 100 : 0)), { pct: true })} />
        <ChartCard title="損益分岐点比率の推移" html={lineChartHTML(pts((r) => fmRatio(r)), { pct: true })} />
      </div>
      <div className="bg-white rounded-2xl shadow-card border border-line p-5">
        <h2 className="font-bold mb-2">気づき</h2>
        <Figure html={insightsHTML(history)} />
      </div>
    </div>
  )
}

// ------- 組織 -------
const METRICS = [
  { k: 'EQ', label: '純資産', get: (h: any) => h.capEnd + h.retEnd, good: 'desc', f: (v: number) => fmtA(v) },
  { k: 'G', label: '経常利益G', get: (h: any) => h.G, good: 'desc', f: (v: number) => fmtA(v) },
  { k: 'net', label: '当期純利益', get: (h: any) => h.net, good: 'desc', f: (v: number) => fmtA(v) },
  { k: 'PQ', label: '売上PQ', get: (h: any) => h.PQ, good: 'desc', f: (v: number) => fmt(v) },
] as const

function OrgTab({ game }: { game: ReturnType<typeof useGame> }) {
  const [companies, setCompanies] = useState<any[] | null>(null)
  const [orgView, setOrgView] = useState<'charts' | 'table'>('charts')
  const st = game.st
  const load = async () => setCompanies(await game.refreshOrg())
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.version])
  if (!companies)
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-line p-6 text-center">
        <button data-testid="org-refresh" onClick={load} className="h-10 px-4 rounded-lg bg-ink text-white font-bold text-sm">
          最新を取得
        </button>
      </div>
    )
  const withHist = companies.filter((c) => (c.results || []).length)
  const names = withHist.map((c) => c.name)
  const series = (getVal: (r: any) => number) =>
    withHist.map((c, i) => ({
      name: c.name,
      color: ORG_COLORS[i % ORG_COLORS.length],
      me: c.name === st.name,
      pts: (c.results || []).map((r: any) => ({ x: r.period, y: getVal(r) })),
    }))
  const ORG_CHARTS: { title: string; sub?: string; get: (r: any) => number; opt: { signed?: boolean; pct?: boolean } }[] = [
    { title: '売上 PQ の推移', get: (r) => r.PQ, opt: {} },
    { title: '経常利益 G の推移', get: (r) => r.G, opt: { signed: true } },
    { title: '当期純利益の推移', get: (r) => r.net, opt: { signed: true } },
    { title: '純資産の推移', get: (r) => r.capEnd + r.retEnd, opt: { signed: true } },
    { title: '粗利率の推移', get: (r) => (r.PQ ? (r.mPQ / r.PQ) * 100 : 0), opt: { pct: true } },
    { title: 'FM比率（損益分岐点比率）の推移', get: (r) => fmRatio(r), opt: { pct: true } },
  ]
  const tabBtn = (v: 'charts' | 'table', label: string) => (
    <button
      data-testid={`ov-${v}`}
      onClick={() => setOrgView(v)}
      className={`px-3 py-1 rounded-md transition ${orgView === v ? 'bg-ink text-white shadow-sm' : 'text-ink-400'}`}
    >
      {label}
    </button>
  )
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-bold">
          組織 {st.org}{' '}
          <span className="text-ink-300 text-sm font-normal" data-testid="org-count">
            （{withHist.length}社）
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5 text-xs font-bold">
            {tabBtn('charts', 'チャート')}
            {tabBtn('table', '数値（順位）')}
          </div>
          <button data-testid="org-refresh" onClick={load} className="h-9 px-3 rounded-lg border border-line text-sm font-bold">
            更新
          </button>
        </div>
      </div>
      {orgView === 'charts' && (
        <div className="grid sm:grid-cols-2 gap-4" data-testid="org-charts">
          {names.length ? (
            ORG_CHARTS.map((ch) => <ChartCard key={ch.title} title={ch.title} html={multiLineHTML(series(ch.get), ch.opt)} />)
          ) : (
            <p className="text-ink-300 text-sm p-4">まだ成績がありません。</p>
          )}
        </div>
      )}
      {orgView === 'table' && (
      <div className="grid sm:grid-cols-2 gap-4" data-testid="org-cards">
        {METRICS.map((m) => {
          const arr = withHist
            .map((c) => {
              const last = c.results[c.results.length - 1]
              return { name: c.name, v: m.get(last), period: last.period, me: c.name === st.name }
            })
            .sort((a, b) => b.v - a.v)
          return (
            <div key={m.k} className="bg-white rounded-2xl shadow-sm border border-line p-4">
              <h3 className="font-bold mb-2 text-sm">{m.label} の順位</h3>
              <table className="w-full text-[13px]">
                <tbody>
                  {arr.map((x, i) => (
                    <tr key={x.name} className={`border-t border-line/60 ${x.me ? 'bg-amber-50' : ''}`}>
                      <td className="px-2 py-1.5 font-bold">{i + 1}位</td>
                      <td className="px-2 py-1.5">
                        {x.name}
                        {x.me ? <span className="text-ink-400 text-[11px]"> (あなた)</span> : null} <span className="num text-ink-300 text-[10px]">第{x.period}期</span>
                      </td>
                      <td className="px-2 py-1.5 text-right num font-bold">{m.f(x.v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}

// ------- 記帳モーダル -------
function ActionModal({
  st,
  keyName,
  onClose,
  onAct,
  onEvent,
}: {
  st: St
  keyName: string
  onClose: () => void
  onAct: (k: string, f: Fvals) => void
  onEvent: (k: string) => void
}) {
  const a = ACTIONS[keyName]
  const form = FORMS[keyName]
  const isCustomEvent = keyName === 'ibutsu' || keyName === 'suigai'
  const [single, setSingle] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {}
    form?.fields.forEach((fl) => (o[fl.name] = String(fl.default)))
    return o
  })
  const [items, setItems] = useState<Record<string, string>[]>(() =>
    form?.multi ? [initRow(form.rowFields!)] : [],
  )

  function initRow(fields: Field[]) {
    const o: Record<string, string> = {}
    fields.forEach((fl) => (o[fl.name] = String(fl.default)))
    return o
  }
  const conv = (fl: Field, v: string): number | string =>
    fl.type === 'int' ? Number(v) : /^\d+$/.test(v) ? Number(v) : v

  function buildFvals(): Fvals {
    if (form?.multi) {
      return {
        items: items.map((row) => {
          const o: Fvals = {}
          form.rowFields!.forEach((fl) => (o[fl.name] = conv(fl, row[fl.name])))
          return o
        }),
      }
    }
    const o: Fvals = {}
    form?.fields.forEach((fl) => (o[fl.name] = conv(fl, single[fl.name])))
    return o
  }

  const preview = (() => {
    try {
      if (isCustomEvent) {
        const f = eventFvals(st, keyName)
        return `破棄 ${f.discard} 個${f.payout ? ` ・ 受取保険金 ${f.payout}` : '（保険なし）'}`
      }
      return '金額 ' + fmt(a.amount(buildFvals()) || 0)
    } catch {
      return ''
    }
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 max-h-[88vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-1" data-testid="modal-title">
          {a.label}
        </h3>
        {form?.note && <p className="text-ink-400 text-xs mb-3">{form.note}</p>}
        {isCustomEvent && <p className="text-ink-500 text-sm mb-3">この盤面で記帳します。</p>}

        {form?.multi ? (
          <div className="space-y-2 mb-3">
            {items.map((row, i) => (
              <div key={i} className="flex gap-2 items-end">
                {form.rowFields!.map((fl) => (
                  <label key={fl.name} className="flex-1">
                    <span className="text-[11px] text-ink-400">{fl.label}</span>
                    <FieldInput
                      fl={fl}
                      value={row[fl.name]}
                      testid={`field-${fl.name}-${i}`}
                      onChange={(v) =>
                        setItems((arr) => arr.map((r, j) => (j === i ? { ...r, [fl.name]: v } : r)))
                      }
                    />
                  </label>
                ))}
                {items.length > 1 && (
                  <button
                    className="h-11 px-2 text-ink-300"
                    onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              data-testid="add-row"
              onClick={() => setItems((arr) => [...arr, initRow(form.rowFields!)])}
              className="text-sm text-ink-600 font-bold"
            >
              ＋ 行を追加
            </button>
          </div>
        ) : (
          <div className="space-y-3 mb-3">
            {form?.fields.map((fl) => (
              <label key={fl.name} className="block">
                <span className="text-sm">{fl.label}</span>
                <FieldInput
                  fl={fl}
                  value={single[fl.name]}
                  testid={`field-${fl.name}`}
                  onChange={(v) => setSingle((o) => ({ ...o, [fl.name]: v }))}
                />
              </label>
            ))}
          </div>
        )}

        <div className="text-ink-500 text-sm mb-3" data-testid="modal-preview">
          {preview}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="h-11 flex-1 rounded-xl border border-line font-bold text-ink-600">
            やめる
          </button>
          <button
            data-testid="modal-ok"
            onClick={() => (isCustomEvent ? onEvent(keyName) : onAct(keyName, buildFvals()))}
            className="h-11 flex-1 rounded-xl bg-ink text-white font-bold"
          >
            決定して記帳
          </button>
        </div>
      </div>
    </div>
  )
}

function FieldInput({
  fl,
  value,
  onChange,
  testid,
}: {
  fl: Field
  value: string
  onChange: (v: string) => void
  testid: string
}) {
  if (fl.type === 'select') {
    return (
      <select
        data-testid={testid}
        value={value}
        disabled={fl.fixed}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-11 w-full border border-line rounded-lg px-2 bg-white disabled:bg-canvas"
      >
        {fl.options!.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      data-testid={testid}
      type="number"
      value={value}
      disabled={fl.fixed}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 h-11 w-full border border-line rounded-lg px-2 num disabled:bg-canvas"
    />
  )
}
