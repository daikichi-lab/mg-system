// 実DB層（二刀流）。
//  - 既定: Node 24 内蔵 node:sqlite（ローカル開発/E2E・追加インフラ不要）
//  - DATABASE_URL があれば PostgreSQL（pg）を使用（本番・Supabase等の無料枠でも可）
// クエリ文字列は `?` プレースホルダで共通化し、pg ドライバ側で $1.. へ変換する。
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// ---- スキーマ（DDLはドライバごと。autoincrement 構文が異なる）----
const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL, name TEXT NOT NULL, president TEXT DEFAULT '',
  period INTEGER DEFAULT 1, started INTEGER DEFAULT 0, settled INTEGER DEFAULT 0,
  opening_json TEXT DEFAULT '{}', seq INTEGER DEFAULT 1, updated_at INTEGER DEFAULT 0,
  UNIQUE(org, name)
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL, period INTEGER NOT NULL, ord INTEGER NOT NULL,
  tx_id INTEGER, key TEXT, fvals_json TEXT DEFAULT '{}', label TEXT DEFAULT '',
  col INTEGER, amount REAL DEFAULT 0, note TEXT DEFAULT '', flags_json TEXT DEFAULT '{}',
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS period_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL, period INTEGER NOT NULL,
  pq REAL, mpq REAL, f REAL, g REAL, net REAL, cap_end REAL, ret_end REAL, cash_end REAL,
  turns INTEGER, decisions INTEGER, result_json TEXT DEFAULT '{}',
  UNIQUE(company_id, period),
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS orgs (code TEXT PRIMARY KEY, created_at INTEGER DEFAULT 0);`

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org TEXT NOT NULL, name TEXT NOT NULL, president TEXT DEFAULT '',
  period INTEGER DEFAULT 1, started INTEGER DEFAULT 0, settled INTEGER DEFAULT 0,
  opening_json TEXT DEFAULT '{}', seq INTEGER DEFAULT 1, updated_at BIGINT DEFAULT 0,
  UNIQUE(org, name)
);
CREATE TABLE IF NOT EXISTS entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period INTEGER NOT NULL, ord INTEGER NOT NULL,
  tx_id BIGINT, key TEXT, fvals_json TEXT DEFAULT '{}', label TEXT DEFAULT '',
  col INTEGER, amount DOUBLE PRECISION DEFAULT 0, note TEXT DEFAULT '', flags_json TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS period_results (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period INTEGER NOT NULL,
  pq DOUBLE PRECISION, mpq DOUBLE PRECISION, f DOUBLE PRECISION, g DOUBLE PRECISION,
  net DOUBLE PRECISION, cap_end DOUBLE PRECISION, ret_end DOUBLE PRECISION, cash_end DOUBLE PRECISION,
  turns INTEGER, decisions INTEGER, result_json TEXT DEFAULT '{}',
  UNIQUE(company_id, period)
);
CREATE TABLE IF NOT EXISTS orgs (code TEXT PRIMARY KEY, created_at BIGINT DEFAULT 0);`

// `?` → `$1,$2,...`（Postgres系）
export function pgConv(sql) {
  let i = 0
  return sql.replace(/\?/g, () => '$' + ++i)
}

