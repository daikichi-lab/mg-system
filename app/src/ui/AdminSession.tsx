// 研修1件の管理画面（/admin/session?org=<研修URL のコード>）。
// 研修一覧から別タブで開く。中身は従来の管理者ビュー（参加者ビュー ⇄ 成績一覧）。
import { useCallback, useEffect, useState } from 'react'
import { api, type ApiOrgCompany } from '../lib/api'
import { useToast, Toaster } from './Toast'
import { AdminLogin, useAdminToken } from './adminAuth'
import { RankTable, RankCharts, downloadCsv } from './AdminRank'

export default function AdminSession({ org }: { org: string }) {
  const { toasts, push: toast } = useToast()
  const { token, save: saveToken, clear: clearToken } = useAdminToken()
  const [orgName, setOrgName] = useState('')
  const [companies, setCompanies] = useState<ApiOrgCompany[]>([])
  const [curCo, setCurCo] = useState<ApiOrgCompany | null>(null) // 参加者ビューで表示中の会社
  const [mainView, setMainView] = useState<'frame' | 'rank'>('frame') // 参加者ビュー / 成績一覧
  const [rankView, setRankView] = useState<'table' | 'charts'>('table') // 成績一覧：表形式 / グラフ形式
  const [frameMode, setFrameMode] = useState<'view' | 'edit'>('view') // 閲覧専用 / 編集モード
  const [frameKey, setFrameKey] = useState(0) // 参加者ビューの再読み込み用

  const loadCompanies = useCallback(async (code: string) => {
    if (!code) return setCompanies([])
    const d = await api.org(code)
    setCompanies(d.companies)
  }, [])

  // 研修名はヘッダー表示用。一覧APIから引く（見つからなければコードをそのまま出す）
  const loadName = useCallback(
    async (tk: string) => {
      try {
        const d = await api.adminOrgs(tk)
        setOrgName(d.orgs.find((o) => o.code === org)?.name || org)
      } catch (e: any) {
        if (String(e.message).includes('unauthorized')) clearToken()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [org],
  )

  useEffect(() => {
    if (!token) return
    void loadName(token)
    void loadCompanies(org)
  }, [token, org, loadName, loadCompanies])

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
    if (!confirm(`この研修の参加者${companies.length}名のデータをすべて削除します。元に戻せません。よろしいですか？`)) return
    await api.adminDeleteOrg(token, org)
    setCurCo(null)
    await loadCompanies(org)
  }

  if (!token) return <AdminLogin onLogin={saveToken} />

  const orgUrl = org ? new URL(`/?org=${encodeURIComponent(org)}`, location.href).href : ''
  const frameSrc = curCo
    ? `/?vorg=${encodeURIComponent(org)}&vco=${encodeURIComponent(curCo.name)}${frameMode === 'edit' ? '&vedit=1' : ''}`
    : ''
  const status = (c: ApiOrgCompany) =>
    c.settled ? { label: '決算済み', color: '#9a7d10' } : c.started ? { label: 'プレイ中', color: '#0f766e' } : { label: '記録のみ', color: '#9aa3b2' }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-line px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap sticky top-0 z-20">
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent text-white font-black text-xs shrink-0">MG</span>
          <div className="min-w-0">
            <div className="font-black leading-tight truncate" data-testid="session-name">
              {orgName || org}
            </div>
            <div className="text-ink-400 text-[11px] leading-tight num truncate">{org}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="admin-copy-url"
            onClick={() => {
              if (!orgUrl) return
              void copyText(orgUrl)
              toast('研修URLをコピーしました')
            }}
            title={orgUrl}
            className="h-10 px-3 rounded-lg border border-line text-ink-600 text-sm font-bold hover:bg-canvas"
          >
            研修URLをコピー
          </button>
          <button
            data-testid="admin-refresh"
            onClick={async () => {
              await loadCompanies(org)
              toast('更新しました')
            }}
            className="h-10 px-3 rounded-lg border border-line text-ink-600 text-sm font-bold hover:bg-canvas"
          >
            更新
          </button>
          <a
            href="/admin"
            className="h-10 px-3 rounded-lg border border-line text-ink-600 text-sm font-bold hover:bg-canvas grid place-items-center"
          >
            研修一覧へ
          </a>
          <button
            onClick={clearToken}
            className="h-10 px-3 rounded-lg border border-line text-ink-400 text-sm hover:bg-canvas"
          >
            ログアウト
          </button>
        </div>
      </header>

      <div className="grid lg:grid-cols-[320px_1fr] gap-0">
        {/* 左：参加者一覧 */}
        <aside className="bg-white border-r border-line p-3 lg:h-[calc(100vh-61px)] lg:overflow-y-auto">
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
              研修URLを配ると、参加者が会社名を入れて開始できます（ログイン不要）。
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
                ? 'この研修の各社・各期の成績。CSVでダウンロードできます。'
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
                  成績一覧 <span className="text-ink-400 font-normal">（{orgName || org}・{companies.length}社）</span>
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
