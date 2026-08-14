// 講師ログインの共通部分。/admin（研修一覧）と /admin/session（研修の管理画面）で使う。
//
// トークンは sessionStorage に置く。別タブで開いた場合、target="_blank" から開かれたタブは
// sessionStorage が複製されるためログイン済みのまま入れるが、URLを直接開いた場合は
// トークンが無いのでこのログイン画面が出る。
import { useCallback, useState } from 'react'
import { api } from '../lib/api'

export const TOKEN_KEY = 'mgAdminToken'

export function useAdminToken() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY))
  // 依存配列に入れても再生成されないよう安定化する
  const save = useCallback((t: string) => {
    sessionStorage.setItem(TOKEN_KEY, t)
    setToken(t)
  }, [])
  const clear = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }, [])
  return { token, save, clear }
}

export function AdminLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')

  async function login() {
    setErr('')
    try {
      const d = await api.adminLogin(pw)
      onLogin(d.token)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4 bg-canvas">
      <div className="bg-white rounded-2xl shadow-card border border-line p-6 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent text-white font-black text-xs">MG</span>
          <div className="font-black">講師ログイン</div>
        </div>
        <p className="text-ink-400 text-sm mb-3">
          管理者（講師）のみログインします。参加者はログイン不要で、配布された研修URLから参加します。
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
