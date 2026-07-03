import { useEffect, useState, type ReactNode } from 'react'
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
  loanRoom,
  equityNow,
  fmRatio,
  IN_COLS,
  type St,
  type Result,
  type Fvals,
  type TxRow,
} from '../lib/calc'
import { eventFvals } from '../lib/game'
import { stracHTML, plWaterfallHTML, cfWaterfallHTML, bsFigureHTML } from '../lib/figures'
import {
  cashAccountHTML,
  inventoryCountHTML,
  inventoryValueHTML,
  equipHTML,
  loanHTML,
  inflowOutflowHTML,
} from '../lib/figures-account'
import { scoreCardsHTML, structureHTML, insightsHTML, lineChartHTML, multiLineHTML, ORG_COLORS } from '../lib/figures-review'
import { boardHTML } from '../lib/figures-board'
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
  const [editTx, setEditTx] = useState<TxRow | null>(null) // 編集対象のアクション行
  const [amountTx, setAmountTx] = useState<TxRow | null>(null) // 金額のみ編集する行（資本金/給料/家賃 等）
  const [stmtView, setStmtView] = useState<Result | null>(null)
  const st = game.st

  // 記帳行の ✎ 編集：アクション行→モーダル再表示、キーレス行→金額編集
  const openEditRow = (t: TxRow) => {
    if (t.key && FORMS[t.key]) {
      setEditTx(t)
      setModalKey(t.key)
    } else {
      setAmountTx(t)
    }
  }
  const closeModal = () => {
    setModalKey(null)
    setEditTx(null)
  }

  if (!game.ready) return <div className="p-10 text-center text-ink-400">読み込み中…</div>
  if (game.orgError && !st.started) return <OrgError />

  // 決算書タブを開いても閲覧中の期(stmtView)は維持する。期の変更は会社情報の「期」/履歴の詳細/「履歴に戻る」で行う
  const go = (t: TabKey) => {
    setTab(t)
  }

  // 会社情報の「期の選択」：現在＝最新に戻る／過去＝その期の決算書を閲覧
  const curView = stmtView ? stmtView.period : st.period
  const onViewPeriod = (p: number) => {
    if (p >= st.period) {
      setStmtView(null)
      setTab(st.settled ? 'statement' : 'play')
    } else {
      const r = game.history.find((h) => h.period === p)
      if (r) {
        setStmtView(r)
        setTab('statement')
      }
    }
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
        {/* 同じ組織コード＋会社名なら自動でデータを引き継ぐ（復元バナーは非表示） */}
        {game.error && (
          <div data-testid="error" className="mb-4 rounded-xl border border-accent/40 bg-accent/5 text-accent-ink px-4 py-2.5 text-sm">
            {game.error}
            <button className="ml-2 underline" onClick={() => game.setError(null)}>
              閉じる
            </button>
          </div>
        )}

        {tab === 'company' && (
          <CompanyTab game={game} onStarted={() => go('opening')} viewPeriod={curView} onViewPeriod={onViewPeriod} />
        )}
        {tab === 'opening' && <OpeningTab game={game} onToPlay={() => go('play')} />}
        {tab === 'play' && (
          <PlayTab game={game} onOpen={setModalKey} onEditRow={openEditRow} onSettleTab={() => go('closing')} />
        )}
        {tab === 'closing' && (
          <ClosingTab game={game} onStatement={() => go('statement')} />
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
          editTx={editTx}
          onClose={closeModal}
          onAct={(k, f) => {
            const err = editTx ? game.editAction(editTx.id, f) : game.act(k, f)
            if (!err) closeModal()
          }}
          onEvent={(k) => {
            const err = game.actEvent(k)
            if (!err) closeModal()
          }}
        />
      )}
      {amountTx && (
        <AmountModal
          tx={amountTx}
          onClose={() => setAmountTx(null)}
          onSave={(amt) => {
            const err = game.editAmount(amountTx.id, amt)
            if (!err) setAmountTx(null)
          }}
        />
      )}
    </div>
  )
}

