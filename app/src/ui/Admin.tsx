import { useCallback, useEffect, useState } from 'react'
import { api, type ApiOrgCompany } from '../lib/api'
import { fmt, fmtA, fmRatio } from '../lib/calc'

const TOKEN_KEY = 'mgAdminToken'

export default function Admin() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY))
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [orgs, setOrgs] = useState<string[]>([])
  const [org, setOrg] = useState('')
  const [companies, setCompanies] = useState<ApiOrgCompany[]>([])
  const [newCode, setNewCode] = useState('')
  const [issuedMsg, setIssuedMsg] = useState('')

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

  if (!token) {
    return (
      <div className="min-h-screen grid place-items-center p-4 bg-canvas">
        <div className="bg-white rounded-2xl shadow-sm border border-line p-6 w-full max-w-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent text-white font-black text-xs">MG</span>
            <div className="font-black">講師ログイン</div>
          </div>
          <p className="text-ink-400 text-sm mb-3">管理者（講師）のみログインします。参加者はログイン不要です。</p>
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
  companies.forEach((c) => (c.results || []).forEach((r: any) => rows.push({ c, r })))

  const joinUrl = org ? new URL(`/?org=${encodeURIComponent(org)}`, location.href).href : ''
  const newUrl = newCode.trim() ? new URL(`/?org=${encodeURIComponent(newCode.trim())}`, location.href).href : ''

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-line px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent text-white font-black text-xs">MG</span>
          <div className="font-black">戦略MG 管理者ビュー</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-ink-400">組織</label>
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
          <button data-testid="admin-refresh" onClick={() => org && loadCompanies(org)} className="h-10 px-3 rounded-lg border border-line text-sm font-bold">
            更新
          </button>
          <button
            onClick={() => {
              sessionStorage.removeItem(TOKEN_KEY)
              setToken(null)
            }}
            className="h-10 px-3 rounded-lg border border-line text-ink-400 text-sm"
          >
            ログアウト
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-line p-4">
          <div className="font-bold text-sm mb-1">新しい組織の参加用URLを発行</div>
          <p className="text-ink-400 text-xs mb-2">
            コードを決めて<b>「発行」</b>すると、そのURLで参加者が開始できるようになります（未発行のコードでは参加できません）。ランダムなコードにすると推測による部外者参加を防げます。
          </p>
          <div className="flex gap-2 flex-wrap items-center">
            <input
              data-testid="new-code"
              value={newCode}
              onChange={(e) => {
                setNewCode(e.target.value)
                setIssuedMsg('')
              }}
              placeholder="組織コード（例）MG-xxxx"
              className="h-10 border border-line rounded-lg px-3 text-sm flex-1 min-w-[180px]"
            />
            <button
              data-testid="gen-code"
              onClick={genCode}
              className="h-10 px-3 rounded-lg border border-line text-ink-600 text-xs font-bold whitespace-nowrap"
            >
              ランダム生成
            </button>
            <button
              data-testid="issue-org"
              onClick={issueOrg}
              disabled={!newCode.trim()}
              className="h-10 px-4 rounded-lg bg-ink text-white text-xs font-bold whitespace-nowrap disabled:opacity-40"
            >
              発行
            </button>
          </div>
          {issuedMsg && (
            <p data-testid="issued-msg" className="text-emerald-700 text-xs mt-2">
              {issuedMsg}
            </p>
          )}
          {newUrl && (
            <div className="mt-2 flex gap-2 items-center flex-wrap">
              <code data-testid="new-url" className="num text-xs bg-canvas px-2 py-1 rounded flex-1 min-w-[220px] break-all">
                {newUrl}
              </code>
              <button
                data-testid="copy-url"
                onClick={() => copyText(newUrl)}
                className="h-9 px-3 rounded-lg border border-line text-xs font-bold whitespace-nowrap"
              >
                URLをコピー
              </button>
            </div>
          )}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-line p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            参加用URL：
            <code className="num text-xs bg-canvas px-2 py-1 rounded" data-testid="join-url">
              {joinUrl}
            </code>
          </div>
          <button
            data-testid="admin-clear-org"
            onClick={async () => {
              if (!org || !companies.length) return
              if (confirm(`組織「${org}」の参加者データをすべて削除しますか？`)) {
                await api.adminDeleteOrg(token!, org)
                await loadOrgs(token!)
                setCompanies([])
              }
            }}
            className="text-[12px] text-accent hover:underline"
          >
            組織を全消去
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-line p-4 overflow-x-auto">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="font-bold text-sm">
              成績一覧 <span className="text-ink-400 font-normal">（{org}・{companies.length}社）</span>
            </div>
            <button
              data-testid="csv-download"
              onClick={() => downloadCsv(org, companies)}
              className="h-9 px-3 rounded-lg bg-ink text-white text-xs font-bold"
            >
              CSVダウンロード
            </button>
          </div>
          {rows.length ? (
            <table className="w-full text-[12px] min-w-[820px]" data-testid="admin-rank">
              <thead>
                <tr className="text-ink-400 border-b border-line bg-canvas">
                  {['会社', '社長', '期', '売上PQ', '粗利', '固定費', '経常G', '当期純', '純資産', 'FM比率', '現金', 'ﾀｰﾝ', '意思決定', ''].map(
                    (h) => (
                      <th key={h} className="px-2 py-1.5 whitespace-nowrap text-right first:text-left">
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
                    <tr key={c.id + '-' + r.period} className={`border-b border-line/60 ${first ? 'border-t border-line' : ''}`}>
                      <td className="px-2 py-1.5 font-bold whitespace-nowrap">{first ? c.name : '〃'}</td>
                      <td className="px-2 py-1.5 text-ink-400 text-[11px] whitespace-nowrap">{first ? c.president || '—' : ''}</td>
                      <td className="px-2 py-1.5 num text-ink-500">第{r.period}期</td>
                      <td className="px-2 py-1.5 text-right num">{fmt(r.PQ)}</td>
                      <td className="px-2 py-1.5 text-right num">{fmtA(r.mPQ)}</td>
                      <td className="px-2 py-1.5 text-right num">{fmtA(r.F)}</td>
                      <td className="px-2 py-1.5 text-right num">{fmtA(r.G)}</td>
                      <td className="px-2 py-1.5 text-right num">{fmtA(r.net)}</td>
                      <td className="px-2 py-1.5 text-right num">{fmtA(r.capEnd + r.retEnd)}</td>
                      <td className="px-2 py-1.5 text-right num">{fmRatio(r)}%</td>
                      <td className="px-2 py-1.5 text-right num">{fmtA(r.cashEnd)}</td>
                      <td className="px-2 py-1.5 text-right num">{r.turns}</td>
                      <td className="px-2 py-1.5 text-right num">{r.decisions}</td>
                      <td className="px-2 py-1.5 text-right">
                        {first && (
                          <button
                            data-testid={`admin-reset-${c.id}`}
                            onClick={async () => {
                              if (confirm(`「${c.name}」のデータを削除しますか？`)) {
                                await api.adminDeleteCompany(token!, c.id)
                                await loadCompanies(org)
                              }
                            }}
                            className="text-ink-300 hover:text-accent text-[11px]"
                          >
                            リセット
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-ink-300 text-sm p-6 text-center">成績データがありません。参加者が決算すると表示されます。</p>
          )}
        </div>
      </main>
    </div>
  )
}

function downloadCsv(org: string, companies: ApiOrgCompany[]) {
  const header = ['組織コード', '会社名', '社長名', '期', '売上PQ', '粗利', '固定費', '経常利益', '当期純利益', '純資産', 'FM比率%', '現金', 'ターン数', '意思決定回数']
  const lines = [header]
  companies.forEach((c) => {
    ;(c.results || []).forEach((r: any) => {
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
