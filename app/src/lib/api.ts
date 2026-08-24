// バックエンド REST API クライアント（同一オリジン／dev は Vite が :3001 へプロキシ）
async function jf<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j && j.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

const jsonPost = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export interface ApiCompany {
  id: number
  org: string
  name: string
  president: string
  period: number
  started: boolean
  settled: boolean
  opening: Record<string, number>
  seq: number
  updatedAt: number
}
export interface ApiState {
  company: ApiCompany
  entries: any[]
  results: any[]
}
export interface ApiOrgCompany extends ApiCompany {
  results: any[]
}
/** 数値ルールのマスタ。name は重複可。isBuiltin は既定ルールで編集・削除できない */
export interface ApiRuleset {
  id: number
  name: string
  description: string
  isBuiltin: boolean
  rules: Record<string, unknown>
  createdAt: number
  updatedAt: number
}
/** 研修のステータス。講師が手動で切り替える */
export type OrgStatus = 'preparing' | 'running' | 'closed'

export const ORG_STATUS_LABEL: Record<OrgStatus, string> = {
  preparing: '準備中',
  running: '進行中',
  closed: '終了',
}

/** 研修（組織）。code が研修URLの元になる一意なコード、name は講師が付けた研修名（重複可） */
export interface ApiOrg {
  code: string
  name: string
  createdAt: number
  /** コピー元のルール名（表示用。マスタとは連動しない）。空なら入門編 標準 */
  rulesetName: string
  status: OrgStatus
}

export const api = {
  join: (org: string, name: string, president: string) =>
    jf<ApiState>('/api/company/join', jsonPost({ org, name, president })),
  get: (org: string, name: string) =>
    jf<ApiState>(`/api/company?org=${encodeURIComponent(org)}&name=${encodeURIComponent(name)}`),
  save: (id: number, payload: unknown) =>
    jf<ApiState>(`/api/company/${id}/state`, { ...jsonPost(payload), method: 'PUT' }),
  org: (code: string) =>
    jf<{ org: string; companies: ApiOrgCompany[] }>(`/api/org/${encodeURIComponent(code)}`),
  orgExists: (code: string) => jf<{ exists: boolean }>(`/api/org-exists?code=${encodeURIComponent(code)}`),
  // その研修の数値ルール（無認証）。参加者アプリが起動時に取得して setRules() する
  orgRules: (code: string) =>
    jf<{ rules: Record<string, unknown>; rulesetName: string; status: OrgStatus }>(
      `/api/org/${encodeURIComponent(code)}/rules`,
    ),
  adminLogin: (password: string) => jf<{ token: string }>('/api/admin/login', jsonPost({ password })),
  // 研修を開始（＝組織コードを発行）。研修名は重複可、組織コードは一意。
  adminCreateOrg: (token: string, code: string, name: string, rulesetId?: number) =>
    jf<{ ok: boolean; org: ApiOrg }>('/api/admin/org', {
      ...jsonPost({ code, name, rulesetId }),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    }),
  // 研修名・研修URL（組織コード）の変更
  adminUpdateOrg: (
    token: string,
    code: string,
    body: { name?: string; newCode?: string; status?: OrgStatus; rulesetId?: number },
  ) =>
    jf<{ ok: boolean; org: ApiOrg }>(`/api/admin/org/${encodeURIComponent(code)}`, {
      ...jsonPost(body),
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    }),
  adminOrgs: (token: string) =>
    jf<{ orgs: ApiOrg[] }>('/api/admin/orgs', { headers: { Authorization: `Bearer ${token}` } }),
  // ---- 数値ルールのマスタ ----
  adminRulesets: (token: string) =>
    jf<{ rulesets: ApiRuleset[] }>('/api/admin/rulesets', { headers: { Authorization: `Bearer ${token}` } }),
  adminRuleset: (token: string, id: number) =>
    jf<{ ruleset: ApiRuleset }>(`/api/admin/rulesets/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
  adminCreateRuleset: (token: string, body: { name: string; description: string; rules: unknown }) =>
    jf<{ ok: boolean; ruleset: ApiRuleset }>('/api/admin/rulesets', {
      ...jsonPost(body),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    }),
  adminUpdateRuleset: (token: string, id: number, body: { name: string; description: string; rules: unknown }) =>
    jf<{ ok: boolean; ruleset: ApiRuleset }>(`/api/admin/rulesets/${id}`, {
      ...jsonPost(body),
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    }),
  adminDeleteRuleset: (token: string, id: number) =>
    jf<{ ok: boolean }>(`/api/admin/rulesets/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),
  adminDeleteCompany: (token: string, id: number) =>
    jf<{ ok: boolean }>(`/api/admin/company/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),
  adminDeleteOrg: (token: string, code: string) =>
    jf<{ ok: boolean }>(`/api/admin/org/${encodeURIComponent(code)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),
  // 組織自体を削除（登録＋データ）＝以後このURLでは参加できない
  adminRemoveOrg: (token: string, code: string) =>
    jf<{ ok: boolean }>(`/api/admin/org/${encodeURIComponent(code)}?full=1`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),
}
