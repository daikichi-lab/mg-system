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

export const api = {
  join: (org: string, name: string, president: string) =>
    jf<ApiState>('/api/company/join', jsonPost({ org, name, president })),
  get: (org: string, name: string) =>
    jf<ApiState>(`/api/company?org=${encodeURIComponent(org)}&name=${encodeURIComponent(name)}`),
  save: (id: number, payload: unknown) =>
    jf<ApiState>(`/api/company/${id}/state`, { ...jsonPost(payload), method: 'PUT' }),
  org: (code: string) =>
    jf<{ org: string; companies: ApiOrgCompany[] }>(`/api/org/${encodeURIComponent(code)}`),
  adminLogin: (password: string) => jf<{ token: string }>('/api/admin/login', jsonPost({ password })),
  adminOrgs: (token: string) =>
    jf<{ orgs: string[] }>('/api/admin/orgs', { headers: { Authorization: `Bearer ${token}` } }),
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
}
