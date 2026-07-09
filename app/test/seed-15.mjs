// 15人分のデモデータ投入スクリプト（UI確認用）。
// 使い方: node test/seed-15.mjs [組織コード]   （既定: demo15）
// 再実行すると同組織の参加者データを消してから投入し直す（冪等）。
//
// 計算エンジン(src/lib/calc.ts)で各社のプレイを実際にシミュレートし、
// 本番と同じ形（entries + period_results の result_json）で実DBへ保存する。
// game.ts は拡張子なし import を含み Node から直接読めないため、
// 記帳バリデーション(validate/ruleBBlocked/rownote/eventFvals)は同等品をここに移植している。
import { initDb, registerOrg, joinCompany, saveState, deleteOrg } from '../server/db.js'
import {
  ACTIONS,
  newState,
  recompute,
  doClosingPrep,
  settle,
  nextPeriod,
  caps,
  cashNow,
  loanRoom,
  MAT_CAP,
  PROD_CAP,
} from '../src/lib/calc.ts'

// テストデータはローカル確認専用。DATABASE_URL（本番Postgres）が設定された環境では誤投入を防ぐ。
if (process.env.DATABASE_URL) {
  console.error('DATABASE_URL が設定されています（本番DBの可能性）。このスクリプトはローカルSQLite専用です。中止しました。')
  process.exit(1)
}

const ORG = process.argv[2] || 'demo15'
const CAPITAL = 300

// ---- game.ts からの移植（記帳前チェック）----
function ruleBBlocked(st) {
  for (let i = st.tx.length - 1; i >= 0; i--) {
    const t = st.tx[i]
    const a = t.key ? ACTIONS[t.key] : undefined
    if (!a) continue
    if (a.rule === 'A' || a.rule === 'X') return false
    if (a.rule === 'B') return true
  }
  return false
}

const rowsOf = (f) => (f && f.items && f.items.length ? f.items : [{ qty: f?.qty, unit: f?.unit }])

function validate(st, key, f) {
  const c = caps(st)
  const errs = []
  switch (key) {
    case 'shiire': {
      const q = rowsOf(f).reduce((s, x) => s + (x.qty || 0), 0)
      if (st.rawCubes + q > MAT_CAP) errs.push(`材料在庫の上限${MAT_CAP}を超えます（現在 ${st.rawCubes}・追加 ${q}）`)
      break
    }
    case 'seizo':
      if (st.machines <= 0) errs.push('機械がありません')
      if (st.staffMfg <= 0) errs.push('製造スタッフがいません')
      if (f.qty > c.mfgCap) errs.push(`製造能力 ${c.mfgCap} を超えています（${f.qty}）`)
      if (f.qty > st.rawCubes) errs.push(`材料が足りません（在庫 ${st.rawCubes}・要求 ${f.qty}）`)
      if (st.products + f.qty > PROD_CAP) errs.push(`店舗陳列の上限${PROD_CAP}を超えます`)
      break
    case 'hanbai': {
      const q = rowsOf(f).reduce((s, x) => s + (x.qty || 0), 0)
      if (q > c.salesCap) errs.push(`販売能力 ${c.salesCap} を超えています（${q}）`)
      if (q > st.products) errs.push(`製品が足りません（在庫 ${st.products}・要求 ${q}）`)
      break
    }
    case 'kyoiku':
      if (st.edu + (f.n || 0) > 1) errs.push('教育チップは最大1枚までです')
      break
    case 'kariire':
      if (st.period <= 1) errs.push('第1期は借入できません')
      if (f.a > loanRoom(st)) errs.push(`借入可能額（${loanRoom(st)}）を超えています`)
      break
    case 'hensai':
      if (f.a > st.loan) errs.push(`借入残高（${st.loan}）以上は返済できません`)
      break
    case 'kaihatsu_win':
      if (f.qty > 2 * st.dev) errs.push(`商品開発チップ1枚につき2個までです（枠 ${2 * st.dev}）`)
      if (f.qty > c.salesCap) errs.push(`販売能力 ${c.salesCap} を超えています`)
      if (f.qty > st.products) errs.push(`製品が足りません（在庫 ${st.products}）`)
      break
    case 'dokusen':
      if (f.qty > 2 * st.staffSales) errs.push('販売スタッフ1人につき2個までです')
      if (f.qty > st.products) errs.push(`製品が足りません（在庫 ${st.products}）`)
      break
    case 'taishoku_mfg':
      if (st.staffMfg <= 0) errs.push('退職できる製造スタッフがいません')
      break
    case 'taishoku_sales':
      if (st.staffSales <= 0) errs.push('退職できる販売スタッフがいません')
      break
  }
  return errs
}