// ---- ドライバ ----
async function makeSqlite() {
  // node:sqlite は sqlite使用時のみ動的読込（Postgres運用時はNodeのsqlite対応に依存しない）
  const { DatabaseSync } = await import('node:sqlite')
  const path = process.env.MG_DB || new URL('./data/mg.db', import.meta.url).pathname
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SQLITE_SCHEMA)
  const base = {
    all: async (s, p = []) => db.prepare(s).all(...p),
    get: async (s, p = []) => db.prepare(s).get(...p),
    run: async (s, p = []) => {
      db.prepare(s).run(...p)
    },
  }
  return {
    ...base,
    tx: async (fn) => {
      db.exec('BEGIN')
      try {
        const r = await fn(base)
        db.exec('COMMIT')
        return r
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}

// TLS設定：既定で証明書検証あり（MITM対策）。ローカルは非TLS。
// 特定CAが必要なら MG_PG_CA にPEMを設定。検証無効化は dev 限定で MG_PG_INSECURE=1 を明示した場合のみ。
function pgSsl(connectionString) {
  if (/localhost|127\.0\.0\.1/.test(connectionString)) return false
  if (process.env.MG_PG_CA) return { ca: process.env.MG_PG_CA }
  if (process.env.MG_PG_INSECURE === '1') {
    console.warn('[WARN] MG_PG_INSECURE=1: TLS証明書の検証を無効化しています（開発用途のみ）')
    return { rejectUnauthorized: false }
  }
  return true // 既定：システムCAで検証
}

async function makePg(connectionString) {
  const pg = await import('pg')
  const Pool = pg.default?.Pool || pg.Pool
  const pool = new Pool({ connectionString, ssl: pgSsl(connectionString), max: 5 })
  await pool.query(PG_SCHEMA)
  const clientOps = (c) => ({
    all: async (s, p = []) => (await c.query(pgConv(s), p)).rows,
    get: async (s, p = []) => (await c.query(pgConv(s), p)).rows[0],
    run: async (s, p = []) => {
      await c.query(pgConv(s), p)
    },
  })
  return {
    ...clientOps(pool),
    tx: async (fn) => {
      const c = await pool.connect()
      try {
        await c.query('BEGIN')
        const r = await fn(clientOps(c))
        await c.query('COMMIT')
        return r
      } catch (e) {
        await c.query('ROLLBACK')
        throw e
      } finally {
        c.release()
      }
    },
  }
}

// pglite（WASM版Postgres）でPG方言を検証するためのドライバ（テスト用）
export async function makePgliteDriver(pglite) {
  await pglite.exec(PG_SCHEMA) // 複数文はquery不可・execで実行
  const ops = {
    all: async (s, p = []) => (await pglite.query(pgConv(s), p)).rows,
    get: async (s, p = []) => (await pglite.query(pgConv(s), p)).rows[0],
    run: async (s, p = []) => {
      await pglite.query(pgConv(s), p)
    },
  }
  return {
    ...ops,
    tx: async (fn) => {
      await pglite.query('BEGIN')
      try {
        const r = await fn(ops)
        await pglite.query('COMMIT')
        return r
      } catch (e) {
        await pglite.query('ROLLBACK')
        throw e
      }
    },
  }
}

let D = null
export async function initDb(override) {
  if (override) {
    D = override
    return D
  }
  if (D) return D
  D = process.env.DATABASE_URL ? await makePg(process.env.DATABASE_URL) : await makeSqlite()
  return D
}

// ---- 変換ヘルパ ----
function safeParse(s, fallback) {
  try {
    return JSON.parse(s)
  } catch {
    return fallback
  }
}
const stMap = (row) =>
  row && {
    id: Number(row.id),
    org: row.org,
    name: row.name,
    president: row.president,
    period: row.period,
    started: !!row.started,
    settled: !!row.settled,
    opening: safeParse(row.opening_json, {}),
    seq: row.seq,
    updatedAt: Number(row.updated_at),
  }
const entryMap = (r) => ({
  id: Number(r.id),
  txId: r.tx_id === null || r.tx_id === undefined ? undefined : Number(r.tx_id),
  key: r.key || undefined,
  fvals: safeParse(r.fvals_json, {}),
  label: r.label,
  col: r.col === null || r.col === undefined ? null : r.col,
  amount: r.amount,
  note: r.note,
  ...safeParse(r.flags_json, {}),
})
const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Number(v))
const int = (v) => (v === null || v === undefined || Number.isNaN(v) ? 0 : Math.round(v))
const now = () => Date.now()

// ---- 会社 ----
export async function getCompanyRow(org, name) {
  return D.get('SELECT * FROM companies WHERE org = ? AND name = ?', [org, name])
}

export async function joinCompany(org, name, president) {
  let row = await getCompanyRow(org, name)
  if (!row) {
    await D.run(
      'INSERT INTO companies (org, name, president, period, started, settled, opening_json, seq, updated_at) VALUES (?, ?, ?, 1, 0, 0, ?, 1, ?)',
      [org, name, president || '', '{}', now()],
    )
    row = await getCompanyRow(org, name)
  } else if (president && row.president !== president) {
    await D.run('UPDATE companies SET president = ?, updated_at = ? WHERE id = ?', [president, now(), row.id])
    row = await getCompanyRow(org, name)
  }
  return fullState(Number(row.id))
}

export async function fullState(companyId) {
  const row = await D.get('SELECT * FROM companies WHERE id = ?', [companyId])
  if (!row) return null
  const entries = (
    await D.all('SELECT * FROM entries WHERE company_id = ? AND period = ? ORDER BY ord ASC', [companyId, row.period])
  ).map(entryMap)
  const results = (
    await D.all('SELECT result_json FROM period_results WHERE company_id = ? ORDER BY period ASC', [companyId])
  ).map((r) => safeParse(r.result_json, {}))
  return { company: stMap(row), entries, results }
}

export async function saveState(companyId, payload) {
  const period = payload.period
  await D.tx(async (q) => {
    await q.run(
      'UPDATE companies SET president = ?, period = ?, started = ?, settled = ?, opening_json = ?, seq = ?, updated_at = ? WHERE id = ?',
      [
        payload.president || '',
        period,
        payload.started ? 1 : 0,
        payload.settled ? 1 : 0,
        JSON.stringify(payload.opening || {}),
        payload.seq || 1,
        now(),
        companyId,
      ],
    )
    await q.run('DELETE FROM entries WHERE company_id = ? AND period = ?', [companyId, period])
    const list = payload.entries || []
    for (let i = 0; i < list.length; i++) {
      const { id, txId, key, fvals, label, col, amount, note, ...flags } = list[i]
      await q.run(
        'INSERT INTO entries (company_id, period, ord, tx_id, key, fvals_json, label, col, amount, note, flags_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          companyId,
          period,
          i,
          txId ?? id ?? null,
          key ?? null,
          JSON.stringify(fvals || {}),
          label || '',
          col === null || col === undefined ? null : col,
          amount || 0,
          note || '',
          JSON.stringify(flags || {}),
        ],
      )
    }
    for (const r of payload.results || []) {
      await q.run(
        `INSERT INTO period_results (company_id, period, pq, mpq, f, g, net, cap_end, ret_end, cash_end, turns, decisions, result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (company_id, period) DO UPDATE SET
           pq=excluded.pq, mpq=excluded.mpq, f=excluded.f, g=excluded.g, net=excluded.net,
           cap_end=excluded.cap_end, ret_end=excluded.ret_end, cash_end=excluded.cash_end,
           turns=excluded.turns, decisions=excluded.decisions, result_json=excluded.result_json`,
        [
          companyId,
          r.period,
          num(r.PQ),
          num(r.mPQ),
          num(r.F),
          num(r.G),
          num(r.net),
          num(r.capEnd),
          num(r.retEnd),
          num(r.cashEnd),
          int(r.turns),
          int(r.decisions),
          JSON.stringify(r),
        ],
      )
    }
  })
  return fullState(companyId)
}

