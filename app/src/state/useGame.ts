import { useCallback, useEffect, useRef, useState } from 'react'
import { newState, type St, type Result } from '../lib/calc'
import { api, type ApiOrgCompany } from '../lib/api'
import {
  applyApiState,
  payloadFromState,
  startCompany,
  recordAction,
  eventFvals,
  deleteRow,
  clearLedger,
  doClosing,
  undoClosing,
  doSettle,
  goNext,
} from '../lib/game'

const IDENT_KEY = 'mgIdentity'

export interface Game {
  ready: boolean
  st: St
  history: Result[]
  companyId: number | null
  version: number
  error: string | null
  resumed: boolean
  setError: (e: string | null) => void
  joinOrg: string
  start: (name: string, president: string, org: string, capital: number) => Promise<void>
  act: (key: string, fvals: Record<string, any>) => string | null
  actEvent: (key: string, extra?: Record<string, any>) => string | null
  del: (id: number) => void
  clear: () => void
  closing: () => void
  undoClose: () => void
  settleNow: () => Result | null
  next: () => void
  refreshOrg: () => Promise<ApiOrgCompany[]>
  resetAll: () => void
}

export function useGame(): Game {
  const stRef = useRef<St>(newState())
  const histRef = useRef<Result[]>([])
  const idRef = useRef<number | null>(null)
  const [version, setVersion] = useState(0)
  const [ready, setReady] = useState(false)
  const [resumed, setResumed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const joinOrgRef = useRef('')
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const sync = useCallback(async () => {
    if (idRef.current == null) return
    try {
      await api.save(idRef.current, payloadFromState(stRef.current, histRef.current))
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  // 初期ロード：識別情報があれば DB から復元（リロード復旧）
  useEffect(() => {
    let alive = true
    ;(async () => {
      const q = new URLSearchParams(location.search)
      const joinOrg = (q.get('org') || '').trim()
      joinOrgRef.current = joinOrg
      let ident: any = null
      try {
        ident = JSON.parse(localStorage.getItem(IDENT_KEY) || 'null')
      } catch {
        /* ignore */
      }
      if (ident && ident.name && (!joinOrg || ident.org === joinOrg)) {
        try {
          const data = await api.get(ident.org, ident.name)
          if (!alive) return
          idRef.current = data.company.id
          histRef.current = applyApiState(stRef.current, data)
          if (stRef.current.started) setResumed(true)
          setReady(true)
          bump()
          return
        } catch {
          /* not found → fresh */
        }
      }
      if (joinOrg) stRef.current.org = joinOrg
      if (alive) {
        setReady(true)
        bump()
      }
    })()
    return () => {
      alive = false
    }
  }, [bump])

  const start = useCallback(
    async (name: string, president: string, org: string, capital: number) => {
      try {
        const data = await api.join(org, name, president)
        idRef.current = data.company.id
        localStorage.setItem(IDENT_KEY, JSON.stringify({ org, name, companyId: data.company.id }))
        if (data.company.started) {
          // 既存データ → 復元
          histRef.current = applyApiState(stRef.current, data)
          setResumed(true)
        } else {
          applyApiState(stRef.current, data)
          startCompany(stRef.current, { name, president, org, capital })
          await sync()
        }
        setError(null)
        bump()
      } catch (e: any) {
        setError(e.message)
      }
    },
    [bump, sync],
  )

  const runMut = useCallback(
    (fn: () => string | null | void): string | null => {
      const r = fn()
      if (typeof r === 'string' && r) {
        setError(r)
        bump()
        return r
      }
      setError(null)
      bump()
      void sync()
      return null
    },
    [bump, sync],
  )

  const act = useCallback(
    (key: string, fvals: Record<string, any>) => runMut(() => recordAction(stRef.current, key, fvals)),
    [runMut],
  )
  const actEvent = useCallback(
    (key: string, extra: Record<string, any> = {}) =>
      runMut(() => recordAction(stRef.current, key, { ...eventFvals(stRef.current, key), ...extra })),
    [runMut],
  )
  const del = useCallback((id: number) => runMut(() => deleteRow(stRef.current, id)), [runMut])
  const clear = useCallback(() => runMut(() => clearLedger(stRef.current)), [runMut])
  const closing = useCallback(() => runMut(() => doClosing(stRef.current)), [runMut])
  const undoClose = useCallback(() => runMut(() => undoClosing(stRef.current)), [runMut])
  const settleNow = useCallback((): Result | null => {
    const r = doSettle(stRef.current, histRef.current)
    setError(null)
    bump()
    void sync()
    return r
  }, [bump, sync])
  const next = useCallback(() => runMut(() => goNext(stRef.current)), [runMut])

  const refreshOrg = useCallback(async (): Promise<ApiOrgCompany[]> => {
    if (!stRef.current.org) return []
    try {
      const data = await api.org(stRef.current.org)
      return data.companies
    } catch (e: any) {
      setError(e.message)
      return []
    }
  }, [])

  const resetAll = useCallback(() => {
    localStorage.removeItem(IDENT_KEY)
    location.href = joinOrgRef.current
      ? `/?org=${encodeURIComponent(joinOrgRef.current)}`
      : '/'
  }, [])

  return {
    ready,
    st: stRef.current,
    history: histRef.current,
    companyId: idRef.current,
    version,
    error,
    resumed,
    setError,
    joinOrg: joinOrgRef.current,
    start,
    act,
    actEvent,
    del,
    clear,
    closing,
    undoClose,
    settleNow,
    next,
    refreshOrg,
    resetAll,
  }
}
