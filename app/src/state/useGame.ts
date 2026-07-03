import { useCallback, useEffect, useRef, useState } from 'react'
import { newState, recompute, type St, type Result } from '../lib/calc'
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
  seedFlood,
} from '../lib/game'

const IDENT_KEY = 'mgIdentity'

export interface Game {
  ready: boolean
  st: St
  history: Result[]
  companyId: number | null
  version: number
  error: string | null
  orgError: string | null
  resumed: boolean
  setError: (e: string | null) => void
  joinOrg: string
  start: (name: string, president: string, org: string, capital: number) => Promise<void>
  act: (key: string, fvals: Record<string, any>) => string | null
  actEvent: (key: string, extra?: Record<string, any>) => string | null
  del: (id: number) => void
  clear: () => void
  seedFlood: () => string | null
  closing: () => void
  undoClose: () => void
  settleNow: () => Result | null
  next: () => void
  raiseCapital: (amount: number) => string | null
  setInstr: (loanMult: number, repayRate: number) => string | null
  setBoard: (b: { mfg: number; sales: number; mat: number; prod: number; dev: number; ads: number; mach: number }) => string | null
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
  const [orgError, setOrgError] = useState<string | null>(null)
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
      // 新規参加：講師が発行したURL(?org=)で、かつ登録済みの組織のみ開始できる
      if (joinOrg) {
        stRef.current.org = joinOrg
        try {
          const r = await api.orgExists(joinOrg)
          if (!alive) return
          if (!r.exists) setOrgError('組織コードが見つかりません。講師が発行したURLからご参加ください。')
        } catch {
          /* ネットワーク不通時は開始で再検証 */
        }
      } else {
        setOrgError('この画面は講師が発行した参加用URLからのみ開けます。')
      }
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
        if (String(e.message).includes('組織')) setOrgError(e.message)
        else setError(e.message)
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
  const runSeedFlood = useCallback(
    () =>
      runMut(() => {
        const st = stRef.current
        if (st.settled || st.closingPrep) return '記帳できる状態ではありません。'
        if (st.period !== 1) return '水害テストデータは第1期のみ投入できます。'
        seedFlood(st)
      }),
    [runMut],
  )
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

  // 増資（第2期以降・任意）：資本金(ア col0)として記帳→現金と純資産が増える
  const raiseCapital = useCallback(
    (amount: number): string | null =>
      runMut(() => {
        const st = stRef.current
        if (st.settled) return 'この期は決算済みです。次の期へ進んでから増資してください。'
        if (!(amount > 0)) return '増資額を入力してください。'
        st.tx.push({ id: st.seq++, label: '増資', col: 0, amount })
        recompute(st)
      }),
    [runMut],
  )
  // 講師設定：借入倍率・期末返済率
  const setInstr = useCallback(
    (loanMult: number, repayRate: number) =>
      runMut(() => {
        const st = stRef.current
        st.loanMult = Math.max(0, Math.round(loanMult) || 0)
        st.repayRate = Math.min(100, Math.max(0, Math.round(repayRate) || 0))
        recompute(st)
      }),
    [runMut],
  )
  // 盤面セットアップの変更：資産価値の増減は利益剰余金で吸収しB/S均衡を保つ
  const setBoard = useCallback(
    (b: { mfg: number; sales: number; mat: number; prod: number; dev: number; ads: number; mach: number }): string | null =>
      runMut(() => {
        const st = stRef.current
        if (st.settled) return 'この期は決算済みです。次の期へ進んでから変更してください。'
        const unit = st.openingMatQty > 0 ? st.openingMatVal / st.openingMatQty : 12
        const perMach = st.openingMachines > 0 ? st.openingEquipVal / st.openingMachines : 100
        const newMatQty = b.mat + b.prod
        const newMatVal = Math.round(unit * newMatQty)
        const newEquipVal = Math.round(perMach * b.mach)
        st.retained += newMatVal - st.openingMatVal + (newEquipVal - st.openingEquipVal)
        st.openingStaffMfg = b.mfg
        st.openingStaffSales = b.sales
        st.openingDev = b.dev
        st.openingAds = b.ads
        st.openingMachines = b.mach
        st.openingEquipVal = newEquipVal
        st.openingProducts = b.prod
        st.openingMatQty = newMatQty
        st.openingMatVal = newMatVal
        recompute(st)
      }),
    [runMut],
  )

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
    orgError,
    resumed,
    setError,
    joinOrg: joinOrgRef.current,
    start,
    act,
    actEvent,
    del,
    clear,
    seedFlood: runSeedFlood,
    closing,
    undoClose,
    settleNow,
    next,
    raiseCapital,
    setInstr,
    setBoard,
    refreshOrg,
    resetAll,
  }
}
