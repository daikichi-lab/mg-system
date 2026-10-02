// ゲームの数値ルール。
//
// これまで calc.ts に直書きだった定数をここへ集約する。研修回（組織）ごとに
// 差し替えられるようにするための土台で、DEFAULT_RULES は現行の値そのまま。
//
// 列（col）と勘定科目の対応・法人税率などは対象外。ここに置くのは
// 「研修の設計として講師が変えたくなる数値」だけにする。

/** 借入枠の基準（純資産倍率・月商倍率・債務償還年数） */
export type LoanBasis = 'equity' | 'sales' | 'debt'
export const LOAN_BASES: LoanBasis[] = ['equity', 'sales', 'debt']
export const LOAN_BASIS_LABELS: Record<LoanBasis, string> = {
  equity: '純資産倍率',
  sales: '月商倍率',
  debt: '債務償還年数',
}
/** 複数の基準が効く期に、どの枠を採るか（min＝一番小さい＝銀行審査らしく厳しい／max＝一番大きい＝緩い） */
export type LoanCombine = 'min' | 'max'
export const LOAN_COMBINE_LABELS: Record<LoanCombine, string> = {
  min: '一番小さい枠（厳しい・銀行審査）',
  max: '一番大きい枠（緩い）',
}

export interface Rules {
  /** 期別の1人あたり給料（添字＝期−1）。表にない期は 28 を使う */
  salaryTable: number[]
  /** 借入金利（比率。0.05 ＝ 5%） */
  loanRate: number
  /**
   * 借入枠の基準ごとに、何期から使うか（0＝使わない）。第1期は借入なしなので 2 以上で効く（docs/calc-spec.md §9・issue #85）。
   * equity＝純資産×倍率／sales＝前期の月商×月数／debt＝前期の（経常利益＋減価償却−法人税）×償還年数
   */
  loanFrom: Record<LoanBasis, number>
  /** 複数の基準が効く期の借入枠：一番小さい枠（min）か一番大きい枠（max）か */
  loanCombine: LoanCombine
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
  loanFrom: { equity: 2, sales: 0, debt: 0 }, // 既定は第2期から純資産倍率だけ（従来どおり）
  loanCombine: 'min',
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

// 借入枠の基準ごとの開始期：0（使わない）以上の整数だけを受け付け、欠けた基準・壊れた値は既定で埋める
const loanFromOf = (v: unknown, fallback: Record<LoanBasis, number>): Record<LoanBasis, number> => {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const one = (k: LoanBasis) => {
    const x = o[k]
    return typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : fallback[k]
  }
  return { equity: one('equity'), sales: one('sales'), debt: one('debt') }
}

/**
 * 部分的な指定を既定値で埋めて完全な Rules にする。
 * 保存済みデータに項目が足りない／型が壊れている場合の後方互換もここで吸収する。
 */
export function normalizeRules(input?: Partial<Rules> | null): Rules {
  const d = DEFAULT_RULES
  if (!input || typeof input !== 'object')
    return { ...d, salaryTable: d.salaryTable.slice(), materialPrices: d.materialPrices.slice(), loanFrom: { ...d.loanFrom } }
  return {
    salaryTable: numList(input.salaryTable, d.salaryTable),
    loanRate: num(input.loanRate, d.loanRate),
    loanFrom: loanFromOf(input.loanFrom, d.loanFrom),
    loanCombine: input.loanCombine === 'max' || input.loanCombine === 'min' ? input.loanCombine : d.loanCombine,
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
