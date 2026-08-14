// 管理画面の外枠（/admin・/admin/rules…）。サイドメニュー ＋ URL に対応する画面。
// 研修1件の管理は /admin/session?org=… （AdminSession.tsx）で別タブに開く。
import { useCallback, useEffect, useState } from 'react'
import { api, type ApiOrg, type ApiRuleset } from '../lib/api'
import { useToast, Toaster } from './Toast'
import { AdminLogin, useAdminToken } from './adminAuth'
import SessionList from './SessionList'
import RulesList from './RulesList'
import RuleView, { NotFound } from './RuleView'
import RuleEditor from './RuleEditor'

const MENU = [
  { href: '/admin', label: '研修一覧', key: 'sessions' },
  { href: '/admin/rules', label: 'ルール一覧', key: 'rules' },
] as const

/** URL から表示する画面を決める。React Router は使わず正規表現で分岐する。 */
type Route =
  | { page: 'sessions' }
  | { page: 'rules' }
  | { page: 'rule-new' }
  | { page: 'rule-view'; id: number }
  | { page: 'rule-edit'; id: number }
  | { page: 'not-found' }

function routeOf(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '')
  if (/\/admin$/.test(path)) return { page: 'sessions' }
  if (/\/admin\/rules$/.test(path)) return { page: 'rules' }
  if (/\/admin\/rules\/new$/.test(path)) return { page: 'rule-new' }
  const edit = path.match(/\/admin\/rules\/(\d+)\/edit$/)
  if (edit) return { page: 'rule-edit', id: Number(edit[1]) }
  const view = path.match(/\/admin\/rules\/(\d+)$/)
  if (view) return { page: 'rule-view', id: Number(view[1]) }
  return { page: 'not-found' }
}

export default function Admin() {
  const { toasts, push: toast } = useToast()
  const { token, save: saveToken, clear: clearToken } = useAdminToken()
  const [orgs, setOrgs] = useState<ApiOrg[]>([])
  const [rulesets, setRulesets] = useState<ApiRuleset[]>([])
  const route = routeOf(location.pathname)

  const onUnauthorized = useCallback(
    (e: any) => {
      if (String(e.message).includes('unauthorized')) clearToken()
    },
    [clearToken],
  )

  const loadOrgs = useCallback(
    async (tk: string) => {
      try {
        setOrgs((await api.adminOrgs(tk)).orgs)
      } catch (e) {
        onUnauthorized(e)
      }
    },
    [onUnauthorized],
  )

  const loadRulesets = useCallback(
    async (tk: string) => {
      try {
        setRulesets((await api.adminRulesets(tk)).rulesets)
      } catch (e) {
        onUnauthorized(e)
      }
    },
    [onUnauthorized],
  )

  const page = route.page
  useEffect(() => {
    if (!token) return
    if (page === 'sessions') void loadOrgs(token)
    if (page === 'rules') void loadRulesets(token)
  }, [token, page, loadOrgs, loadRulesets])

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
          {MENU.map((m) => {
            const on = m.key === 'sessions' ? page === 'sessions' : page !== 'sessions'
            return (
              <a
                key={m.key}
                data-testid={`menu-${m.key}`}
                href={m.href}
                className={`block px-3 h-10 leading-10 rounded-lg text-sm font-bold transition ${
                  on ? 'bg-ink text-white' : 'text-ink-600 hover:bg-canvas'
                }`}
              >
                {m.label}
              </a>
            )
          })}
        </nav>
        <button
          onClick={clearToken}
          className="mt-auto h-10 rounded-lg border border-line text-ink-400 text-sm hover:bg-canvas"
        >
          ログアウト
        </button>
      </aside>

      <main className="bg-canvas min-w-0">
        {route.page === 'sessions' && (
          <SessionList token={token} orgs={orgs} reload={() => loadOrgs(token)} toast={toast} />
        )}
        {route.page === 'rules' && (
          <RulesList token={token} rulesets={rulesets} reload={() => loadRulesets(token)} toast={toast} />
        )}
        {route.page === 'rule-new' && <RuleEditor token={token} id={null} toast={toast} />}
        {route.page === 'rule-view' && <RuleView token={token} id={route.id} toast={toast} />}
        {route.page === 'rule-edit' && <RuleEditor token={token} id={route.id} toast={toast} />}
        {route.page === 'not-found' && <NotFound message="ページが見つかりません。" />}
      </main>
      <Toaster toasts={toasts} />
    </div>
  )
}
