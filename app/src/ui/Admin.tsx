// 管理画面の外枠（/admin）。サイドメニュー ＋ 選択中の画面。
// 研修1件の管理は /admin/session?org=… （AdminSession.tsx）で別タブに開く。
import { useCallback, useEffect, useState } from 'react'
import { api, type ApiOrg } from '../lib/api'
import { useToast, Toaster } from './Toast'
import { AdminLogin, useAdminToken } from './adminAuth'
import SessionList from './SessionList'

type MenuKey = 'sessions' | 'rules'

const MENU: { key: MenuKey; label: string }[] = [
  { key: 'sessions', label: '研修一覧' },
  { key: 'rules', label: 'ルール一覧' },
]

export default function Admin() {
  const { toasts, push: toast } = useToast()
  const { token, save: saveToken, clear: clearToken } = useAdminToken()
  const [menu, setMenu] = useState<MenuKey>('sessions')
  const [orgs, setOrgs] = useState<ApiOrg[]>([])

  const loadOrgs = useCallback(
    async (tk: string) => {
      try {
        const d = await api.adminOrgs(tk)
        setOrgs(d.orgs)
      } catch (e: any) {
        if (String(e.message).includes('unauthorized')) clearToken()
      }
    },
    [clearToken],
  )

  useEffect(() => {
    if (token) void loadOrgs(token)
  }, [token, loadOrgs])

  if (!token) return <AdminLogin onLogin={saveToken} />

  return (
    <div className="min-h-screen grid lg:grid-cols-[220px_1fr]">
      <aside className="bg-white border-r border-line p-3 lg:h-screen lg:sticky lg:top-0 flex flex-col">
        <div className="flex items-center gap-2 px-1 py-2 mb-2">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent text-white font-black text-xs">MG</span>
          <div>
            <div className="font-black leading-tight text-sm">戦略MG</div>
            <div className="text-ink-400 text-[11px] leading-tight">管理画面</div>
          </div>
        </div>
        <nav className="space-y-1">
          {MENU.map((m) => (
            <button
              key={m.key}
              data-testid={`menu-${m.key}`}
              onClick={() => setMenu(m.key)}
              className={`w-full text-left px-3 h-10 rounded-lg text-sm font-bold transition ${
                menu === m.key ? 'bg-ink text-white' : 'text-ink-600 hover:bg-canvas'
              }`}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <button
          onClick={clearToken}
          className="mt-auto h-10 rounded-lg border border-line text-ink-400 text-sm hover:bg-canvas"
        >
          ログアウト
        </button>
      </aside>

      <main className="bg-canvas min-w-0">
        {menu === 'sessions' && (
          <SessionList token={token} orgs={orgs} reload={() => loadOrgs(token)} toast={toast} />
        )}
        {menu === 'rules' && (
          <div className="p-4 sm:p-6">
            <h1 className="font-black text-lg">ルール一覧</h1>
            <p className="text-ink-400 text-xs mt-0.5">研修で使う数値ルールの一覧・編集。</p>
            <div className="mt-4 bg-white rounded-xl border border-line p-10 text-center text-ink-300 text-sm">
              準備中です。
            </div>
          </div>
        )}
      </main>
      <Toaster toasts={toasts} />
    </div>
  )
}
