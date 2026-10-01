// ゲームの数値ルール。
//
// これまで calc.ts に直書きだった定数をここへ集約する。研修回（組織）ごとに
// 差し替えられるようにするための土台で、DEFAULT_RULES は現行の値そのまま。
//
// 列（col）と勘定科目の対応・法人税率などは対象外。ここに置くのは
// 「研修の設計として講師が変えたくなる数値」だけにする。

/** 借入枠の決め方 */
export type LoanMode = 'equity' | 'sales' | 'debt' | 'bank'
export const LOAN_MODES: LoanMode[] = ['equity', 'sales', 'debt', 'bank']
/** 借入枠の決め方の表示名 */
export const LOAN_MODE_LABELS: Record<LoanMode, string> = {
  equity: '純資産倍率',
  sales: '月商倍率',
  debt: '債務償還年数',
  bank: '銀行審査（3つの最小）',
}

export interface Rules {
  /** 期別の1人あたり給料（添字＝期−1）。表にない期は 28 を使う */
  salaryTable: number[]
  /** 借入金利（比率。0.05 ＝ 5%） */
  loanRate: number
  /**
   * 借入枠の決め方（期ごと。添字＝期−1）。第1期は借入なしなので使わない（docs/calc-spec.md §9・issue #85）。
   * equity＝純資産×倍率／sales＝前期の月商×月数／debt＝前期の簡易キャッシュフロー×償還年数／bank＝その3つの最小値
   */
  loanModes: LoanMode[]
  /** 月商倍率の月数：前期の売上 ÷ 12 の何ヶ月分まで借りられるか（借入金月商倍率の目安は 3〜6） */
  loanSalesMonths: number
  /** 債務償還年数：前期の（経常利益＋減価償却−法人税）の何年分まで借りられるか（銀行の目安は 10年以内。全5期なので既定 5） */
  loanRepayYears: number
  /** 家賃（期末・管理費ク） */
  rent: number
  /** 減価償却（機械1台・1期） */
  depPerMachine: number
  /** 機械（什器）1台の価格 */
  machinePrice: number
  /** 仕入単価の選択肢 */
  materialPrices: number[]
  /** 材料在庫（原料置き場）の上限 */
  matCap: number
  /** 店舗陳列（製品）の上限 */
  prodCap: number
  /**
   * 経営計画書タブを表示し始める期（1以上の整数）。この期より前の期ではタブを出さない。
   * 計算には使わず画面の表示だけに効く。6 以上にすると（全5期なので）一度も出ない。
   */
  planFromPeriod: number
  /**
   * 進捗タブ（今期の計画と途中経過の比較）を表示し始める期（1以上の整数）。計算には使わず画面の表示だけに効く。
   * 比べる計画が必要なので、経営計画書タブを出す期（planFromPeriod）より後の期にする（ルール編集画面で検証）。
   * 既定 4（issue #64「第4期以降から」）。6 以上にすると一度も出ない。
   */
  progressFromPeriod: number
  /** 経営計画書「4. 商品の各単価目標」に出す販売単価（P）の目安。計算には使わず表示だけ（修正.md：販売は28） */
  planHintP: number
  /** 経営計画書「4. 商品の各単価目標」に出す売上原価（V）＝仕入単価の目安。計算には使わず表示だけ（修正.md：仕入は12） */
  planHintV: number
}

/** 既定ルール ＝ 入門編 標準。現行の計算結果を1円も変えないための基準値。 */
export const DEFAULT_RULES: Rules = {
  salaryTable: [25, 28, 31, 34, 37],
  loanRate: 0.05,
  loanModes: ['equity', 'equity', 'equity', 'equity', 'equity'], // 既定は全期 純資産倍率（従来どおり）
  loanSalesMonths: 6,
  loanRepayYears: 5,
  rent: 25,
  depPerMachine: 10,
  machinePrice: 100,
  materialPrices: [10, 11, 12, 13, 14, 15, 16],
  matCap: 15,
  prodCap: 15,
  planFromPeriod: 3,
  progressFromPeriod: 4,
  planHintP: 28,
  planHintV: 12,
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

// 期番号：1以上の整数だけを受け付ける（0・小数・文字列は既定に落とす）
const periodNo = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : fallback

const numList = (v: unknown, fallback: number[]): number[] =>
  Array.isArray(v) && v.length && v.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? (v as number[]).slice()
    : fallback.slice()

// 0 以上の数だけを受け付ける（マイナス・文字列は既定に落とす）
const nonNeg = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback

// 借入枠の決め方：期ごとの配列。知らない値・欠けた期は既定（純資産倍率）で埋め、長さは既定（5期）に揃える
const loanModeList = (v: unknown, fallback: LoanMode[]): LoanMode[] =>
  fallback.map((f, i) => {
    const x = Array.isArray(v) ? v[i] : undefined
    return typeof x === 'string' && (LOAN_MODES as string[]).includes(x) ? (x as LoanMode) : f
  })

/**
 * 部分的な指定を既定値で埋めて完全な Rules にする。
 * 保存済みデータに項目が足りない／型が壊れている場合の後方互換もここで吸収する。
 */
export function normalizeRules(input?: Partial<Rules> | null): Rules {
  const d = DEFAULT_RULES
  if (!input || typeof input !== 'object')
    return { ...d, salaryTable: d.salaryTable.slice(), materialPrices: d.materialPrices.slice(), loanModes: d.loanModes.slice() }
  return {
    salaryTable: numList(input.salaryTable, d.salaryTable),
    loanRate: num(input.loanRate, d.loanRate),
    loanModes: loanModeList(input.loanModes, d.loanModes),
    loanSalesMonths: nonNeg(input.loanSalesMonths, d.loanSalesMonths),
    loanRepayYears: nonNeg(input.loanRepayYears, d.loanRepayYears),
    rent: num(input.rent, d.rent),
    depPerMachine: num(input.depPerMachine, d.depPerMachine),
    machinePrice: num(input.machinePrice, d.machinePrice),
    materialPrices: numList(input.materialPrices, d.materialPrices),
    matCap: num(input.matCap, d.matCap),
    prodCap: num(input.prodCap, d.prodCap),
    planFromPeriod: periodNo(input.planFromPeriod, d.planFromPeriod),
    progressFromPeriod: periodNo(input.progressFromPeriod, d.progressFromPeriod),
    planHintP: num(input.planHintP, d.planHintP),
    planHintV: num(input.planHintV, d.planHintV),
  }
}
