// calc エンジンと API/UI の橋渡し：状態⇄API変換、記帳（バリデーション込み）、期末/決算/次期。
import {
  ACTIONS,
  caps,
  recompute,
  doClosingPrep,
  settle,
  nextPeriod,
  loanRoom,
  MAT_CAP,
  PROD_CAP,
  type St,
  type Result,
  type Fvals,
  type TxRow,
} from './calc'
import type { ApiState } from './api'

const OPENING_KEYS = [
  'openingCash',
  'openingCapital',
  'retained',
  'openingMatQty',
  'openingMatVal',
  'openingProducts',
  'openingEquipVal',
  'openingMachines',
  'openingStaffMfg',
  'openingStaffSales',
  'openingLoan',
  'openingDev',
  'openingAds',
  'loanMult',
  'repayRate',
] as const

export function payloadFromState(st: St, history: Result[]) {
  const opening: Record<string, number> = {}
  OPENING_KEYS.forEach((k) => (opening[k] = st[k] as number))
  return {
    president: st.president,
    period: st.period,
    started: st.started,
    settled: st.settled,
    opening,
    seq: st.seq,
    entries: st.tx.filter((t) => !t.isBorrowInterest), // 金利派生行は保存しない（recomputeで再生成）
    results: history,
  }
}

export function applyApiState(st: St, data: ApiState): Result[] {
  const c = data.company
  st.org = c.org
  st.name = c.name
  st.president = c.president
  st.period = c.period
  st.started = c.started
  st.settled = c.settled
  st.seq = c.seq || 1
  OPENING_KEYS.forEach((k) => {
    if (c.opening && c.opening[k] != null) (st as any)[k] = c.opening[k]
  })
  st.tx = (data.entries || []).map(
    (e: any): TxRow => ({
      id: e.txId ?? e.id,
      key: e.key,
      fvals: e.fvals || {},
      label: e.label,
      col: e.col === undefined ? null : e.col,
      amount: e.amount || 0,
      note: e.note,
      isCapital: e.isCapital,
      isClosing: e.isClosing,
      isOpeningTax: e.isOpeningTax,
      isOpeningInterest: e.isOpeningInterest,
      isAutoRepay: e.isAutoRepay,
    }),
  )
  recompute(st)
  st.closingPrep = st.tx.some((t) => t.isClosing) && !st.settled
  return (data.results || []) as Result[]
}

export function startCompany(
  st: St,
  opt: { name: string; president: string; org: string; capital: number; period?: number },
) {
  st.name = opt.name
  st.president = opt.president
  st.org = opt.org
  st.period = opt.period || 1
  const cap = opt.capital || 300
  const row = st.tx.find((t) => t.isCapital)
  if (row) row.amount = cap
  else st.tx.unshift({ id: st.seq++, label: '資本金', col: 0, amount: cap, isCapital: true })
  st.started = true
  recompute(st)
}

// ルールB は1ターンに1度まで（直近の A/イベント以降に B が無いこと）
function ruleBBlocked(st: St): boolean {
  for (let i = st.tx.length - 1; i >= 0; i--) {
    const t = st.tx[i]
    const a = t.key ? ACTIONS[t.key] : undefined
    if (!a) continue
    if (a.rule === 'A' || a.rule === 'X') return false
    if (a.rule === 'B') return true
  }
  return false
}

const rowsOf = (f: Fvals): Fvals[] => (f && f.items && f.items.length ? f.items : [{ qty: f?.qty, unit: f?.unit }])

