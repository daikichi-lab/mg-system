// 本番サーバ：REST API（node:sqlite 実DB）＋ ビルド済みフロント(dist)配信。
import express from 'express'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  joinCompany,
  getCompanyRow,
  fullState,
  saveState,
  listOrg,
  listOrgs,
  deleteCompany,
  deleteOrg,
} from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '2mb' }))

const ADMIN_PASSWORD = process.env.MG_ADMIN_PW || 'mg'
const tokens = new Set()
function makeToken() {
  // 認証トークンは暗号論的乱数（256bit）で予測不可能にする
  const t = 'adm_' + randomBytes(32).toString('base64url')
  tokens.add(t)
  return t
}
function requireAdmin(req, res, next) {
  const h = req.headers.authorization || ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (tokens.has(t)) return next()
  res.status(401).json({ error: 'unauthorized' })
}

const wrap = (fn) => (req, res) => {
  try {
    fn(req, res)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String((e && e.message) || e) })
  }
}

// ---- 参加者（ログイン不要）----
app.post(
  '/api/company/join',
  wrap((req, res) => {
    const { org, name, president } = req.body || {}
    if (!org || !name) return res.status(400).json({ error: 'org と name は必須です' })
    res.json(joinCompany(String(org).trim(), String(name).trim(), String(president || '').trim()))
  }),
)

app.get(
  '/api/company',
  wrap((req, res) => {
    const { org, name } = req.query
    if (!org || !name) return res.status(400).json({ error: 'org と name は必須です' })
    const row = getCompanyRow(String(org).trim(), String(name).trim())
    if (!row) return res.status(404).json({ error: 'not found' })
    res.json(fullState(row.id))
  }),
)

app.put(
  '/api/company/:id/state',
  wrap((req, res) => {
    const id = Number(req.params.id)
    const row = fullState(id)
    if (!row) return res.status(404).json({ error: 'not found' })
    res.json(saveState(id, req.body || {}))
  }),
)

// 組織比較（参加者の「組織」タブ・管理者の両方が使用）
app.get(
  '/api/org/:code',
  wrap((req, res) => {
    res.json({ org: req.params.code, companies: listOrg(req.params.code) })
  }),
)

// ---- 管理者（ログイン必須）----
app.post(
  '/api/admin/login',
  wrap((req, res) => {
    const { password } = req.body || {}
    if (password === ADMIN_PASSWORD) return res.json({ token: makeToken() })
    res.status(401).json({ error: 'パスワードが違います' })
  }),
)

app.get(
  '/api/admin/orgs',
  requireAdmin,
  wrap((_req, res) => {
    res.json({ orgs: listOrgs() })
  }),
)

app.delete(
  '/api/admin/company/:id',
  requireAdmin,
  wrap((req, res) => {
    deleteCompany(Number(req.params.id))
    res.json({ ok: true })
  }),
)

app.delete(
  '/api/admin/org/:code',
  requireAdmin,
  wrap((req, res) => {
    deleteOrg(req.params.code)
    res.json({ ok: true })
  }),
)

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// ---- 静的配信（ビルド済みフロント）----
const dist = join(__dirname, '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  // SPA フォールバック（/api 以外の GET は index.html）
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
    res.sendFile(join(dist, 'index.html'))
  })
}

const PORT = Number(process.env.PORT || 3001)
app.listen(PORT, () => {
  console.log(`MG server on http://localhost:${PORT}`)
})
