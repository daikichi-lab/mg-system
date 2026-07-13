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
} from './calc.ts'
import type { ApiState } from './api.ts'

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
  const results = (data.results || []) as Result[]
  // 決算済みで再読み込みした場合、当期の決算結果(st.result)を履歴から復元する。
  // これが無いと期末処理タブが「決算を実行する」に戻り、決算書も表示できなくなる。
  st.result = st.settled ? results.find((h) => h.period === st.period) || null : null
  return results
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

// 記帳前バリデーション（calc-spec §12）。該当するエラーを全件返す（OK なら空配列）。
function validate(st: St, key: string, f: Fvals): string[] {
  const c = caps(st)
  const errs: string[] = []
  switch (key) {
    case 'shiire': {
      const items = rowsOf(f)
      let q = 0
      let bad = false
      for (const it of items) {
        if (!Number.isInteger(it.qty) || it.qty < 1) {
          errs.push('仕入個数は1以上の整数で入力してください')
          bad = true
        }
        if (!Number.isInteger(it.unit) || it.unit < 0) {
          errs.push('単価は0以上の整数で入力してください')
          bad = true
        }
        q += it.qty || 0
      }
      if (!bad && st.rawCubes + q > MAT_CAP) errs.push(`材料在庫の上限${MAT_CAP}を超えます（現在 ${st.rawCubes}・追加 ${q}）`)
      break
    }
    case 'seizo': {
      if (st.machines <= 0) errs.push('機械がありません（製造できません）')
      if (st.staffMfg <= 0) errs.push('製造スタッフがいません')
      if (!Number.isInteger(f.qty) || f.qty < 1) {
        errs.push('製造個数は1以上で入力してください')
      } else {
        if (f.qty > c.mfgCap) errs.push(`製造能力 ${c.mfgCap} を超えています`)
        if (f.qty > st.rawCubes) errs.push(`材料が足りません（在庫 ${st.rawCubes}）`)
        if (st.products + f.qty > PROD_CAP) errs.push(`店舗陳列の上限${PROD_CAP}を超えます`)
      }
      break
    }
    case 'hanbai': {
      const items = rowsOf(f)
      let q = 0
      let bad = false
      for (const it of items) {
        if (!Number.isInteger(it.qty) || it.qty < 1) {
          errs.push('販売個数は1以上で入力してください')
          bad = true
        }
        if (!Number.isInteger(it.unit) || it.unit < 0) {
          errs.push('売価は0以上で入力してください')
          bad = true
        }
        q += it.qty || 0
      }
      if (!bad) {
        if (q > c.salesCap) errs.push(`販売能力 ${c.salesCap} を超えています（合計 ${q}）`)
        if (q > st.products) errs.push(`製品が足りません（在庫 ${st.products}）`)
      }
      break
    }
    case 'kikai':
      if (!Number.isInteger(f.n) || f.n < 1) errs.push('台数は1以上で入力してください')
      break
    case 'saiyo':
      if ((f.mfg || 0) + (f.sales || 0) + (f.fail || 0) < 1) errs.push('採用人数を入力してください')
      break
    case 'koukoku':
    case 'kaihatsu':
      if (!Number.isInteger(f.n) || f.n < 1) errs.push('枚数は1以上で入力してください')
      break
    case 'hoken':
      if (!Number.isInteger(f.n) || f.n < 1) errs.push('枚数は1以上で入力してください')
      break
    case 'kyoiku':
      if (st.edu + (f.n || 0) > 1) errs.push('教育チップは最大1枚までです')
      break
    case 'haichi': {
      const n = f.n || 0
      if (n < 1) errs.push('人数を入力してください')
      else {
        if (f.dir === 'sales->mfg' && n > st.staffSales) errs.push('販売スタッフが足りません')
        if (f.dir !== 'sales->mfg' && n > st.staffMfg) errs.push('製造スタッフが足りません')
      }
      break
    }
    case 'kariire':
      if (st.period <= 1) errs.push('第1期は借入できません')
      if (!Number.isInteger(f.a) || f.a < 1) errs.push('借入額を入力してください')
      else if (f.a > loanRoom(st)) errs.push(`借入可能額（${loanRoom(st)}）を超えています`)
      break
    case 'hensai':
      if (!Number.isInteger(f.a) || f.a < 0) errs.push('返済額は0以上で入力してください')
      else if (f.a > st.loan) errs.push(`借入残高（${st.loan}）以上は返済できません`)
      break
    case 'kaihatsu_win':
      if ((f.qty || 0) > 0) {
        if (f.qty > 2 * st.dev) errs.push(`商品開発チップ1枚につき2個までです（枠 ${2 * st.dev}）`)
        if (f.qty > c.salesCap) errs.push(`販売能力 ${c.salesCap} を超えています`)
        if (f.qty > st.products) errs.push(`製品が足りません（在庫 ${st.products}）`)
      }
      break
    case 'dokusen':
      if ((f.qty || 0) > 0) {
        if (f.qty > 2 * st.staffSales) errs.push('販売スタッフ1人につき2個までです')
        if (f.qty > st.products) errs.push(`製品が足りません（在庫 ${st.products}）`)
      }
      break
    case 'tokubai':
      if ((f.qty || 0) < 0) errs.push('個数を確認してください')
      if (f.qty > 5) errs.push('特別サービスは最大5個までです')
      if (st.rawCubes + (f.qty || 0) > MAT_CAP) errs.push(`材料在庫の上限${MAT_CAP}を超えます`)
      break
    case 'keiki':
      if (f.qty > 3) errs.push('景気上昇は最大3個までです')
      if (st.rawCubes + (f.qty || 0) > MAT_CAP) errs.push(`材料在庫の上限${MAT_CAP}を超えます`)
      break
    case 'taishoku_mfg':
      if (st.staffMfg <= 0) errs.push('退職できる製造スタッフがいません')
      break
    case 'taishoku_sales':
      if (st.staffSales <= 0) errs.push('退職できる販売スタッフがいません')
      break
    // 水害・異物混入：記帳時は盤面から自動算出するため常に成立するが、
    // 後から前方の行を削除・編集すると破棄数や保険金の根拠が消える（幽霊保険金）ため再検証で捕まえる
    case 'suigai': {
      const d = f.discard || 0
      if (d > st.rawCubes) errs.push(`破棄数が材料在庫を超えています（在庫 ${st.rawCubes}・破棄 ${d}）`)
      if ((f.payout || 0) > 0 && st.insurance <= 0) errs.push('保険に未加入のため保険金は受け取れません')
      if ((f.payout || 0) > d * 10) errs.push(`保険金は破棄数×10（最大 ${d * 10}）までです`)
      break
    }
    case 'ibutsu': {
      const d = f.discard || 0
      if (d > 2) errs.push('異物混入で破棄できる製品は最大2個です')
      if (d > st.products) errs.push(`破棄数が製品在庫を超えています（在庫 ${st.products}・破棄 ${d}）`)
      if ((f.payout || 0) > 0 && st.insurance <= 0) errs.push('保険に未加入のため保険金は受け取れません')
      if ((f.payout || 0) > d * 10) errs.push(`保険金は破棄数×10（最大 ${d * 10}）までです`)
      break
    }
  }
  // 複数行で同一メッセージが出た場合は重複を除去
  return [...new Set(errs)]
}

