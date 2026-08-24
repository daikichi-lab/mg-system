import Participant from './ui/Participant'
import Admin from './ui/Admin'
import AdminSession from './ui/AdminSession'

export default function App() {
  const path = location.pathname.replace(/\/+$/, '')
  // 研修1件の管理画面（研修一覧から別タブで開く）
  if (path.endsWith('/admin/session')) {
    return <AdminSession org={(new URLSearchParams(location.search).get('org') || '').trim()} />
  }
  // 管理画面（研修一覧・ルール一覧/作成/確認/編集）。画面ごとにURLを持つ。
  if (/\/admin(\/rules(\/.*)?)?$/.test(path)) return <Admin />
  return <Participant />
}
