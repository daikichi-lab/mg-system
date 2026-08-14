import Participant from './ui/Participant'
import Admin from './ui/Admin'
import AdminSession from './ui/AdminSession'

export default function App() {
  const path = location.pathname.replace(/\/+$/, '')
  // 研修1件の管理画面（研修一覧から別タブで開く）
  if (path.endsWith('/admin/session')) {
    return <AdminSession org={(new URLSearchParams(location.search).get('org') || '').trim()} />
  }
  if (path.endsWith('/admin')) return <Admin />
  return <Participant />
}