function rownote(key: string, f: Fvals): string {
  const a = ACTIONS[key]
  if (key === 'shiire' || key === 'hanbai') return rowsOf(f).map((x) => `${x.qty}×${x.unit}`).join(' ＋ ')
  if (key === 'saiyo') return `製造${f.mfg || 0}・販売${f.sales || 0}${f.fail ? '・失敗' + f.fail : ''}`
  if (key === 'seizo') return `製品+${f.qty}`
  if (key === 'kaihatsu') return f.result === '失敗' ? '開発 失敗' : `開発+${f.n}`
  // イベント：メモ枠に個数×単価を記載
  if (key === 'tokubai') return `${f.qty || 0}×10`
  if (key === 'keiki') return `${f.qty || 0}×12`
  if (key === 'kaihatsu_win') return `${f.qty || 0}×32`
  if (key === 'dokusen') return `${f.qty || 0}×${f.unit || 0}`
  if (key === 'suigai' || key === 'ibutsu') {
    const d = f.discard || 0
    return f.payout ? `${d}×10` : `破棄${d}個`
  }
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

// 台帳全体の再検証：各アクション行を「その行より前の行だけを適用した状態」で検証し直す。
// 行の削除・編集や期首処理の変更は、記帳時に成立していた在庫・能力などの前提を
// さかのぼって崩すことがあるため、そうした操作の後に呼んで矛盾を検出する。
export function revalidateLedger(st: St): string[] {
  const original = st.tx
  const errs: string[] = []
  original.forEach((t, i) => {
    const key = t.key
    if (!key || !ACTIONS[key]) return
    if (t.isClosing || t.isAutoRepay || t.isBorrowInterest) return
    st.tx = original.slice(0, i)
    recompute(st)
    for (const e of validate(st, key, t.fvals || {})) {
      errs.push(`「${ACTIONS[key].label}${t.note ? ' ' + t.note : ''}」：${e}`)
    }
  })
  st.tx = original
  recompute(st)
  return [...new Set(errs)]
}

// 記帳（成功で tx 追加＋recompute）。戻り値: エラーメッセージ配列（成功は空配列）。
export function recordAction(st: St, key: string, fvals: Fvals): string[] {
  const a = ACTIONS[key]
  if (!a) return ['不明なアクションです']
  if (st.settled) return ['この期は決算済みです。決算書から次の期へ進んでください。']
  if (st.closingPrep) return ['期末処理を計上済みです。「記帳に戻る」を押してください。']
  if (a.rule === 'B' && ruleBBlocked(st)) return ['ルールBは1ターンに1度までです（ルールA/イベントを挟んでください）。']
  const errs = validate(st, key, fvals)
  if (errs.length) return errs
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
  return []
}

// 行削除。削除で後続の記帳が成立しなくなる場合（例：この仕入で売った販売が残る）は取り消してエラーを返す。
export function deleteRow(st: St, id: number): string | null {
  const t = st.tx.find((x) => x.id === id)
  if (!t) return null
  if (t.isClosing || t.isCapital || t.isOpeningTax || t.isOpeningInterest || t.isBorrowInterest || t.isAutoRepay) return null
  const original = st.tx
  st.tx = original.filter((x) => x.id !== id)
  const errs = revalidateLedger(st)
  if (errs.length) {
    st.tx = original
    recompute(st)
    return `この行を削除すると後続の記帳が成立しません。先に後続の行を修正してください。（${errs[0]}）`
  }
  return null
}

// アクション行の編集：fvals を差し替えたうえで台帳全体を再検証。
// 編集した行自身は「その行より前の状態」で検証され、後続行への影響（在庫不足など）も検出する。
export function editActionRow(st: St, id: number, fvals: Fvals): string[] {
  if (st.settled) return ['この期は決算済みです。決算書から次の期へ進んでください。']
  if (st.closingPrep) return ['期末処理を計上済みです。「記帳に戻る」を押してください。']
  const idx = st.tx.findIndex((x) => x.id === id)
  if (idx < 0) return ['対象の記帳が見つかりません。']
  const t = st.tx[idx]
  const key = t.key
  if (!key || !ACTIONS[key]) return ['この行は編集できません。']
  const a = ACTIONS[key]
  const original = st.tx
  st.tx = original.map((x) =>
    x.id === id ? { ...x, fvals, col: a.col, amount: a.amount(fvals) || 0, note: rownote(key, fvals), noCash: a.noCash } : x,
  )
  const errs = revalidateLedger(st)
  if (errs.length) {
    st.tx = original
    recompute(st)
    return errs
  }
  return []
}

// 金額のみ変更（キーレス行：資本金・増資・給料/家賃(期末)・その他）
// 増資などは借入可能枠に影響するため、変更後に台帳全体を再検証する。
export function editAmountRow(st: St, id: number, amount: number): string | null {
  if (st.settled) return 'この期は決算済みです。決算書から次の期へ進んでください。'
  const t = st.tx.find((x) => x.id === id)
  if (!t) return '対象の記帳が見つかりません。'
  if (t.key || t.isBorrowInterest || t.isAutoRepay || t.isOpeningTax || t.isOpeningInterest)
    return 'この行は自動計算のため金額を変更できません。'
  if (!(amount >= 0)) return '金額を正しく入力してください。'
  const old = t.amount
  t.amount = amount
  const errs = revalidateLedger(st)
  if (errs.length) {
    t.amount = old
    recompute(st)
    return `この金額に変更すると他の記帳が成立しません。（${errs[0]}）`
  }
  return null
}

export function clearLedger(st: St) {
  st.tx = st.tx.filter((t) => t.isCapital || t.isOpeningTax || t.isOpeningInterest)
  st.closingPrep = false
  recompute(st)
}

// 第1期の水害テストデータ（mock SEED_FLOOD と完全一致）
const SEED_FLOOD: [string, Fvals][] = [
  ['kikai', { n: 1 }],
  ['saiyo', { mfg: 1, sales: 1, fail: 0 }],
  ['shiire', { items: [{ qty: 4, unit: 11 }, { qty: 6, unit: 12 }] }],
  ['seizo', { qty: 2 }],
  ['seizo', { qty: 2 }],
  ['kyoiku', { n: 1 }],
  ['seizo', { qty: 3 }],
  ['hanbai', { qty: 2, unit: 36 }],
  ['koukoku', { n: 1 }],
  ['kaihatsu', { n: 1, result: '成功' }],
  ['hoken', { n: 1 }],
  ['hanbai', { qty: 2, unit: 36 }],
  ['hanbai', { qty: 2, unit: 32 }],
  ['suigai', { discard: 3, payout: 30, insuredUsed: 1 }],
]
export function seedFlood(st: St) {
  st.tx = st.tx.filter((t) => t.isCapital || t.isOpeningTax || t.isOpeningInterest)
  st.closingPrep = false
  for (const [key, fvals] of SEED_FLOOD) {
    const a = ACTIONS[key]
    st.tx.push({ id: st.seq++, key, fvals, col: a.col, amount: a.amount(fvals) || 0, note: rownote(key, fvals), noCash: a.noCash })
  }
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
// 決算の取り消し：当期の決算書・成績を破棄し、期末の自動行も外して記帳可能な状態に戻す。
// 「次の期へ進む」後は繰越済み（settled=false）のため対象外＝過去の期は取り消せない。
export function undoSettle(st: St, history: Result[]): string | null {
  if (!st.settled) return '決算していません。'
  st.settled = false
  st.result = null
  const idx = history.findIndex((h) => h.period === st.period)
  if (idx >= 0) history.splice(idx, 1)
  st.tx = st.tx.filter((t) => !t.isClosing)
  st.closingPrep = false
  recompute(st)
  return null
}
export function goNext(st: St) {
  nextPeriod(st)
}