function rownote(key, f) {
  const a = ACTIONS[key]
  if (key === 'shiire' || key === 'hanbai') return rowsOf(f).map((x) => `${x.qty}×${x.unit}`).join(' ＋ ')
  if (key === 'saiyo') return `製造${f.mfg || 0}・販売${f.sales || 0}${f.fail ? '・失敗' + f.fail : ''}`
  if (key === 'seizo') return `製品+${f.qty}`
  if (key === 'kaihatsu') return f.result === '失敗' ? '開発 失敗' : `開発+${f.n}`
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

function eventFvals(st, key) {
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

// ---- 記帳（本番と同じ検証を通し、不正なシナリオはここで落とす）----
function push(st, key, fvals = {}) {
  if (fvals === 'auto') fvals = eventFvals(st, key)
  const a = ACTIONS[key]
  if (!a) throw new Error(`不明なアクション: ${key}`)
  if (st.settled || st.closingPrep) throw new Error(`決算/期末処理後に記帳: ${key}`)
  if (a.rule === 'B' && ruleBBlocked(st)) throw new Error(`ルールBが連続: ${key}`)
  const errs = validate(st, key, fvals)
  if (errs.length) throw new Error(`${key}: ${errs.join(' / ')}`)
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
  const cash = cashNow(st)
  if (cash < 0) throw new Error(`現金がマイナス(${cash}) after ${key}`)
}

// ---- 15人分のプレイ計画 ----
// periods: 各期のアクション列。settle:true で決算まで実行（最終期のみ false 可＝記帳途中）。
// 進捗もバラす: 第3期決算済×3 / 第3期記帳中×4 / 第2期決算済×2 / 第2期記帳中×3 / 第1期決算済×1 / 第1期記帳中×1 / 開始直後×1
const PLAYERS = [
  {
    name: 'スイーツ工房こむぎ', president: '鈴木 一郎', // 高価格・開発型（トップ想定）
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 1, fail: 0 }], ['shiire', { qty: 10, unit: 13 }],
        ['kaihatsu', { n: 1, result: '成功' }], ['koukoku', { n: 1 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 42 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 42 }], ['hoken', { n: 1 }],
      ]},
      { settle: true, acts: [
        ['saiyo', { mfg: 0, sales: 1, fail: 0 }], ['shiire', { qty: 12, unit: 12 }],
        ['kaihatsu', { n: 1, result: '成功' }], ['koukoku', { n: 1 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 6 }], ['hanbai', { qty: 6, unit: 44 }],
        ['seizo', { qty: 6 }], ['hanbai', { qty: 6, unit: 44 }], ['hoken', { n: 1 }],
      ]},
      { settle: true, acts: [
        ['shiire', { qty: 12, unit: 11 }], ['koukoku', { n: 2 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 6 }], ['hanbai', { qty: 6, unit: 45 }],
        ['seizo', { qty: 6 }], ['hanbai', { qty: 6, unit: 45 }], ['hoken', { n: 1 }],
      ]},
    ],
  },
  {
    name: 'パティスリー花', president: '佐藤 花子', // バランス型
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 1, fail: 0 }], ['shiire', { qty: 10, unit: 13 }],
        ['koukoku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 36 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 36 }], ['hoken', { n: 1 }],
      ]},
      { settle: true, acts: [
        ['saiyo', { mfg: 0, sales: 1, fail: 0 }], ['shiire', { qty: 12, unit: 12 }], ['koukoku', { n: 2 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 6 }], ['hanbai', { qty: 6, unit: 37 }],
        ['seizo', { qty: 6 }], ['hanbai', { qty: 6, unit: 37 }], ['hoken', { n: 1 }],
      ]},
      { settle: true, acts: [
        ['shiire', { qty: 12, unit: 11 }], ['koukoku', { n: 2 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 6 }], ['hanbai', { qty: 6, unit: 38 }],
        ['seizo', { qty: 6 }], ['hanbai', { qty: 6, unit: 38 }], ['hoken', { n: 1 }],
      ]},
    ],
  },
  {
    name: 'ケーキハウスもみじ', president: '高橋 恵', // 薄利多売型
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 2, fail: 0 }], ['shiire', { qty: 12, unit: 13 }],
        ['koukoku', { n: 2 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 29 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 29 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 29 }],
      ]},
      { settle: true, acts: [
        ['shiire', { qty: 14, unit: 12 }], ['koukoku', { n: 2 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 30 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 6 }], ['hanbai', { qty: 6, unit: 30 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 30 }],
      ]},
      { settle: true, acts: [
        ['shiire', { qty: 15, unit: 11 }], ['koukoku', { n: 2 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 31 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 6 }], ['hanbai', { qty: 6, unit: 31 }],
        ['seizo', { qty: 5 }], ['hanbai', { qty: 5, unit: 31 }],
      ]},
    ],
  },
  {
    name: '洋菓子のアトリエ月', president: '田中 大輔', // 借入・設備投資型（第3期記帳中）
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 1, fail: 0 }], ['shiire', { qty: 10, unit: 13 }],
        ['koukoku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 35 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 35 }], ['hoken', { n: 1 }],
      ]},
      { settle: true, acts: [
        ['kariire', { a: 200 }], ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 1, fail: 0 }],
        ['shiire', { qty: 13, unit: 12 }], ['koukoku', { n: 1 }], ['kyoiku', { n: 1 }],
        ['seizo', { qty: 8 }], ['hanbai', { qty: 6, unit: 36 }],
        ['seizo', { qty: 7 }], ['hanbai', { qty: 6, unit: 36 }], ['hanbai', { qty: 3, unit: 36 }],
      ]},
      { settle: false, acts: [
        ['shiire', { qty: 12, unit: 11 }], ['koukoku', { n: 1 }], ['kyoiku', { n: 1 }],
        ['seizo', { qty: 8 }], ['hanbai', { qty: 6, unit: 37 }],
      ]},
    ],
  },
  {
    name: 'パティスリーソレイユ', president: '伊藤 美咲', // 広告型（第3期記帳中）
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 2, fail: 0 }], ['shiire', { qty: 12, unit: 13 }],
        ['koukoku', { n: 2 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 33 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 33 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 33 }], ['hoken', { n: 1 }],
      ]},
      { settle: true, acts: [
        ['shiire', { qty: 12, unit: 12 }], ['koukoku', { n: 2 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 6 }], ['hanbai', { qty: 6, unit: 34 }],
        ['seizo', { qty: 6 }], ['hanbai', { qty: 6, unit: 34 }], ['hoken', { n: 1 }],
      ]},
      { settle: false, acts: [
        ['shiire', { qty: 12, unit: 11 }], ['koukoku', { n: 2 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 34 }],
      ]},
    ],
  },
  {
    name: 'お菓子の家プティ', president: '渡辺 健', // 保険＋水害イベント（第3期記帳中）
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 1, sales: 1, fail: 0 }],
        ['shiire', { items: [{ qty: 4, unit: 11 }, { qty: 6, unit: 12 }] }],
        ['seizo', { qty: 2 }], ['seizo', { qty: 2 }], ['kyoiku', { n: 1 }], ['seizo', { qty: 3 }],
        ['hanbai', { qty: 2, unit: 36 }], ['koukoku', { n: 1 }], ['kaihatsu', { n: 1, result: '成功' }],
        ['hoken', { n: 1 }], ['hanbai', { qty: 2, unit: 36 }], ['hanbai', { qty: 2, unit: 32 }],
        ['suigai', 'auto'],
      ]},
      { settle: true, acts: [
        ['saiyo', { mfg: 1, sales: 1, fail: 0 }], ['shiire', { qty: 10, unit: 12 }],
        ['koukoku', { n: 1 }], ['kyoiku', { n: 1 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 36 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 36 }], ['hoken', { n: 1 }],
      ]},
      { settle: false, acts: [
        ['shiire', { qty: 10, unit: 11 }], ['koukoku', { n: 1 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 37 }],
      ]},
    ],
  },
  {
    name: 'スイーツファクトリー海', president: '山本 由紀', // 開発・販売機会イベント型（第3期記帳中）
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 1, fail: 0 }],
        ['shiire', { items: [{ qty: 6, unit: 12 }, { qty: 6, unit: 13 }] }],
        ['kaihatsu', { n: 1, result: '成功' }], ['koukoku', { n: 1 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 38 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 2, unit: 38 }],
        ['kaihatsu_win', { qty: 2 }], ['seizo', { qty: 4 }],
        ['dokusen', { qty: 2, unit: 45 }], ['hanbai', { qty: 2, unit: 38 }],
      ]},
      { settle: true, acts: [
        ['kaihatsu', { n: 1, result: '成功' }], ['saiyo', { mfg: 0, sales: 1, fail: 0 }],
        ['shiire', { qty: 14, unit: 12 }], ['koukoku', { n: 1 }], ['kyoiku', { n: 1 }],
        ['seizo', { qty: 6 }], ['kaihatsu_win', { qty: 2 }], ['hanbai', { qty: 4, unit: 39 }],
        ['seizo', { qty: 6 }], ['hanbai', { qty: 5, unit: 39 }],
        ['seizo', { qty: 2 }], ['dokusen', { qty: 2, unit: 44 }], ['hanbai', { qty: 1, unit: 39 }],
      ]},
      { settle: false, acts: [
        ['kaihatsu', { n: 1, result: '成功' }], ['shiire', { qty: 10, unit: 11 }],
        ['koukoku', { n: 1 }], ['kyoiku', { n: 1 }],
        ['seizo', { qty: 6 }], ['hanbai', { qty: 4, unit: 40 }],
      ]},
    ],
  },
  {
    name: 'ケーキ工房ひなた', president: '中村 翔太', // 過剰投資→赤字型（第2期決算済）
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 1, fail: 0 }], ['shiire', { qty: 8, unit: 13 }],
        ['koukoku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 26 }],
        ['kikai', { n: 1 }], ['kyoiku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 26 }],
        ['hoken', { n: 1 }],
      ]},
      { settle: true, acts: [
        ['kariire', { a: 120 }], ['saiyo', { mfg: 1, sales: 0, fail: 0 }], ['shiire', { qty: 10, unit: 12 }],
        ['koukoku', { n: 2 }], ['seizo', { qty: 5 }], ['hanbai', { qty: 5, unit: 27 }],
        ['seizo', { qty: 5 }], ['hanbai', { qty: 5, unit: 27 }],
      ]},
    ],
  },
  {
    name: 'パティスリーくるみ', president: '小林 さくら', // 堅実型（第2期決算済）
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 1, fail: 0 }], ['shiire', { qty: 9, unit: 13 }],
        ['hoken', { n: 1 }], ['koukoku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 34 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 34 }],
      ]},
      { settle: true, acts: [
        ['saiyo', { mfg: 0, sales: 1, fail: 0 }], ['shiire', { qty: 11, unit: 12 }], ['koukoku', { n: 1 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 6 }], ['hanbai', { qty: 5, unit: 35 }],
        ['seizo', { qty: 6 }], ['hanbai', { qty: 5, unit: 35 }], ['hoken', { n: 1 }],
        ['hanbai', { qty: 2, unit: 35 }],
      ]},
    ],
  },
  {
    name: '洋菓子店マカロン', president: '加藤 亮', // 第2期記帳中
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 1, fail: 0 }], ['shiire', { qty: 10, unit: 13 }],
        ['koukoku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 32 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 32 }], ['hoken', { n: 1 }],
      ]},
      { settle: false, acts: [
        ['saiyo', { mfg: 0, sales: 1, fail: 0 }], ['shiire', { qty: 10, unit: 12 }], ['koukoku', { n: 1 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 33 }],
      ]},
    ],
  },
  {
    name: 'スイーツアトリエ空', president: '吉田 直樹', // 第2期記帳中・退職イベント
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 1, fail: 0 }], ['shiire', { qty: 10, unit: 13 }],
        ['koukoku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 31 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 31 }], ['hoken', { n: 1 }],
      ]},
      { settle: false, acts: [
        ['shiire', { qty: 10, unit: 12 }], ['taishoku_mfg', {}], ['koukoku', { n: 1 }],
        ['seizo', { qty: 2 }], ['hanbai', { qty: 2, unit: 32 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 3 }], ['hanbai', { qty: 3, unit: 32 }],
      ]},
    ],
  },
  {
    name: 'ケーキショップいちご', president: '山田 真由', // 第2期記帳中・異物混入イベント
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 1, fail: 0 }], ['shiire', { qty: 10, unit: 13 }],
        ['hoken', { n: 1 }], ['koukoku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 33 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 33 }],
      ]},
      { settle: false, acts: [
        ['saiyo', { mfg: 0, sales: 1, fail: 0 }], ['shiire', { qty: 10, unit: 12 }], ['hoken', { n: 1 }],
        ['koukoku', { n: 1 }], ['seizo', { qty: 4 }], ['ibutsu', 'auto'],
        ['hanbai', { qty: 2, unit: 34 }], ['kyoiku', { n: 1 }],
        ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 34 }],
      ]},
    ],
  },
  {
    name: 'パティスリー森の香', president: '佐々木 光', // 第1期決算済（次期未突入）
    periods: [
      { settle: true, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 1, fail: 0 }], ['shiire', { qty: 10, unit: 13 }],
        ['koukoku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 37 }],
        ['kyoiku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 4, unit: 37 }], ['hoken', { n: 1 }],
      ]},
    ],
  },
  {
    name: '洋菓子工房つばき', president: '松本 綾', // 第1期記帳中
    periods: [
      { settle: false, acts: [
        ['kikai', { n: 1 }], ['saiyo', { mfg: 2, sales: 1, fail: 0 }], ['shiire', { qty: 8, unit: 13 }],
        ['koukoku', { n: 1 }], ['seizo', { qty: 4 }], ['hanbai', { qty: 3, unit: 35 }],
      ]},
    ],
  },
  {
    name: 'スイーツハウスレモン', president: '井上 拓海', // 開始直後（資本金のみ）
    periods: [{ settle: false, acts: [] }],
  },
]

