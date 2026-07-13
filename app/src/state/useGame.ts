import { useCallback, useEffect, useRef, useState } from 'react'
import { newState, recompute, settleBlockReason, type St, type Result } from '../lib/calc'
import { api, type ApiOrgCompany } from '../lib/api'
import {
  applyApiState,
  payloadFromState,
  startCompany,
  recordAction,
  eventFvals,
  deleteRow,
  editActionRow,
  editAmountRow,
  revalidateLedger,
  clearLedger,
  doClosing,
  undoClosing,
  doSettle,
  undoSettle,
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
  act: (key: string, fvals: Record<string, any>) => string[]
  actEvent: (key: string, extra?: Record<string, any>) => string[]
  del: (id: number) => void
  editAction: (id: number, fvals: Record<string, any>) => string[]
  editAmount: (id: number, amount: number) => string | null
  clear: () => void
  seedFlood: () => string | null
  closing: () => void
  undoClose: () => void
  settleNow: () => Result | null
  unsettle: () => string | null
  next: () => void
  raiseCapital: (amount: number) => string | null
  setInstr: (loanMult: number, repayRate: number) => string | null
  setBoard: (b: { mfg: number; sales: number; mat: number; prod: number; dev: number; ads: number; mach: number }) => string | null
  refreshOrg: () => Promise<ApiOrgCompany[]>
  resetAll: () => void
  spectator: boolean
  instructorEdit: boolean
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
  const [spectator, setSpectator] = useState(false)
  const [instructorEdit, setInstructorEdit] = useState(false)
  const spectatorRef = useRef(false)
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
      // 講師ビュー（?vorg=&vco=）：その会社の状態をDBから読み込む。
      // 既定は閲覧専用、&vedit=1 なら講師編集モード（操作・保存を許可し、参加者のデータを直接修正できる）
      const vorg = (q.get('vorg') || '').trim()
      const vco = (q.get('vco') || '').trim()
      if (vorg && vco) {
        const vedit = q.get('vedit') === '1'
        try {
          const data = await api.get(vorg, vco)
          if (!alive) return
          idRef.current = data.company.id
          histRef.current = applyApiState(stRef.current, data)
          spectatorRef.current = !vedit
          setSpectator(!vedit)
          setInstructorEdit(vedit)
        } catch {
          if (alive) setOrgError('この参加者のデータが見つかりません。')
        }
        if (alive) {
          setReady(true)
          bump()
        }
        return
      }
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
      if (spectatorRef.current) return null // 閲覧専用ビューでは変更しない
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

  // 記帳系はバリデーションエラーを全件返す（モーダル内に表示する）。エラー時は保存しない。
  const runMutErrs = useCallback(
    (fn: () => string[]): string[] => {
      if (spectatorRef.current) return []
      const errs = fn()
      if (errs.length) return errs
      setError(null)
      bump()
      void sync()
      return []
    },
    [bump, sync],
  )

  const act = useCallback(
    (key: string, fvals: Record<string, any>) => runMutErrs(() => recordAction(stRef.current, key, fvals)),
    [runMutErrs],
  )
  const actEvent = useCallback(
    (key: string, extra: Record<string, any> = {}) =>
      runMutErrs(() => recordAction(stRef.current, key, { ...eventFvals(stRef.current, key), ...extra })),
    [runMutErrs],
  )
  const del = useCallback((id: number) => runMut(() => deleteRow(stRef.current, id)), [runMut])
  const editAction = useCallback(
    (id: number, fvals: Record<string, any>) => runMutErrs(() => editActionRow(stRef.current, id, fvals)),
    [runMutErrs],
  )
  const editAmount = useCallback(
    (id: number, amount: number) => runMut(() => editAmountRow(stRef.current, id, amount)),
    [runMut],
  )
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
    if (spectatorRef.current) return null
    // 在庫の個数がマイナス／盤面と不一致のまま決算するとB/Sが壊れるため、決算前にブロックする
    const reason = settleBlockReason(stRef.current)
    if (reason) {
      setError(reason)
      bump()
      return null
    }
    const r = doSettle(stRef.current, histRef.current)
    setError(null)
    bump()
    void sync()
    return r
  }, [bump, sync])
  // 決算の取り消し（次の期へ進む前のみ）：決算書・当期成績を破棄して記帳へ戻す
  const unsettle = useCallback(
    (): string | null => runMut(() => undoSettle(stRef.current, histRef.current)),
    [runMut],
  )
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
  // 講師設定：借入倍率・期末返済率（倍率を下げると既存の借入が枠を超えることがあるため再検証）
  const setInstr = useCallback(
    (loanMult: number, repayRate: number) =>
      runMut(() => {
        const st = stRef.current
        const prev = { loanMult: st.loanMult, repayRate: st.repayRate }
        st.loanMult = Math.max(0, Math.round(loanMult) || 0)
        st.repayRate = Math.min(100, Math.max(0, Math.round(repayRate) || 0))
        const errs = revalidateLedger(st)
        if (errs.length) {
          st.loanMult = prev.loanMult
          st.repayRate = prev.repayRate
          recompute(st)
          return `この設定に変更すると既存の記帳が成立しません。（${errs[0]}）`
        }
      }),
    [runMut],
  )
  // 盤面セットアップの変更：資産価値の増減は利益剰余金で吸収しB/S均衡を保つ。
  // 期首在庫を減らす等で既存の記帳（販売・製造）が成立しなくなる場合は取り消す。
  const setBoard = useCallback(
    (b: { mfg: number; sales: number; mat: number; prod: number; dev: number; ads: number; mach: number }): string | null =>
      runMut(() => {
        const st = stRef.current
        if (st.settled) return 'この期は決算済みです。次の期へ進んでから変更してください。'
        const prev = {
          retained: st.retained,
          staffMfg: st.openingStaffMfg,
          staffSales: st.openingStaffSales,
          dev: st.openingDev,
          ads: st.openingAds,
          machines: st.openingMachines,
          equipVal: st.openingEquipVal,
          products: st.openingProducts,
          matQty: st.openingMatQty,
          matVal: st.openingMatVal,
        }
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
        const errs = revalidateLedger(st)
        if (errs.length) {
          st.retained = prev.retained
          st.openingStaffMfg = prev.staffMfg
          st.openingStaffSales = prev.staffSales
          st.openingDev = prev.dev
          st.openingAds = prev.ads
          st.openingMachines = prev.machines
          st.openingEquipVal = prev.equipVal
          st.openingProducts = prev.products
          st.openingMatQty = prev.matQty
          st.openingMatVal = prev.matVal
          recompute(st)
          return `この盤面に変更すると既存の記帳が成立しません。（${errs[0]}）`
        }
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
    editAction,
    editAmount,
    clear,
    seedFlood: runSeedFlood,
    closing,
    undoClose,
    settleNow,
    unsettle,
    next,
    raiseCapital,
    setInstr,
    setBoard,
    refreshOrg,
    resetAll,
    spectator,
    instructorEdit,
  }
}
