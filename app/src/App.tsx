import Participant from './ui/Participant'
import Admin from './ui/Admin'

export default function App() {
  const path = location.pathname.replace(/\/+$/, '')
  const isAdmin = path.endsWith('/admin')
  return isAdmin ? <Admin /> : <Participant />
}