// ---- シミュレーション（payloadFromState 相当の形で返す）----
const OPENING_KEYS = [
  'openingCash', 'openingCapital', 'retained', 'openingMatQty', 'openingMatVal', 'openingProducts',
  'openingEquipVal', 'openingMachines', 'openingStaffMfg', 'openingStaffSales', 'openingLoan',
  'openingDev', 'openingAds', 'loanMult', 'repayRate',
]

function simulate(spec) {
  const st = newState()
  st.loanMult = 2 // 講師設定：借入枠は自己資本×2・期末返済20%（第2期以降）
  st.repayRate = 20
  st.name = spec.name
  st.president = spec.president
  st.org = ORG
  st.started = true
  st.tx.push({ id: st.seq++, label: '資本金', col: 0, amount: CAPITAL, isCapital: true })
  recompute(st)
  const history = []
  spec.periods.forEach((p, i) => {
    const last = i === spec.periods.length - 1
    if (!p.settle && !last) throw new Error(`${spec.name}: 決算しない期は最終期のみ`)
    for (const [key, fvals] of p.acts) {
      try {
        push(st, key, fvals)
      } catch (e) {
        throw new Error(`${spec.name} 第${st.period}期 ${e.message}`)
      }
    }
    if (p.settle) {
      doClosingPrep(st)
      const r = settle(st)
      if (r.diff !== 0) throw new Error(`${spec.name} 第${r.period}期: B/S不一致 diff=${r.diff}`)
      if (r.diffQty !== 0) throw new Error(`${spec.name} 第${r.period}期: 棚卸差異 ${r.diffQty}`)
      history.push(r)
      if (!last) nextPeriod(st)
    }
  })
  const opening = {}
  OPENING_KEYS.forEach((k) => (opening[k] = st[k]))
  return {
    st,
    history,
    payload: {
      president: st.president,
      period: st.period,
      started: st.started,
      settled: st.settled,
      opening,
      seq: st.seq,
      entries: st.tx.filter((t) => !t.isBorrowInterest), // 金利派生行は保存しない（recomputeで再生成）
      results: history,
    },
  }
}

