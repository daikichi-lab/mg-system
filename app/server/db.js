// 実DB層：Node 24 内蔵の node:sqlite（ファイル永続の本物のSQLite）。
// 会社(companies) / 記帳(entries) / 期別成績(period_results) を正規化して保存する。
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const DB_PATH = process.env.MG_DB || new URL('./data/mg.db', import.meta.url).pathname
mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')

db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL,
  name TEXT NOT NULL,
  president TEXT DEFAULT '',
  period INTEGER DEFAULT 1,
  started INTEGER DEFAULT 0,
  settled INTEGER DEFAULT 0,
  opening_json TEXT DEFAULT '{}',
  seq INTEGER DEFAULT 1,
  updated_at INTEGER DEFAULT 0,
  UNIQUE(org, name)
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  period INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  tx_id INTEGER,
  key TEXT,
  fvals_json TEXT DEFAULT '{}',
  label TEXT DEFAULT '',
  col INTEGER,
  amount REAL DEFAULT 0,
  note TEXT DEFAULT '',
  flags_json TEXT DEFAULT '{}',
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS period_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  period INTEGER NOT NULL,
  pq REAL, mpq REAL, f REAL, g REAL, net REAL,
  cap_end REAL, ret_end REAL, cash_end REAL,
  turns INTEGER, decisions INTEGER,
  result_json TEXT DEFAULT '{}',
  UNIQUE(company_id, period),
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);
`)

const now = () => Date.now()

// ---- 会社 ----
const stMap = (row) =>
  row && {
    id: row.id,
    org: row.org,
    name: row.name,
    president: row.president,
    period: row.period,
    started: !!row.started,
    settled: !!row.settled,
    opening: safeParse(row.opening_json, {}),
    seq: row.seq,
    updatedAt: row.updated_at,
  }

function safeParse(s, fallback) {
  try {
    return JSON.parse(s)
  } catch {
    return fallback
  }
}

export function getCompanyRow(org, name) {
  return db.prepare('SELECT * FROM companies WHERE org = ? AND name = ?').get(org, name)
}

export function joinCompany(org, name, president) {
  let row = getCompanyRow(org, name)
  if (!row) {
    db.prepare(
      'INSERT INTO companies (org, name, president, period, started, settled, opening_json, seq, updated_at) VALUES (?, ?, ?, 1, 0, 0, ?, 1, ?)',
    ).run(org, name, president || '', '{}', now())
    row = getCompanyRow(org, name)
  } else if (president && row.president !== president) {
    db.prepare('UPDATE companies SET president = ?, updated_at = ? WHERE id = ?').run(president, now(), row.id)
    row = getCompanyRow(org, name)
  }
  return fullState(row.id)
}

// 会社の全状態（スカラー＋当期の記帳＋全期の成績）を返す
export function fullState(companyId) {
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId)
  if (!row) return null
  const company = stMap(row)
  const entries = db
    .prepare('SELECT * FROM entries WHERE company_id = ? AND period = ? ORDER BY ord ASC')
    .all(companyId, row.period)
    .map(entryMap)
  const results = db
    .prepare('SELECT * FROM period_results WHERE company_id = ? ORDER BY period ASC')
    .all(companyId)
    .map((r) => safeParse(r.result_json, {}))
  return { company, entries, results }
}

const entryMap = (r) => ({
  id: r.id,
  txId: r.tx_id,
  key: r.key || undefined,
  fvals: safeParse(r.fvals_json, {}),
  label: r.label,
  col: r.col === null ? null : r.col,
  amount: r.amount,
  note: r.note,
  ...safeParse(r.flags_json, {}),
})

// 手動トランザクション（node:sqlite には better-sqlite3 の .transaction() が無い）
function tx(fn) {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

// クライアントの現在状態を丸ごと保存（正規化して entries / results に反映）
function saveTx(companyId, payload) {
  const period = payload.period
  db.prepare(
    'UPDATE companies SET president = ?, period = ?, started = ?, settled = ?, opening_json = ?, seq = ?, updated_at = ? WHERE id = ?',
  ).run(
    payload.president || '',
    period,
    payload.started ? 1 : 0,
    payload.settled ? 1 : 0,
    JSON.stringify(payload.opening || {}),
    payload.seq || 1,
    now(),
    companyId,
  )
  // 当期の記帳を入れ替え（過去期の記帳＝ledger履歴は保持）
  db.prepare('DELETE FROM entries WHERE company_id = ? AND period = ?').run(companyId, period)
  const ins = db.prepare(
    'INSERT INTO entries (company_id, period, ord, tx_id, key, fvals_json, label, col, amount, note, flags_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  ;(payload.entries || []).forEach((e, i) => {
    const { id, txId, key, fvals, label, col, amount, note, ...flags } = e
    ins.run(
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
    )
  })
  // 成績（settle済みの各期）を UPSERT
  const upR = db.prepare(
    `INSERT INTO period_results (company_id, period, pq, mpq, f, g, net, cap_end, ret_end, cash_end, turns, decisions, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_id, period) DO UPDATE SET
       pq=excluded.pq, mpq=excluded.mpq, f=excluded.f, g=excluded.g, net=excluded.net,
       cap_end=excluded.cap_end, ret_end=excluded.ret_end, cash_end=excluded.cash_end,
       turns=excluded.turns, decisions=excluded.decisions, result_json=excluded.result_json`,
  )
  ;(payload.results || []).forEach((r) => {
    upR.run(
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
    )
  })
}

const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Number(v))
const int = (v) => (v === null || v === undefined || Number.isNaN(v) ? 0 : Math.round(v))

export function saveState(companyId, payload) {
  tx(() => saveTx(companyId, payload))
  return fullState(companyId)
}

// ---- 組織（管理者・比較用）----
export function listOrg(code) {
  const companies = db.prepare('SELECT * FROM companies WHERE org = ? ORDER BY name ASC').all(code).map(stMap)
  return companies.map((c) => ({
    ...c,
    results: db
      .prepare('SELECT * FROM period_results WHERE company_id = ? ORDER BY period ASC')
      .all(c.id)
      .map((r) => safeParse(r.result_json, {})),
  }))
}

export function listOrgs() {
  return db.prepare('SELECT DISTINCT org FROM companies ORDER BY org ASC').all().map((r) => r.org)
}

export function deleteCompany(id) {
  db.prepare('DELETE FROM companies WHERE id = ?').run(id)
}

export function deleteOrg(code) {
  db.prepare('DELETE FROM companies WHERE org = ?').run(code)
}
