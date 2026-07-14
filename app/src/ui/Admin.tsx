import { useCallback, useEffect, useState } from 'react'
import { api, type ApiOrgCompany } from '../lib/api'
import { fmt, fmtA, fmRatio } from '../lib/calc'
import { ORG_COLORS } from '../lib/figures-review'
import { OrgLineChart } from './OrgLineChart'
import { useToast, Toaster } from './Toast'

const TOKEN_KEY = 'mgAdminToken'

export default function Admin() {
  const { toasts, push: toast } = useToast()
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY))
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [orgs, setOrgs] = useState<string[]>([])
  const [org, setOrg] = useState('')
  const [companies, setCompanies] = useState<ApiOrgCompany[]>([])
  const [newCode, setNewCode] = useState('')
  const [issuedMsg, setIssuedMsg] = useState('')
  const [curCo, setCurCo] = useState<ApiOrgCompany | null>(null) // 参加者ビューで表示中の会社
  const [mainView, setMainView] = useState<'frame' | 'rank'>('frame') // 参加者ビュー / 成績一覧
  const [rankView, setRankView] = useState<'table' | 'charts'>('table') // 成績一覧：表形式 / グラフ形式
  const [frameMode, setFrameMode] = useState<'view' | 'edit'>('view') // 閲覧専用 / 編集モード
  const [frameKey, setFrameKey] = useState(0) // 参加者ビューの再読み込み用

  const loadOrgs = useCallback(async (tk: string) => {
    try {
      const d = await api.adminOrgs(tk)
      setOrgs(d.orgs)
      if (d.orgs.length && !org) setOrg(d.orgs[0])
    } catch (e: any) {
      if (String(e.message).includes('unauthorized')) {
        sessionStorage.removeItem(TOKEN_KEY)
        setToken(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadCompanies = useCallback(async (code: string) => {
    if (!code) return setCompanies([])
    const d = await api.org(code)
    setCompanies(d.companies)
  }, [])

  useEffect(() => {
    if (token) void loadOrgs(token)
  }, [token, loadOrgs])
  useEffect(() => {
    if (org) void loadCompanies(org)
    setCurCo(null)
  }, [org, loadCompanies])

  async function login() {
    setErr('')
    try {
      const d = await api.adminLogin(pw)
      sessionStorage.setItem(TOKEN_KEY, d.token)
      setToken(d.token)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  // 推測されにくい高エントロピーな組織コードを生成（紛らわしい文字を除外）
  function genCode() {
    const alpha = 'abcdefghjkmnpqrstuvwxyz23456789'
    const bytes = crypto.getRandomValues(new Uint8Array(12))
    setNewCode('MG-' + Array.from(bytes, (b) => alpha[b % alpha.length]).join(''))
    setIssuedMsg('')
  }
  // 組織コードを発行（登録）＝参加者がこのURLで開始できるようになる
  async function issueOrg() {
    const code = newCode.trim()
    if (!code || !token) return
    setIssuedMsg('')
    try {
      await api.adminCreateOrg(token, code)
      setIssuedMsg(`✓ 「${code}」を発行しました。参加者はこのURLで開始できます。`)
      await loadOrgs(token)
    } catch (e: any) {
      setIssuedMsg('発行に失敗しました：' + e.message)
    }
  }
  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* クリップボード不可の環境では無視 */
    }
  }
  async function resetCompany(c: ApiOrgCompany) {
    if (!token) return
    if (!confirm(`「${c.name}」のデータ（プレイ中の状態・成績履歴）を削除します。元に戻せません。よろしいですか？`)) return
    await api.adminDeleteCompany(token, c.id)
    if (curCo?.id === c.id) setCurCo(null)
    await loadCompanies(org)
  }
  async function clearOrg() {
    if (!token || !org || !companies.length) return
    if (!confirm(`組織「${org}」の参加者${companies.length}名のデータをすべて削除します。元に戻せません。よろしいですか？`)) return
    await api.adminDeleteOrg(token, org)
    setCurCo(null)
    await loadCompanies(org)
  }
  // 組織自体を削除：登録も消すので、以後この組織コードのURLでは参加できなくなる
  async function removeOrg() {
    if (!token || !org) return
    if (!confirm(`組織「${org}」を削除します。参加者データも参加用URL（組織コード）も無効になり、元に戻せません。よろしいですか？`)) return
    await api.adminRemoveOrg(token, org)
    setCurCo(null)
    setCompanies([])
    const d = await api.adminOrgs(token)
    setOrgs(d.orgs)
    setOrg(d.orgs[0] || '')
  }

  if (!token) {
    return (
      <div className="min-h-screen grid place-items-center p-4 bg-canvas">
        <div className="bg-white rounded-2xl shadow-card border border-line p-6 w-full max-w-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent text-white font-black text-xs">MG</span>
            <div className="font-black">講師ログイン</div>
          </div>
          <p className="text-ink-400 text-sm mb-3">
            管理者（講師）のみログインします。参加者はログイン不要で、配布された組織コード付きURLから参加します。
          </p>
          <input
            data-testid="admin-pw"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && login()}
            placeholder="パスワード"
            className="w-full h-11 border border-line rounded-lg px-3"
          />
          <p className="text-accent-ink text-xs mt-1 h-4" data-testid="admin-err">
            {err}
          </p>
          <button data-testid="admin-login" onClick={login} className="mt-1 w-full h-11 rounded-xl bg-ink text-white font-bold">
            ログイン
          </button>
          <p className="text-ink-300 text-[11px] mt-3">
            デモ用パスワード：<b className="num">mg</b>
          </p>
        </div>
      </div>
    )
  }

  const newUrl = newCode.trim() ? new URL(`/?org=${encodeURIComponent(newCode.trim())}`, location.href).href : ''
  // 選択中の組織コードの参加用URL（いつでもコピーできるようヘッダーに置く）
  const orgUrl = org ? new URL(`/?org=${encodeURIComponent(org)}`, location.href).href : ''
  const frameSrc = curCo
    ? `/?vorg=${encodeURIComponent(org)}&vco=${encodeURIComponent(curCo.name)}${frameMode === 'edit' ? '&vedit=1' : ''}`
    : ''
  const status = (c: ApiOrgCompany) =>
    c.settled ? { label: '決算済み', color: '#9a7d10' } : c.started ? { label: 'プレイ中', color: '#0f766e' } : { label: '記録のみ', color: '#9aa3b2' }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-line px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent text-white font-black text-xs">MG</span>
          <div>
            <div className="font-black leading-tight">戦略MG 管理者ビュー</div>
            <div className="text-ink-400 text-[11px] leading-tight">組織コード単位で参加者の状況を確認</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-ink-400">組織コード</label>
          <select
            data-testid="admin-org"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            className="h-10 border border-line rounded-lg px-3 bg-white"
          >
            {orgs.length ? (
              orgs.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))
            ) : (
              <option value="">（組織なし）</option>
            )}
          </select>
          <button
            data-testid="admin-copy-url"
            onClick={() => {
              if (!orgUrl) return
              void copyText(orgUrl)
              toast('参加用URLをコピーしました')
            }}
            disabled={!org}
            title={orgUrl}
            className="h-10 px-3 rounded-lg border border-line text-ink-600 text-sm font-bold hover:bg-canvas disabled:opacity-40"
          >
            URLコピー
          </button>
          <button
            data-testid="admin-refresh"
            onClick={async () => {
              if (!org) return
              await loadCompanies(org)
              toast('更新しました')
            }}
            className="h-10 px-3 rounded-lg border border-line text-ink-600 text-sm font-bold hover:bg-canvas"
          >
            更新
          </button>
          <button
            data-testid="admin-remove-org"
            onClick={removeOrg}
            disabled={!org}
            className="h-10 px-3 rounded-lg border border-accent/40 text-accent text-sm font-bold hover:bg-accent/5 disabled:opacity-40"
          >
            組織を削除
          </button>
          <button
            onClick={() => {
              sessionStorage.removeItem(TOKEN_KEY)
              setToken(null)
            }}
            className="h-10 px-3 rounded-lg border border-line text-ink-400 text-sm hover:bg-canvas"
          >
            ログアウト
          </button>
        </div>
      </header>

      <div className="grid lg:grid-cols-[320px_1fr] gap-0">
        {/* 左：参加用URL発行 ＋ 参加者一覧 */}
        <aside className="bg-white border-r border-line p-3 lg:h-[calc(100vh-61px)] lg:overflow-y-auto">
          <div className="rounded-xl border border-line bg-canvas p-3 mb-3">
            <div className="text-ink-400 text-xs font-bold mb-1.5">参加用URLを発行</div>
            <div className="flex gap-2">
              <input
                data-testid="new-code"
                value={newCode}
                onChange={(e) => {
                  setNewCode(e.target.value)
                  setIssuedMsg('')
                }}
                placeholder="組織コード"
                className="flex-1 h-9 border border-line rounded-lg px-2 text-sm bg-white outline-none focus:border-ink/40 min-w-0"
              />
              <button
                data-testid="gen-code"
                onClick={genCode}
                className="h-9 px-2.5 rounded-lg border border-line text-ink-600 text-xs font-bold whitespace-nowrap shrink-0"
              >
                ランダム生成
              </button>
              <button
                data-testid="issue-org"
                onClick={issueOrg}
                disabled={!newCode.trim()}
                className="h-9 px-3 rounded-lg bg-ink text-white text-xs font-bold whitespace-nowrap shrink-0 disabled:opacity-40"
              >
                発行
              </button>
            </div>
            {issuedMsg && (
              <p data-testid="issued-msg" className="text-emerald-700 text-[11px] mt-2">
                {issuedMsg}
              </p>
            )}
            {newUrl && (
              <div className="mt-2">
                <input data-testid="new-url" readOnly value={newUrl} className="w-full h-9 border border-line rounded-lg px-2 text-[11px] bg-white num" />
                <button
                  data-testid="copy-url"
                  onClick={() => {
                    void copyText(newUrl)
                    toast('URLをコピーしました')
                  }}
                  className="mt-1 w-full h-8 rounded-lg border border-line text-ink-600 text-xs font-bold hover:bg-white"
                >
                  URLをコピー
                </button>
                <p className="text-ink-300 text-[10px] mt-1 leading-snug">
                  参加者に配布。開くと組織コードが設定され、会社名を入れて開始できます（ログイン不要）。
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 mb-2 px-1">
            <div className="text-ink-400 text-xs font-bold">
              参加者一覧 {companies.length ? `（${companies.length}名）` : ''}
            </div>
            <button data-testid="admin-clear-org" onClick={clearOrg} className="text-[11px] text-accent hover:underline">
              参加者データを全消去
            </button>
          </div>
          {companies.length ? (
            <div className="space-y-2">
              {companies.map((c) => {
                const s = status(c)
                const on = curCo?.id === c.id
                return (
                  <div
                    key={c.id}
                    className={`rounded-xl border p-3 transition hover:shadow-sm ${on ? 'border-ink ring-2 ring-ink/15' : 'border-line'}`}
                  >
                    <div
                      className="cursor-pointer"
                      onClick={() => {
                        // 誤編集防止のため、参加者を切り替えたら閲覧専用に戻す
                        if (curCo?.id !== c.id) setFrameMode('view')
                        setCurCo(c)
                        setMainView('frame')
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-bold text-sm truncate">{c.name}</div>
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: s.color + '1a', color: s.color }}
                        >
                          {s.label}
                        </span>
                      </div>
                      <div className="text-ink-400 text-[11px] mt-0.5 truncate">社長：{c.president || '—'}</div>
                      <div className="num text-[11px] text-ink-500 mt-1">
                        第{c.period || '-'}期　{(c.results || []).length ? `決算${(c.results || []).length}期` : ''}
                      </div>
                    </div>
                    <div className="flex justify-end mt-1.5 pt-1.5 border-t border-line/70">
                      <button
                        data-testid={`admin-reset-${c.id}`}
                        onClick={() => resetCompany(c)}
                        className="text-[10px] text-ink-300 hover:text-accent"
                      >
                        データをリセット
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-ink-300 text-sm p-4 text-center">
              参加者がいません。
              <br />
              発行した参加用URL（組織コード付き）から参加者がプレイ・決算すると表示されます。
            </p>
          )}
        </aside>

        {/* 右：参加者ビュー ⇄ 成績一覧 */}
        <main className="p-3 lg:h-[calc(100vh-61px)] flex flex-col min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5 text-xs font-bold shrink-0">
              <button
                data-testid="mv-frame"
                onClick={() => setMainView('frame')}
                className={`px-3 py-1 rounded-md transition ${mainView === 'frame' ? 'bg-white shadow-sm text-ink' : 'text-ink-400'}`}
              >
                参加者ビュー
              </button>
              <button
                data-testid="mv-rank"
                onClick={() => setMainView('rank')}
                className={`px-3 py-1 rounded-md transition ${mainView === 'rank' ? 'bg-white shadow-sm text-ink' : 'text-ink-400'}`}
              >
                成績一覧
              </button>
            </div>
            <div className="font-bold text-sm">{mainView === 'rank' ? '成績一覧' : curCo ? curCo.name : '参加者を選択してください'}</div>
            {mainView === 'frame' && curCo && (
              <>
                <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5 text-xs font-bold shrink-0">
                  <button
                    data-testid="frame-view"
                    onClick={() => setFrameMode('view')}
                    className={`px-3 py-1 rounded-md transition ${frameMode === 'view' ? 'bg-white shadow-sm text-ink' : 'text-ink-400'}`}
                  >
                    閲覧専用
                  </button>
                  <button
                    data-testid="frame-edit"
                    onClick={() => setFrameMode('edit')}
                    className={`px-3 py-1 rounded-md transition ${frameMode === 'edit' ? 'bg-amber-500 text-white shadow-sm' : 'text-ink-400'}`}
                  >
                    ✏️ 編集モード
                  </button>
                </div>
                <button
                  data-testid="frame-reload"
                  onClick={() => setFrameKey((k) => k + 1)}
                  className="h-7 px-2.5 rounded-lg border border-line text-ink-600 text-xs font-bold hover:bg-canvas shrink-0"
                >
                  再読み込み
                </button>
              </>
            )}
            <span className="ml-auto text-ink-300 text-[11px]">
              {mainView === 'rank'
                ? '現在の組織の各社・各期の成績。CSVでダウンロードできます。'
                : frameMode === 'edit' && curCo
                  ? '編集モード：この画面での修正は参加者のデータに即保存されます。参加者が同時に操作中の場合は上書きにご注意ください。'
                  : '参加者が見ている画面（閲覧専用）。'}
            </span>
          </div>

          {/* 参加者ビューの iframe は成績一覧に切り替えても残す（アンマウントすると閲覧中の期・タブがリセットされるため hidden で隠すだけ） */}
          {curCo && (
            <iframe
              key={frameKey}
              data-testid="spectator-frame"
              title="参加者ビュー"
              src={frameSrc}
              className={`flex-1 w-full rounded-xl border ${frameMode === 'edit' ? 'border-amber-400 ring-2 ring-amber-200' : 'border-line'} bg-white ${mainView === 'frame' ? '' : 'hidden'}`}
              style={{ minHeight: mainView === 'frame' ? 600 : undefined }}
            />
          )}
          {mainView === 'frame' && !curCo && (
            <div className="flex-1 grid place-items-center text-ink-300 text-sm bg-white rounded-xl border border-line" style={{ minHeight: 300 }}>
              左の一覧から参加者を選ぶと、その人が見ている画面（閲覧専用）が表示されます。
            </div>
          )}
          {mainView === 'rank' && (
            <div className="flex-1 min-h-0 flex flex-col bg-white rounded-xl border border-line p-4">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap shrink-0">
                <div className="font-bold text-sm">
                  成績一覧 <span className="text-ink-400 font-normal">（{org}・{companies.length}社）</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5 text-xs font-bold">
                    <button
                      data-testid="rank-table"
                      onClick={() => setRankView('table')}
                      className={`px-3 py-1 rounded-md transition ${rankView === 'table' ? 'bg-white shadow-sm text-ink' : 'text-ink-400'}`}
                    >
                      表形式
                    </button>
                    <button
                      data-testid="rank-charts"
                      onClick={() => setRankView('charts')}
                      className={`px-3 py-1 rounded-md transition ${rankView === 'charts' ? 'bg-white shadow-sm text-ink' : 'text-ink-400'}`}
                    >
                      グラフ形式
                    </button>
                  </div>
                  <button
                    data-testid="csv-download"
                    onClick={() => downloadCsv(org, companies)}
                    className="h-9 px-3 rounded-lg bg-ink text-white text-xs font-bold hover:bg-ink-600"
                  >
                    CSVダウンロード
                  </button>
                </div>
              </div>
              <div className="overflow-auto min-h-0">
                {rankView === 'table' ? <RankTable companies={companies} /> : <RankCharts companies={companies} />}
              </div>
            </div>
          )}
        </main>
      </div>
      <Toaster toasts={toasts} />
    </div>
  )
}

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

function RankTable({ companies }: { companies: ApiOrgCompany[] }) {
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
function RankCharts({ companies }: { companies: ApiOrgCompany[] }) {
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

function downloadCsv(org: string, companies: ApiOrgCompany[]) {
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