// 記帳前バリデーション（calc-spec §12）。OK なら null、NG ならエラーメッセージ。
function validate(st: St, key: string, f: Fvals): string | null {
  const c = caps(st)
  switch (key) {
    case 'shiire': {
      const items = rowsOf(f)
      let q = 0
      for (const it of items) {
        if (!Number.isInteger(it.qty) || it.qty < 1) return '仕入個数は1以上の整数で入力してください'
        if (!Number.isInteger(it.unit) || it.unit < 0) return '単価は0以上の整数で入力してください'
        q += it.qty
      }
      if (st.rawCubes + q > MAT_CAP) return `材料在庫の上限${MAT_CAP}を超えます（現在 ${st.rawCubes}・追加 ${q}）`
      return null
    }
    case 'seizo': {
      if (st.machines <= 0) return '機械がありません（製造できません）'
      if (st.staffMfg <= 0) return '製造スタッフがいません'
      if (!Number.isInteger(f.qty) || f.qty < 1) return '製造個数は1以上で入力してください'
      if (f.qty > c.mfgCap) return `製造能力 ${c.mfgCap} を超えています`
      if (f.qty > st.rawCubes) return `材料が足りません（在庫 ${st.rawCubes}）`
      if (st.products + f.qty > PROD_CAP) return `店舗陳列の上限${PROD_CAP}を超えます`
      return null
    }
    case 'hanbai': {
      const items = rowsOf(f)
      let q = 0
      for (const it of items) {
        if (!Number.isInteger(it.qty) || it.qty < 1) return '販売個数は1以上で入力してください'
        if (!Number.isInteger(it.unit) || it.unit < 0) return '売価は0以上で入力してください'
        q += it.qty
      }
      if (q > c.salesCap) return `販売能力 ${c.salesCap} を超えています（合計 ${q}）`
      if (q > st.products) return `製品が足りません（在庫 ${st.products}）`
      return null
    }
    case 'kikai':
      if (!Number.isInteger(f.n) || f.n < 1) return '台数は1以上で入力してください'
      return null
    case 'saiyo':
      if ((f.mfg || 0) + (f.sales || 0) + (f.fail || 0) < 1) return '採用人数を入力してください'
      return null
    case 'koukoku':
    case 'kaihatsu':
      if (!Number.isInteger(f.n) || f.n < 1) return '枚数は1以上で入力してください'
      return null
    case 'hoken':
      if (!Number.isInteger(f.n) || f.n < 1) return '枚数は1以上で入力してください'
      return null
    case 'kyoiku':
      if (st.edu + (f.n || 0) > 1) return '教育チップは最大1枚までです'
      return null
    case 'haichi': {
      const n = f.n || 0
      if (n < 1) return '人数を入力してください'
      if (f.dir === 'sales->mfg' && n > st.staffSales) return '販売スタッフが足りません'
      if (f.dir !== 'sales->mfg' && n > st.staffMfg) return '製造スタッフが足りません'
      return null
    }
    case 'kariire':
      if (st.period <= 1) return '第1期は借入できません'
      if (!Number.isInteger(f.a) || f.a < 1) return '借入額を入力してください'
      if (f.a > loanRoom(st)) return `借入可能額（${loanRoom(st)}）を超えています`
      return null
    case 'hensai':
      if (!Number.isInteger(f.a) || f.a < 0) return '返済額は0以上で入力してください'
      if (f.a > st.loan) return `借入残高（${st.loan}）以上は返済できません`
      return null
    case 'kaihatsu_win':
      if ((f.qty || 0) > 0) {
        if (f.qty > 2 * st.dev) return `商品開発チップ1枚につき2個までです（枠 ${2 * st.dev}）`
        if (f.qty > c.salesCap) return `販売能力 ${c.salesCap} を超えています`
        if (f.qty > st.products) return `製品が足りません（在庫 ${st.products}）`
      }
      return null
    case 'dokusen':
      if ((f.qty || 0) > 0) {
        if (f.qty > 2 * st.staffSales) return `販売スタッフ1人につき2個までです`
        if (f.qty > st.products) return `製品が足りません（在庫 ${st.products}）`
      }
      return null
    case 'tokubai':
      if ((f.qty || 0) < 0) return '個数を確認してください'
      if (f.qty > 5) return '特別サービスは最大5個までです'
      if (st.rawCubes + (f.qty || 0) > MAT_CAP) return `材料在庫の上限${MAT_CAP}を超えます`
      return null
    case 'keiki':
      if (f.qty > 3) return '景気上昇は最大3個までです'
      if (st.rawCubes + (f.qty || 0) > MAT_CAP) return `材料在庫の上限${MAT_CAP}を超えます`
      return null
    case 'taishoku_mfg':
      if (st.staffMfg <= 0) return '退職できる製造スタッフがいません'
      return null
    case 'taishoku_sales':
      if (st.staffSales <= 0) return '退職できる販売スタッフがいません'
      return null
    default:
      return null
  }
}