// ---- DB 投入 ----
await initDb()
await deleteOrg(ORG) // 冪等：同組織の既存参加者データを消してから投入
await registerOrg(ORG)

const fmtG = (n) => (n < 0 ? `▲${Math.abs(n)}` : `${n}`)
console.log(`組織コード: ${ORG}（15社を投入）\n`)
for (const spec of PLAYERS) {
  const { st, history, payload } = simulate(spec)
  const joined = await joinCompany(ORG, spec.name, spec.president)
  await saveState(joined.company.id, payload)
  const gs = history.map((r) => `P${r.period}:G=${fmtG(r.G)}`).join(' ')
  const status = st.settled ? `第${st.period}期 決算済` : st.tx.length > 1 ? `第${st.period}期 記帳中` : '開始直後'
  const cash = history.length && st.settled ? history[history.length - 1].cashEnd : cashNow(st)
  console.log(
    `  ${spec.name.padEnd(12, '　')} ${status.padEnd(9, '　')} ${gs || '（決算なし）'}  現金=${cash}`,
  )
}

console.log(`
確認用URL（npm start 後）:
  参加者     : http://localhost:3001/?org=${ORG}
               → 会社情報タブで既存の会社名＋組織コードを入力すると各社を復元できます
  管理者     : http://localhost:3001/admin （パスワード: mg）
               → 組織 ${ORG} の成績一覧・CSV・参加者ビュー（閲覧専用）
  閲覧専用例 : http://localhost:3001/?vorg=${ORG}&vco=${encodeURIComponent(PLAYERS[0].name)}
`)