function OrgError() {
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-canvas" data-testid="org-error">
      <div className="bg-white rounded-2xl shadow-card border border-line p-8 max-w-md text-center">
        <div className="text-5xl font-black text-ink-300 mb-2">404</div>
        <h1 className="text-lg font-black mb-2">ページがありません。</h1>
      </div>
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
function CompanyTab({
  game,
  onStarted,
  viewPeriod,
  onViewPeriod,
}: {
  game: ReturnType<typeof useGame>
  onStarted: () => void
  viewPeriod: number
  onViewPeriod: (p: number) => void
}) {
  const st = game.st
  const [name, setName] = useState(st.name)
  const [pres, setPres] = useState(st.president)
  const org = st.org || game.joinOrg
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
            readOnly
            disabled
            className="mt-1 h-11 w-full border border-line rounded-lg px-3 bg-canvas text-ink-600 cursor-not-allowed"
          />
          <span className="text-ink-400 text-xs">参加用URL（講師が発行）から自動設定されます。編集はできません。</span>
        </label>
        <label className="block">
          <span className="text-sm font-medium">期</span>
          <select
            data-testid="c-period"
            value={viewPeriod}
            disabled={!started}
            onChange={(e) => onViewPeriod(Number(e.target.value))}
            className="mt-1 h-11 w-full border border-line rounded-lg px-3 bg-white disabled:bg-canvas"
          >
            {Array.from({ length: started ? st.period : 1 }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>
                第{p}期{p === st.period ? '（現在）' : ''}
              </option>
            ))}
          </select>
          <span className="text-ink-400 text-xs">
            給料テーブル：1期25 / 2期28 / 3期31 / 4期34 / 5期37。過去の期を選ぶとその期の決算書を表示します。
          </span>
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
type BoardVals = { mfg: number; sales: number; mat: number; prod: number; dev: number; ads: number; mach: number }

function BoardEditForm({ st, onSave, onCancel }: { st: St; onSave: (b: BoardVals) => void; onCancel: () => void }) {
  const [v, setV] = useState<BoardVals>({
    mfg: st.openingStaffMfg,
    sales: st.openingStaffSales,
    mat: st.openingMatQty - st.openingProducts,
    prod: st.openingProducts,
    dev: st.openingDev,
    ads: st.openingAds,
    mach: st.openingMachines,
  })
  const f = (k: keyof BoardVals, label: string) => (
    <label className="block">
      <span className="text-[10px] text-ink-400 whitespace-nowrap">{label}</span>
      <input
        data-testid={`obe-${k}`}
        type="number"
        min={0}
        value={v[k]}
        onChange={(e) => setV((s) => ({ ...s, [k]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
        className="mt-0.5 h-9 w-full border border-line rounded px-2 num text-sm"
      />
    </label>
  )
  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {f('mfg', '製造ｽﾀｯﾌ')}
        {f('sales', '販売ｽﾀｯﾌ')}
        {f('mat', '材料')}
        {f('prod', '製品')}
        {f('dev', '開発')}
        {f('ads', '広告')}
        {f('mach', '機械')}
      </div>
      <p className="text-ink-300 text-[11px] mt-2">※資産価値の増減は利益剰余金で調整され、貸借は一致を保ちます。</p>
      <div className="flex gap-2 mt-2">
        <button onClick={onCancel} className="h-9 px-3 rounded-lg border border-line text-ink-600 text-xs font-bold">
          やめる
        </button>
        <button data-testid="board-save" onClick={() => onSave(v)} className="h-9 px-4 rounded-lg bg-ink text-white text-xs font-bold ml-auto">
          更新
        </button>
      </div>
    </div>
  )
}

function OpeningTab({ game, onToPlay }: { game: ReturnType<typeof useGame>; onToPlay: () => void }) {
  const st = game.st
  const first = st.period <= 1
  const openTax = st.tx.find((t) => t.isOpeningTax)?.amount || 0
  const openInt = st.tx.find((t) => t.isOpeningInterest)?.amount || 0
  const [editing, setEditing] = useState(false)
  const [addCap, setAddCap] = useState(100)
  const eq = equityNow(st)
  const cap = loanCap(st)
  const room = loanRoom(st)
  const interest = Math.round(st.openingLoan * 0.05)
  const repayPlan = Math.round((st.openingLoan * st.repayRate) / 100)
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
    <div className="space-y-4" data-testid="opening">
      <div className="rounded-2xl border border-cin-base/30 bg-cin-bg px-5 py-3">
        <h2 className="font-black text-cin-ink">第{st.period}期 期首</h2>
        <p className="text-cin-ink/80 text-xs mt-0.5">
          この期のスタート状態です。前期の決算から繰り越した残高・盤面の駒・期首納税を自動でセットします。記帳の前に確認しましょう。
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold">盤面セットアップ</h2>
            {!editing && !st.settled && (
              <button
                data-testid="board-edit"
                onClick={() => setEditing(true)}
                className="h-8 px-3 rounded-lg border border-line text-ink-600 text-xs font-bold"
              >
                変更
              </button>
            )}
          </div>
          {editing ? (
            <BoardEditForm
              st={st}
              onCancel={() => setEditing(false)}
              onSave={(b) => {
                const e = game.setBoard(b)
                if (!e) setEditing(false)
              }}
            />
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {token('製造ｽﾀｯﾌ', st.openingStaffMfg)}
              {token('販売ｽﾀｯﾌ', st.openingStaffSales)}
              {token('材料', st.openingMatQty - st.openingProducts)}
              {token('製品', st.openingProducts)}
              {token('開発', st.openingDev)}
              {token('広告', st.openingAds)}
              {token('機械', st.openingMachines)}
            </div>
          )}
        </div>
      </div>

      {/* ⑨ 借入金可能枠・金利・返済（倍率と返済率は講師設定・第2期以降） */}
      <div className="bg-white rounded-2xl shadow-card border border-line p-5 text-sm">
        <h2 className="font-bold mb-2 text-f-ink">⑨ 借入金可能枠・金利・返済（倍率・返済率は講師設定）</h2>
        {first ? (
          <div className="rounded-lg bg-canvas text-ink-400 p-3 text-center">
            第1期は借入・金利・期末返済はありません。第2期以降に表示されます。
          </div>
        ) : (
          <>
            <div className="border-b border-line py-1.5">
              <span className="text-ink-600">借入金可能枠</span>
              <div className="flex items-center gap-1 flex-wrap mt-1">
                純資産 <b className="num">{fmt(eq)}</b> ×
                <input
                  data-testid="op-loanmult"
                  type="number"
                  min={0}
                  defaultValue={st.loanMult}
                  onBlur={(e) => game.setInstr(Number(e.target.value) || 0, st.repayRate)}
                  className="w-14 h-8 border border-line rounded px-1 text-right num"
                />
                倍 ＝ <b className="num text-f-base">{fmt(cap)}</b>
              </div>
            </div>
            {kv('現在借入残高', fmt(st.loan))}
            <div className="flex justify-between py-1.5">
              <span className="font-bold">今期借入可能額</span>
              <b className="num text-f-base text-base">{fmt(room)}</b>
            </div>
            <div className="flex justify-between py-1.5 mt-1 rounded-lg px-2 bg-f-bg">
              <span className="font-bold text-f-ink">金利5%・期首支払金利（期首残高×5%）</span>
              <b className="num text-f-ink">▲{fmt(interest)}</b>
            </div>
            <div className="flex items-center justify-between py-1.5 mt-1 rounded-lg px-2 bg-m-bg gap-2 flex-wrap">
              <span className="font-bold text-m-ink">
                期末返済（期首残高 ×
                <input
                  data-testid="op-repayrate"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={st.repayRate}
                  onBlur={(e) => game.setInstr(st.loanMult, Number(e.target.value) || 0)}
                  className="w-12 h-7 border border-line rounded px-1 mx-1 text-right num"
                />
                %）
              </span>
              <b className="num text-m-ink">▲{fmt(repayPlan)}</b>
            </div>
          </>
        )}
      </div>

      {/* 増資（第2期以降・任意） */}
      {!first && (
        <div className="bg-white rounded-2xl shadow-card border border-line p-5">
          <h2 className="font-bold mb-1 text-p-ink">増資（任意）</h2>
          <p className="text-ink-400 text-xs mb-2">この期に追加出資する場合に入力。「ア 資本金」として記帳され、現金と純資産が増えます。</p>
          <div className="flex gap-2">
            <input
              data-testid="op-addcap"
              type="number"
              min={0}
              value={addCap}
              onChange={(e) => setAddCap(Number(e.target.value) || 0)}
              className="flex-1 h-11 border border-line rounded-xl px-3 num font-bold text-lg text-p-ink bg-p-bg"
            />
            <button
              data-testid="op-addcap-btn"
              onClick={() => game.raiseCapital(addCap)}
              className="px-4 rounded-xl bg-p-base text-white font-bold whitespace-nowrap"
            >
              ＋ 増資する
            </button>
          </div>
        </div>
      )}

      <div className="flex">
        <button
          data-testid="opening-toplay"
          onClick={onToPlay}
          className="h-12 px-6 rounded-xl bg-cin-base text-white font-bold ml-auto hover:brightness-95"
        >
          記帳をはじめる →
        </button>
      </div>
    </div>
  )
}

// ------- 記帳 -------
// アクションのアイコン・色（mock STY）とヒント（mock TAGS）
const STY: Record<string, { c: string; i: string }> = {
  shiire: { c: '#8b5e3c', i: '📦' },
  seizo: { c: '#d98324', i: '🍰' },
  hanbai: { c: '#0f766e', i: '💰' },
  kikai: { c: '#64748b', i: '⚙️' },
  saiyo: { c: '#2f6fe0', i: '🧑' },
  koukoku: { c: '#c8322b', i: '📣' },
  kaihatsu: { c: '#2563eb', i: '💡' },
  hoken: { c: '#ca9a06', i: '🛡️' },
  kyoiku: { c: '#e8842a', i: '📚' },
  haichi: { c: '#5b6472', i: '🔁' },
  kariire: { c: '#0f766e', i: '🏦' },
  hensai: { c: '#5b6472', i: '↩️' },
  kaihatsu_win: { c: '#0f766e', i: '🎉' },
  dokusen: { c: '#0f766e', i: '👑' },
  tokubai: { c: '#3f7a3f', i: '🏷️' },
  keiki: { c: '#3f7a3f', i: '📈' },
  ibutsu: { c: '#b85c7e', i: '⚠️' },
  suigai: { c: '#b85c7e', i: '🌊' },
  taishoku_mfg: { c: '#2f5f93', i: '🚪' },
  taishoku_sales: { c: '#2f5f93', i: '🚪' },
  claim: { c: '#1f7a8c', i: '📞' },
  kitchen: { c: '#4a55a8', i: '🔧' },
  rousai: { c: '#4a55a8', i: '🩹' },
  kaihatsu_fail: { c: '#1f7a8c', i: '💥' },
  kansen: { c: '#5b6472', i: '🦠' },
  chiiki: { c: '#5b6472', i: '🎪' },
  fuhyo: { c: '#5b6472', i: '📉' },
  gyaku: { c: '#5b6472', i: '🔄' },
}
const TAGS: Record<string, string> = {
  shiire: '−10〜16',
  kikai: '−100',
  saiyo: '−5',
  koukoku: '−10',
  kaihatsu: '−20',
  hanbai: '＋ 売上',
  seizo: '材料→製品',
  hoken: '−5',
  kyoiku: '−20',
  haichi: '−5',
  kariire: '＋ 借入',
  hensai: '− 返済',
}

function ActBtn({ k, disabled, onOpen }: { k: string; disabled: boolean; onOpen: (k: string) => void }) {
  const a = ACTIONS[k]
  const sty = STY[k] || { c: '#5b6472', i: '•' }
  const col = a.col !== null && a.col !== undefined && LCOL[a.col] ? LCOL[a.col].t : sty.c
  return (
    <button
      data-testid={`act-${k}`}
      disabled={disabled}
      onClick={() => onOpen(k)}
      className="text-left rounded-xl bg-white border p-3 flex items-start gap-2 hover:shadow-sm transition disabled:opacity-40"
      style={{ borderColor: col + '55' }}
    >
      <span className="text-lg leading-none mt-0.5">{sty.i}</span>
      <div className="min-w-0">
        <div className="font-bold text-sm leading-tight" style={{ color: col }}>
          {a.label}
        </div>
        <div className="text-[11px] text-ink-400 leading-tight">{TAGS[k] || ''}</div>
      </div>
    </button>
  )
}

function PlayTab({
  game,
  onOpen,
  onEditRow,
  onSettleTab,
}: {
  game: ReturnType<typeof useGame>
  onOpen: (k: string) => void
  onEditRow: (t: TxRow) => void
  onSettleTab: () => void
}) {
  const st = game.st
  const c = caps(st)
  const disabled = st.settled || st.closingPrep
  const [sub, setSub] = useState<'A' | 'B' | 'X' | 'company'>('A')
  const tot = colTotals(st)

  const statCard = (label: string, value: string, id?: string) => (
    <div className="bg-white rounded-2xl shadow-card border border-line px-4 py-3">
      <div className="text-ink-400 text-xs">{label}</div>
      <div className="num font-black text-2xl mt-0.5" data-testid={id}>
        {value}
      </div>
    </div>
  )
  const subBtn = (v: 'A' | 'B' | 'X' | 'company', label: string) => (
    <button
      data-testid={`sub-${v}`}
      onClick={() => setSub(v)}
      className={`rounded-lg py-2 text-[12px] sm:text-sm font-bold transition ${
        sub === v ? 'bg-ink text-white shadow-sm' : 'text-ink-400 hover:text-ink'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-black">記帳</h1>
        <p className="text-ink-400 text-sm mt-1">意思決定 → 数値入力 → 実行。現金出納帳に1行ずつ記帳されます。</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCard('現金残高', fmt(cashNow(st)), 'stat-cash')}
        {statCard('材料・原料', fmt(st.rawCubes), 'stat-raw')}
        {statCard('製品・陳列', fmt(st.products), 'stat-prod')}
        {statCard('今期の売上', fmt(tot[2]), 'stat-sales')}
      </div>

      <div className="grid grid-cols-4 gap-1 bg-canvas border border-line rounded-xl p-1">
        {subBtn('A', 'ルールA')}
        {subBtn('B', 'ルールB')}
        {subBtn('X', 'イベントカード')}
        {subBtn('company', '会社版')}
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-line p-4">
        {sub === 'A' && (
          <>
            <div className="text-xs font-bold text-ink-400 mb-2">ルールA・意思決定（1回1項目）</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {A_KEYS.map((k) => (
                <ActBtn key={k} k={k} disabled={disabled} onOpen={onOpen} />
              ))}
            </div>
          </>
        )}
        {sub === 'B' && (
          <>
            <div className="text-xs font-bold text-ink-400 mb-2">ルールB（1ターンに1回）</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {B_KEYS.map((k) => (
                <ActBtn key={k} k={k} disabled={disabled} onOpen={onOpen} />
              ))}
            </div>
          </>
        )}
        {sub === 'X' && (
          <>
            <div className="text-xs font-bold text-ink-400 mb-2">イベントカード（引いたカードを選んで記帳）</div>
            <EventPicker disabled={disabled} onPick={onOpen} />
          </>
        )}
        {sub === 'company' && <Figure testid="board-fig" html={boardHTML(st)} />}
        {sub !== 'company' && (
          <div className="text-ink-300 text-[11px] mt-3">
            製造能力 {c.mfgCap} / 販売能力 {c.salesCap}
          </div>
        )}
      </div>

      <Ledger st={st} onDelete={game.del} onEditRow={onEditRow} />

      <div className="flex gap-2 flex-wrap items-center">
        <button
          data-testid="ledger-clear"
          onClick={() => {
            if (confirm('この期の記帳をすべて消去しますか？')) game.clear()
          }}
          className="h-11 px-4 rounded-xl border border-line text-ink-600 font-bold text-sm"
        >
          記帳を全消去
        </button>
        {st.period === 1 && !disabled && (
          <button
            data-testid="seed-flood"
            onClick={() => game.seedFlood()}
            className="h-11 px-4 rounded-xl border border-sky-400 text-sky-700 font-bold text-sm hover:bg-sky-50"
          >
            1期データを追加
          </button>
        )}
        {!st.settled && (
          <div className="flex gap-2 flex-wrap items-center ml-auto">
            {st.closingPrep && (
              <button
                data-testid="undo-closing"
                onClick={() => game.undoClose()}
                className="h-11 px-4 rounded-xl border border-line font-bold text-ink-600"
              >
                記帳に戻る
              </button>
            )}
            <button
              data-testid="closing"
              onClick={() => {
                if (!st.closingPrep) {
                  // 1段目：給与・家賃（と期末返済）を記帳に計上（このタブに留まる）
                  game.closing()
                } else {
                  // 2段目：決算を確定し、期末処理タブへ遷移
                  game.settleNow()
                  onSettleTab()
                }
              }}
              className={`h-11 px-6 rounded-xl font-bold text-white ${st.closingPrep ? 'bg-accent' : 'bg-ink'}`}
            >
              {st.closingPrep ? 'この期を決算にする →' : '期末処理を行う（給与・家賃を計上）'}
            </button>
          </div>
        )}
      </div>
      {st.closingPrep && (
        <p className="text-ink-400 text-xs text-right">
          給与・家賃（と期末返済）を記帳に計上しました。決算にするか、記帳に戻れます。
        </p>
      )}
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

function Ledger({ st, onDelete, onEditRow }: { st: St; onDelete: (id: number) => void; onEditRow: (t: TxRow) => void }) {
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
            const derived = t.isBorrowInterest || t.isAutoRepay || t.isOpeningTax || t.isOpeningInterest
            const isCustom = t.key === 'ibutsu' || t.key === 'suigai'
            // ✎ 編集：アクション行はモーダル（記帳前のみ）、キーレス行（資本金/給料/家賃/増資）は金額編集（決算前）
            const canEditModal = !!t.key && !!FORMS[t.key] && !isCustom && !st.settled && !st.closingPrep
            const canEditAmount = !t.key && !derived && !st.settled
            const showEdit = canEditModal || canEditAmount
            // ✕ 削除：資本金・期末（給料/家賃）・自動行は不可
            const showDelete = !derived && !t.isClosing && !t.isCapital && !st.settled && !st.closingPrep
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
                <td className="px-1 py-1 whitespace-nowrap text-center">
                  <span className="inline-flex items-center gap-1.5">
                    {showEdit && (
                      <button
                        data-testid={`edit-${t.id}`}
                        onClick={() => onEditRow(t)}
                        title="編集"
                        className="text-ink-300 hover:text-ink text-xs leading-none"
                      >
                        ✎
                      </button>
                    )}
                    {showDelete && (
                      <button
                        data-testid={`del-${t.id}`}
                        onClick={() => onDelete(t.id)}
                        title="削除"
                        className="text-ink-300 hover:text-accent text-[10px] leading-none"
                      >
                        ✕
                      </button>
                    )}
                  </span>
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
function ClosingTab({ game, onStatement }: { game: ReturnType<typeof useGame>; onStatement: () => void }) {
  const st = game.st
  const r = st.settled ? st.result : null
  const heading = (
    <div>
      <h1 className="text-xl sm:text-2xl font-black tracking-tight">期末処理</h1>
      <p className="text-ink-400 text-sm mt-1">
        記帳を終えたら決算を実行。期末処理（給料・家賃・棚卸・減価償却・法人税）を自動で行います。確定後「次の期へ進む」で繰越されます。
      </p>
    </div>
  )
  // まだ決算していない：決算を実行するボタン
  if (!r) {
    return (
      <div className="space-y-4">
        {heading}
        <div className="bg-white rounded-2xl shadow-card border border-line p-8 text-center">
          <p className="text-ink-400 text-sm">まだ決算していません。</p>
          <button
            data-testid="closing-run"
            onClick={() => game.settleNow()}
            className="mt-4 h-12 px-6 rounded-xl bg-emerald-600 text-white font-bold"
          >
            決算を実行する
          </button>
        </div>
      </div>
    )
  }
  const clRow = (l: string, v: string) => (
    <div className="flex justify-between border-b border-line pb-2">
      <span className="text-ink-600">{l}</span>
      <b className="num">{v}</b>
    </div>
  )
  return (
    <div className="space-y-4">
      {heading}
      {/* 期末処理（自動）：棚卸・給料・家賃・減価償却・法人税の確定値 */}
      <div className="bg-white rounded-2xl shadow-card border border-line p-5">
        <h2 className="font-bold mb-1">期末処理（自動）</h2>
        <p className="text-ink-400 text-xs mb-3">記帳のあと ① 棚卸 ② 給料 ③ 家賃 ④ 減価償却 を計算し、法人税を確定します。</p>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
          {clRow('① 棚卸 平均単価', fmt(r.avg))}
          {clRow('① 売上原価 vPQ', fmt(r.vPQ))}
          {clRow('② 給料（人数 × 給料表）', fmt(r.salary))}
          {clRow('③ 家賃', fmt(r.rent))}
          {clRow('④ 減価償却（什器 × 10）', fmt(r.dep))}
          <div className="flex justify-between border-b border-line pb-2">
            <span className="text-ink-600">法人税等（30%・最低5）</span>
            <b className="num text-accent-ink" data-testid="cl-tax">
              ▲{fmt(r.tax)}
            </b>
          </div>
        </div>
      </div>
      {/* 勘定の図解（入門編MG決算書の補助勘定を再現） */}
      <div>
        <h2 className="font-bold mb-1 px-1">勘定の図解</h2>
        <p className="text-ink-400 text-xs mb-3 px-1">
          前期繰越 ＋ 当期増加 ＝ 合計、合計 − 当期減少 ＝ 次期繰越。
          <span className="text-ink-300">（入門編MG決算書の補助勘定）</span>
        </p>
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4 items-start">
            <Figure html={inflowOutflowHTML(r)} />
            <Figure html={cashAccountHTML(r)} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4 items-start">
            <Figure html={inventoryCountHTML(r)} />
            <Figure html={inventoryValueHTML(r)} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4 items-start">
            <Figure html={loanHTML(r)} />
            <Figure html={equipHTML(r)} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-3">
        <button data-testid="to-statement" onClick={onStatement} className="h-11 px-5 rounded-xl bg-ink text-white font-bold">
          決算書をみる →
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
  const c = r.colTot
  // キャッシュフロー計算書：活動グループ（色ヘッダー＋明細＋小計）
  const cfItem = (l: string, v: number) => (
    <div key={l} className="flex justify-between items-center py-1 px-3 text-[13px]">
      <span className="text-ink-500">{l}</span>
      <b className={`num font-medium ${v < 0 ? 'text-accent-ink' : 'text-ink'}`}>{fmtA(v)}</b>
    </div>
  )
  const cfGroup = (title: string, color: string, items: ReactNode, subLabel: string, subVal: number, testid: string) => (
    <div className="rounded-xl border border-line overflow-hidden mb-2.5">
      <div className="px-3 py-1.5 text-[12px] font-bold" style={{ background: color + '16', color }}>
        {title}
      </div>
      <div className="divide-y divide-line/70">{items}</div>
      <div
        className="flex justify-between items-center px-3 py-2 border-t-2 font-bold text-[15px]"
        style={{ borderColor: color + '66', background: color + '0d' }}
      >
        <span style={{ color }}>{subLabel}</span>
        <b className={`num ${subVal < 0 ? 'text-accent-ink' : ''}`} style={subVal < 0 ? undefined : { color }} data-testid={testid}>
          {fmtA(subVal)}
        </b>
      </div>
    </div>
  )
  // 法人税・利益剰余金の行／補助勘定の行
  const txRow = (l: string, v: string, testid: string) => (
    <div className="flex justify-between">
      <span className="text-ink-600">{l}</span>
      <b className="num" data-testid={testid}>
        {v}
      </b>
    </div>
  )
  const subRow = (l: string, v: string) => (
    <div className="flex justify-between">
      <span className="text-ink-600">{l}</span>
      <span className="num">{v}</span>
    </div>
  )
  const subRowB = (l: string, v: string) => (
    <div className="flex justify-between font-bold border-t border-line mt-1 pt-1">
      <span>{l}</span>
      <span className="num">{v}</span>
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

      <div className="grid lg:grid-cols-2 gap-4 items-stretch">
        {/* STRAC（P/L）数値：売上高 −費用 ＝残り の引き算の流れを列で表示（mock準拠） */}
        <div className="bg-white rounded-2xl shadow-card border border-line p-5 text-sm">
          <h2 className="font-bold mb-3">STRAC（P/L）数値</h2>
          <p className="text-ink-400 text-[11px] mb-2">
            売上高 −変動費 ＝粗利、粗利 −固定費 ＝経常利益。<span className="text-ink-300">列で引き算の流れを表示</span>
          </p>
          <div
            className="grid items-center gap-x-1.5 gap-y-2.5"
            style={{ gridTemplateColumns: 'minmax(0,1fr) 3.4rem 3.4rem 3.4rem' }}
          >
            {/* 列見出し */}
            <span />
            <span className="text-[10px] font-bold text-ink-300 text-right leading-tight">売上高</span>
            <span className="text-[10px] font-bold text-ink-300 text-right leading-tight">− 費用</span>
            <span className="text-[10px] font-bold text-ink-300 text-right leading-tight">＝ 残り</span>

            {/* ① 売上高 PQ（左） */}
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: '#e08a3c' }} />
              <span>
                ① 売上高 PQ <span className="text-ink-400 text-[10px]">（個数 <b className="num" data-testid="st-q">{fmt(r.Q)}</b>）</span>
              </span>
            </span>
            <span className="num font-bold text-right" style={{ color: '#b5630f' }} data-testid="st-pq">
              {fmt(r.PQ)}
            </span>
            <span />
            <span />

            {/* ② 変動費 vPQ（中・引く） */}
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: '#37a36b' }} />
              <span>
                ② 変動費 vPQ <span className="text-ink-400 text-[10px]">売上原価</span>
              </span>
            </span>
            <span />
            <span className="num font-bold text-right" style={{ color: '#2f7d54' }}>
              <span className="text-ink-300 mr-px">−</span>
              <span data-testid="st-vpq">{fmt(r.vPQ)}</span>
            </span>
            <span />

            {/* ③ 粗利益 mPQ（右・＝①−②） */}
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: '#cf4d80' }} />
              <span>
                ③ 粗利益 mPQ <span className="text-ink-400 text-[10px]">付加価値</span>
              </span>
            </span>
            <span />
            <span />
            <span className="num font-bold text-right text-m-ink border-t border-line pt-0.5">
              <span className="text-ink-300 mr-px">＝</span>
              <span data-testid="st-mpq">{fmt(r.mPQ)}</span>
            </span>

            {/* ④ 固定費 F（中・引く） */}
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: '#3b6fd4' }} />
              <span>④ 固定費 F</span>
            </span>
            <span />
            <span className="num font-bold text-right" style={{ color: '#2f5fb0' }}>
              <span className="text-ink-300 mr-px">−</span>
              <span data-testid="st-f">{fmt(r.F)}</span>
            </span>
            <span />

            {/* 固定費の内訳（全幅） */}
            <div className="pl-5 text-[12px] text-ink-500 flex flex-col gap-y-0.5" style={{ gridColumn: '1/-1' }}>
              <div className="flex justify-between"><span>人件費（カ）</span><b className="num" data-testid="st-labor">{fmt(r.laborF)}</b></div>
              <div className="flex justify-between"><span>販売費（キ）</span><b className="num" data-testid="st-sell">{fmt(r.sellF)}</b></div>
              <div className="flex justify-between"><span>管理費（ク）</span><b className="num" data-testid="st-admin">{fmt(r.adminF)}</b></div>
              <div className="flex justify-between"><span>減価償却</span><b className="num" data-testid="st-dep">{fmt(r.depF)}</b></div>
            </div>

            {/* ⑤ 経常利益 G（右・＝③−④） */}
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: '#caa12a' }} />
              <span className="font-bold">⑤ 経常利益 G</span>
            </span>
            <span />
            <span />
            <span className="num font-black text-right text-lg text-g-ink border-t-2 border-line pt-0.5" data-testid="st-g">
              <span className="text-ink-300 text-sm mr-px">＝</span>
              {fmtA(r.G)}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-3 text-center">
            <div className="rounded-lg border border-line py-1.5">
              <div className="text-ink-400 text-[11px]">原価率</div>
              <div className="num font-bold">{r.PQ ? rt.costRate + '%' : '–'}</div>
            </div>
            <div className="rounded-lg border border-line py-1.5">
              <div className="text-ink-400 text-[11px]">粗利率</div>
              <div className="num font-bold">{r.PQ ? rt.grossRate + '%' : '–'}</div>
            </div>
            <div className="rounded-lg border border-line py-1.5">
              <div className="text-ink-400 text-[11px]">損益分岐点</div>
              <div className="num font-bold">{r.mPQ ? rt.bepRate + '%' : '–'}</div>
            </div>
          </div>
        </div>

        {/* 貸借対照表 B/S：図と数値を別カードに（mock準拠） */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-card border border-line p-5 text-sm">
            <h2 className="font-bold mb-3">貸借対照表 B/S（図）</h2>
            <Figure testid="bs-fig" html={bsFigureHTML(r, 180)} />
            <div
              data-testid="bs-check"
              className={`mt-3 flex items-center justify-center gap-2 text-sm font-bold rounded-lg py-2 ${
                Math.abs(r.diff) < 0.5 ? 'bg-emerald-50 text-emerald-700' : 'bg-accent/10 text-accent-ink'
              }`}
            >
              {Math.abs(r.diff) < 0.5 ? (
                <>
                  <span className="grid place-items-center w-5 h-5 rounded-full bg-emerald-600 text-white text-xs">✓</span> 差 0 ＝ 貸借一致
                </>
              ) : (
                `差額 ${fmtA(Math.round(r.diff))}`
              )}
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-card border border-line p-5 text-sm">
            <h2 className="font-bold mb-3">貸借対照表 B/S（数値）</h2>
            <div className="grid grid-cols-2 gap-x-5 items-stretch">
              <div className="text-ink-400 text-xs border-b border-line pb-1 mb-2">資産</div>
              <div className="text-ink-400 text-xs border-b border-line pb-1 mb-2">負債・純資産</div>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between"><span className="text-ink-600">現金</span><b className="num" data-testid="bs-cash">{fmt(r.cashEnd)}</b></div>
                <div className="flex justify-between"><span className="text-ink-600">在庫</span><b className="num" data-testid="bs-inv">{fmt(r.endInvVal)}</b></div>
                <div className="flex justify-between"><span className="text-ink-600">什器</span><b className="num" data-testid="bs-equip">{fmt(r.equipEnd)}</b></div>
                <div className="flex justify-between border-t border-line pt-1.5 mt-auto font-bold">
                  <span>資産合計</span>
                  <span className="num" data-testid="bs-assets">{fmt(r.assets)}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between"><span className="text-ink-600">未払法人税等</span><b className="num" data-testid="bs-tax">{fmt(r.tax)}</b></div>
                <div className="flex justify-between"><span className="text-ink-600">借入金</span><b className="num" data-testid="bs-loan">{fmt(r.loanEnd)}</b></div>
                <div className="flex justify-between border-t border-dashed border-line pt-1 font-semibold">
                  <span>負債合計</span>
                  <span className="num">{fmt(r.tax + r.loanEnd)}</span>
                </div>
                <div className="flex justify-between pt-1"><span className="text-ink-600">資本金</span><b className="num" data-testid="bs-cap">{fmt(r.capEnd)}</b></div>
                <div className="flex justify-between"><span className="text-ink-600">利益剰余金</span><b className="num" data-testid="bs-ret">{fmtA(r.retEnd)}</b></div>
                <div className="flex justify-between border-t border-dashed border-line pt-1 font-semibold">
                  <span>純資産合計</span>
                  <span className="num">{fmtA(r.capEnd + r.retEnd)}</span>
                </div>
                <div className="flex justify-between border-t border-line pt-1.5 mt-auto font-bold">
                  <span>負債・純資産合計</span>
                  <span className="num" data-testid="bs-liabeq">{fmt(r.liabEq)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* C/F キャッシュフロー（ウォーターフォール図・全幅） */}
      <div className="bg-white rounded-2xl shadow-card border border-line p-5">
        <h2 className="font-bold mb-3">
          <span className="text-[9px] text-accent-ink mr-1.5 font-bold tracking-wide">C / F</span>
          キャッシュフロー（現金の増減）
        </h2>
        <Figure testid="cf-fig" html={cfWaterfallHTML(r)} />
      </div>

      {/* CF数値 ｜ 法人税＋補助勘定 */}
      <div className="grid lg:grid-cols-2 gap-4 items-stretch">
        {/* キャッシュフロー計算書（数値・営業／投資／財務） */}
        <div className="bg-white rounded-2xl shadow-card border border-line p-5 flex flex-col">
          <h2 className="font-bold mb-1">キャッシュフロー計算書</h2>
          <p className="text-ink-400 text-xs mb-3">現金の増減を 営業・投資・財務 に分けて表示します。</p>
          <div className="text-sm">
            {cfGroup(
              '営業活動によるCF',
              '#0f766e',
              <>
                {cfItem('売上収入 (ウ)', c[2])}
                {cfItem('受取保険金 (A)', c[3])}
                {cfItem('材料仕入 (オ)', -c[5])}
                {cfItem('人件費 (カ)', -c[6])}
                {cfItem('販売費 (キ)', -c[7])}
                {cfItem('管理費 (ク)', -c[8])}
                {cfItem('法人税の支払 (コ)', -c[10])}
              </>,
              '営業CF',
              cf.opCF,
              'cf-op',
            )}
            {cfGroup('投資活動によるCF', '#6b4fa0', cfItem('什器の購入 (エ)', -c[4]), '投資CF', cf.invCF, 'cf-inv')}
            {cfGroup(
              '財務活動によるCF',
              '#9a7d10',
              <>
                {cfItem('資本金 (ア)', c[0])}
                {cfItem('借入 (イ)', c[1])}
                {cfItem('借入金返済 (ケ)', -c[9])}
              </>,
              '財務CF',
              cf.finCF,
              'cf-fin',
            )}
            <div className="rounded-xl border-2 border-ink/15 bg-canvas px-3 py-2.5">
              <div className="flex justify-between items-center py-0.5 text-[13px]">
                <span className="text-ink-600">現金の増減（営業＋投資＋財務）</span>
                <b className={`num ${cf.netCF < 0 ? 'text-accent-ink' : ''}`} data-testid="cf-net">
                  {fmtA(cf.netCF)}
                </b>
              </div>
              <div className="flex justify-between items-center py-0.5 text-[13px]">
                <span className="text-ink-600">期首現金</span>
                <b className="num">{fmt(r.openCash)}</b>
              </div>
              <div className="flex justify-between items-center border-t-2 border-ink/20 mt-1.5 pt-2">
                <span className="font-black">期末現金</span>
                <b className="num font-black text-lg">{fmt(r.openCash + cf.netCF)}</b>
              </div>
            </div>
          </div>
        </div>

        {/* 法人税・利益剰余金の計算＋補助勘定 */}
        <div className="flex flex-col gap-4">
          <div className="bg-white rounded-2xl shadow-card border border-line p-5">
            <h2 className="font-bold mb-3">法人税・利益剰余金の計算</h2>
            <div className="space-y-2 text-sm">
              {txRow('① 特別損益', fmtA(r.special), 'tx-special')}
              {txRow('② 税引前当期純利益（G ＋ ①）', fmtA(r.pretax), 'tx-pre')}
              {txRow('③ 前期繰越利益剰余金', fmtA(r.ret0), 'tx-ret0')}
              <div className="flex justify-between border-t border-dashed border-line pt-2">
                <span className="text-ink-600">④ 合計（② ＋ ③）</span>
                <b className="num" data-testid="tx-total">{fmtA(r.total4)}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-600">
                  ⑤ 法人税等 <span className="text-ink-400 text-xs">来期期首納税</span>
                </span>
                <b className="num" style={{ color: '#9a7d10' }} data-testid="tx-tax">
                  {fmt(r.tax)}
                </b>
              </div>
              {txRow('⑥ 当期純利益（② − ⑤）', fmtA(r.net), 'tx-net')}
              <div className="flex justify-between border-t-2 border-line pt-2 font-bold">
                <span>⑦ 次期繰越利益剰余金（⑥ ＋ ③）</span>
                <b className="num" data-testid="tx-ret1">{fmtA(r.retEnd)}</b>
              </div>
            </div>
            <p className="text-ink-400 text-[11px] mt-3 leading-relaxed">
              ②か④が▲なら5を納税／合計が+なら30%（前期繰越が▲のときは合計×30%）。※最低納税額は5。
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-card border border-line p-5">
            <h2 className="font-bold mb-3">補助勘定</h2>
            <div className="grid grid-cols-2 gap-x-5 gap-y-4 text-[13px]">
              <div>
                <div className="text-ink-400 text-xs mb-1">現金勘定</div>
                {subRow('前期繰越', fmt(r.openCash))}
                {subRow('＋入金 −出金', (r.cashFlow >= 0 ? '+' : '') + fmt(r.cashFlow))}
                {subRowB('次期繰越', fmt(r.cashEnd))}
              </div>
              <div>
                <div className="text-ink-400 text-xs mb-1">什器</div>
                {subRow('前期繰越', fmt(r.eq0))}
                {subRow('−減価償却', '−' + fmt(r.dep))}
                {subRowB('次期繰越', fmt(r.equipEnd))}
              </div>
              <div>
                <div className="text-ink-400 text-xs mb-1">借入金</div>
                {subRow('前期繰越', fmt(r.loan0))}
                {subRow('＋借入 −返済', fmt(r.loanEnd - r.loan0))}
                {subRowB('次期繰越', fmt(r.loanEnd))}
              </div>
              <div>
                <div className="text-ink-400 text-xs mb-1">在庫・原価</div>
                {subRow('平均単価', fmt(r.avg))}
                {subRow('売上原価', fmt(r.vPQ))}
                {subRowB('次期繰越', `${fmt(r.endInvQty)} / ${fmt(r.endInvVal)}`)}
              </div>
            </div>
          </div>
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
  editTx,
  onClose,
  onAct,
  onEvent,
}: {
  st: St
  keyName: string
  editTx?: TxRow | null
  onClose: () => void
  onAct: (k: string, f: Fvals) => void
  onEvent: (k: string) => void
}) {
  const a = ACTIONS[keyName]
  const form = FORMS[keyName]
  const isCustomEvent = keyName === 'ibutsu' || keyName === 'suigai'
  const [single, setSingle] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {}
    form?.fields.forEach((fl) => (o[fl.name] = String(editTx?.fvals?.[fl.name] ?? fl.default)))
    return o
  })
  const [items, setItems] = useState<Record<string, string>[]>(() => {
    if (form?.multi && Array.isArray(editTx?.fvals?.items) && editTx.fvals.items.length) {
      return editTx.fvals.items.map((it: Fvals) => {
        const o: Record<string, string> = {}
        form.rowFields!.forEach((fl) => (o[fl.name] = String(it[fl.name] ?? fl.default)))
        return o
      })
    }
    return form?.multi ? [initRow(form.rowFields!)] : []
  })

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
          {editTx ? <span className="text-ink-400 font-normal text-sm ml-1">の編集</span> : null}
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
            {editTx ? '変更を保存' : '決定して記帳'}
          </button>
        </div>
      </div>
    </div>
  )
}

// キーレス行（資本金・給料/家賃(期末)・増資 など）の金額のみを編集するモーダル
function AmountModal({ tx, onClose, onSave }: { tx: TxRow; onClose: () => void; onSave: (amount: number) => void }) {
  const [v, setV] = useState(String(tx.amount))
  const label = tx.label || (tx.key ? ACTIONS[tx.key]?.label : '') || '金額'
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5">
        <h3 className="font-bold text-lg mb-1" data-testid="amount-title">
          {label}
          <span className="text-ink-400 font-normal text-sm ml-1">の金額を変更</span>
        </h3>
        <p className="text-ink-400 text-xs mb-3">金額のみ変更できます（この行の削除はできません）。</p>
        <label className="block mb-3">
          <span className="text-sm">金額</span>
          <input
            data-testid="amount-input"
            type="number"
            inputMode="numeric"
            value={v}
            onChange={(e) => setV(e.target.value)}
            className="mt-1 w-full h-11 border border-line rounded-lg px-3 num text-right"
          />
        </label>
        <div className="flex gap-2">
          <button onClick={onClose} className="h-11 flex-1 rounded-xl border border-line font-bold text-ink-600">
            やめる
          </button>
          <button
            data-testid="amount-ok"
            onClick={() => onSave(Math.max(0, Math.round(Number(v) || 0)))}
            className="h-11 flex-1 rounded-xl bg-ink text-white font-bold"
          >
            変更を保存
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