function rownote(key: string, f: Fvals): string {
  const a = ACTIONS[key]
  if (key === 'shiire' || key === 'hanbai') return rowsOf(f).map((x) => `${x.qty}×${x.unit}`).join(' ＋ ')
  if (key === 'saiyo') return `製造${f.mfg || 0}・販売${f.sales || 0}${f.fail ? '・失敗' + f.fail : ''}`
  if (key === 'seizo') return `製品+${f.qty}`
  if (key === 'kaihatsu') return f.result === '失敗' ? '開発 失敗' : `開発+${f.n}`
  if (a && a.cat) return a.label
  return ''
}

// イベントの動的 fvals（在庫被害）を現在の盤面から算出
export function eventFvals(st: St, key: string): Fvals {
  if (key === 'suigai') {
    const discard = st.rawCubes
    const insuredUsed = st.insurance > 0 ? 1 : 0
    return { discard, insuredUsed, payout: insuredUsed ? discard * 10 : 0 }
  }
  if (key === 'ibutsu') {
    const discard = Math.min(2, st.products)
    const insuredUsed = st.insurance > 0 ? 1 : 0
    return { discard, insuredUsed, payout: insuredUsed ? discard * 10 : 0 }
  }
  return {}
}

// 記帳（成功で tx 追加＋recompute）。戻り値: エラーメッセージ or null。
export function recordAction(st: St, key: string, fvals: Fvals): string | null {
  const a = ACTIONS[key]
  if (!a) return '不明なアクションです'
  if (st.settled) return 'この期は決算済みです。決算書から次の期へ進んでください。'
  if (st.closingPrep) return '期末処理を計上済みです。「記帳に戻る」を押してください。'
  if (a.rule === 'B' && ruleBBlocked(st)) return 'ルールBは1ターンに1度までです（ルールA/イベントを挟んでください）。'
  const err = validate(st, key, fvals)
  if (err) return err
  st.tx.push({
    id: st.seq++,
    key,
    fvals,
    col: a.col,
    amount: a.amount(fvals) || 0,
    note: rownote(key, fvals),
    noCash: a.noCash,
  })
  recompute(st)
  return null
}

export function deleteRow(st: St, id: number) {
  const t = st.tx.find((x) => x.id === id)
  if (!t) return
  if (t.isClosing || t.isOpeningTax || t.isOpeningInterest || t.isBorrowInterest) return
  st.tx = st.tx.filter((x) => x.id !== id)
  recompute(st)
}

export function clearLedger(st: St) {
  st.tx = st.tx.filter((t) => t.isCapital || t.isOpeningTax || t.isOpeningInterest)
  st.closingPrep = false
  recompute(st)
}

export function doClosing(st: St) {
  doClosingPrep(st)
}
export function undoClosing(st: St) {
  st.tx = st.tx.filter((t) => !t.isClosing)
  st.closingPrep = false
  recompute(st)
}
export function doSettle(st: St, history: Result[]): Result | null {
  const r = settle(st)
  if (r) {
    const idx = history.findIndex((h) => h.period === r.period)
    if (idx >= 0) history[idx] = r
    else history.push(r)
  }
  return r
}
export function goNext(st: St) {
  nextPeriod(st)
}
