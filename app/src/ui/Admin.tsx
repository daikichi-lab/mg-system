import { useCallback, useEffect, useState } from 'react'
import { api, type ApiOrgCompany } from '../lib/api'
import { fmt, fmtA, fmRatio } from '../lib/calc'
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

  const rows: { c: ApiOrgCompany; r: any }[] = []
  companies.forEach((c) => (c.results || []).slice().sort((a: any, b: any) => a.period - b.period).forEach((r: any) => rows.push({ c, r })))

  const newUrl = newCode.trim() ? new URL(`/?org=${encodeURIComponent(newCode.trim())}`, location.href).href : ''
  // 選択中の組織コードの参加用URL（いつでもコピーできるようヘッダーに置く）
  const orgUrl = org ? new URL(`/?org=${encodeURIComponent(org)}`, location.href).href : ''
  const frameSrc = curCo ? `/?vorg=${encodeURIComponent(org)}&vco=${encodeURIComponent(curCo.name)}` : ''
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
            <span className="ml-auto text-ink-300 text-[11px]">
              {mainView === 'rank'
                ? '現在の組織の各社・各期の成績。CSVでダウンロードできます。'
                : '参加者が見ている画面（閲覧専用）。'}
            </span>
          </div>

          {mainView === 'frame' ? (
            curCo ? (
              <iframe
                data-testid="spectator-frame"
                title="参加者ビュー"
                src={frameSrc}
                className="flex-1 w-full rounded-xl border border-line bg-white"
                style={{ minHeight: 600 }}
              />
            ) : (
              <div className="flex-1 grid place-items-center text-ink-300 text-sm bg-white rounded-xl border border-line" style={{ minHeight: 300 }}>
                左の一覧から参加者を選ぶと、その人が見ている画面（閲覧専用）が表示されます。
              </div>
            )
          ) : (
            <div className="flex-1 min-h-0 flex flex-col bg-white rounded-xl border border-line p-4">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap shrink-0">
                <div className="font-bold text-sm">
                  成績一覧 <span className="text-ink-400 font-normal">（{org}・{companies.length}社）</span>
                </div>
                <button
                  data-testid="csv-download"
                  onClick={() => downloadCsv(org, companies)}
                  className="h-9 px-3 rounded-lg bg-ink text-white text-xs font-bold hover:bg-ink-600"
                >
                  CSVダウンロード
                </button>
              </div>
              <div className="overflow-auto min-h-0">
                {rows.length ? (
                  <table className="w-full text-[12px] min-w-[860px]" data-testid="admin-rank">
                    <thead>
                      <tr className="text-ink-400 border-b border-line bg-canvas">
                        {['会社', '社長', '期', '売上PQ', '粗利', '固定費', '経常G', '当期純', '純資産', '粗利率', 'FM比率', '現金', 'ﾀｰﾝ', '意思決定'].map(
                          (h, i) => (
                            <th key={h} className={`px-2 py-1.5 whitespace-nowrap font-bold ${i > 2 ? 'text-right' : 'text-left'}`}>
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ c, r }, i) => {
                        const first = i === 0 || rows[i - 1].c.id !== c.id
                        return (
                          <tr key={c.id + '-' + r.period} className={`border-b border-line/60 ${first ? 'border-t-2 border-t-line/80' : ''}`}>
                            <td className={`px-2 py-1.5 font-bold whitespace-nowrap ${first ? '' : 'text-ink-300'}`}>{first ? c.name : '〃'}</td>
                            <td className="px-2 py-1.5 text-ink-400 text-[11px] whitespace-nowrap">{first ? c.president || '—' : ''}</td>
                            <td className="px-2 py-1.5 num text-ink-500 whitespace-nowrap">第{r.period}期</td>
                            <td className="px-2 py-1.5 text-right num">{fmt(r.PQ)}</td>
                            <td className="px-2 py-1.5 text-right num">{fmtA(r.mPQ)}</td>
                            <td className="px-2 py-1.5 text-right num">{fmtA(r.F)}</td>
                            <td className="px-2 py-1.5 text-right num">{fmtA(r.G)}</td>
                            <td className="px-2 py-1.5 text-right num">{fmtA(r.net)}</td>
                            <td className="px-2 py-1.5 text-right num">{fmtA(r.capEnd + r.retEnd)}</td>
                            <td className="px-2 py-1.5 text-right num">{r.PQ ? Math.round((r.mPQ / r.PQ) * 100) + '%' : '—'}</td>
                            <td className="px-2 py-1.5 text-right num">{fmRatio(r)}%</td>
                            <td className="px-2 py-1.5 text-right num">{fmtA(r.cashEnd)}</td>
                            <td className="px-2 py-1.5 text-right num">{r.turns}</td>
                            <td className="px-2 py-1.5 text-right num">{r.decisions}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-ink-300 text-sm p-6 text-center">
                    成績データがありません。参加者が決算すると各期の成績が表示されます。
                  </p>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
      <Toaster toasts={toasts} />
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