// ---- 組織（比較・管理者）----
export async function listOrg(code) {
  const companies = (await D.all('SELECT * FROM companies WHERE org = ? ORDER BY name ASC', [code])).map(stMap)
  const out = []
  for (const c of companies) {
    const results = (
      await D.all('SELECT result_json FROM period_results WHERE company_id = ? ORDER BY period ASC', [c.id])
    ).map((r) => safeParse(r.result_json, {}))
    out.push({ ...c, results })
  }
  return out
}

// 組織コード一覧を作成日時の新しい順（最新が先頭）で返す。
// 登録(orgs)は created_at、会社のみ存在する組織は最初の会社更新時刻で代替。
export async function listOrgs() {
  const ts = new Map()
  for (const r of await D.all('SELECT code AS org, created_at FROM orgs', [])) {
    ts.set(r.org, Number(r.created_at) || 0)
  }
  for (const r of await D.all('SELECT org, MIN(updated_at) AS t FROM companies GROUP BY org', [])) {
    if (!ts.has(r.org)) ts.set(r.org, Number(r.t) || 0)
  }
  return [...ts.keys()].sort((x, y) => ts.get(y) - ts.get(x) || (x < y ? 1 : x > y ? -1 : 0))
}

// ---- 組織コードの登録（講師が発行）／存在チェック ----
export async function registerOrg(code) {
  await D.run('INSERT INTO orgs (code, created_at) VALUES (?, ?) ON CONFLICT (code) DO NOTHING', [code, now()])
}
export async function orgExists(code) {
  const r = await D.get('SELECT code FROM orgs WHERE code = ?', [code])
  return !!r
}

export async function deleteCompany(id) {
  await D.run('DELETE FROM companies WHERE id = ?', [id])
}

export async function deleteOrg(code) {
  await D.run('DELETE FROM companies WHERE org = ?', [code])
}

// 組織自体を削除：参加者データ＋組織コードの登録を消す（以後このURLでは参加できない）
export async function removeOrg(code) {
  await D.run('DELETE FROM companies WHERE org = ?', [code])
  await D.run('DELETE FROM orgs WHERE code = ?', [code])
}
