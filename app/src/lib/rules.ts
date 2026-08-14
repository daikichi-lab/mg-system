// ゲームの数値ルール。
//
// これまで calc.ts に直書きだった定数をここへ集約する。研修回（組織）ごとに
// 差し替えられるようにするための土台で、DEFAULT_RULES は現行の値そのまま。
//
// 列（col）と勘定科目の対応・法人税率などは対象外。ここに置くのは
// 「研修の設計として講師が変えたくなる数値」だけにする。

export interface Rules {
  /** 期別の1人あたり給料（添字＝期−1）。表にない期は 28 を使う */
  salaryTable: number[]
  /** 借入金利（比率。0.05 ＝ 5%） */
  loanRate: number
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
}

/** 既定ルール ＝ 入門編 標準。現行の計算結果を1円も変えないための基準値。 */
export const DEFAULT_RULES: Rules = {
  salaryTable: [25, 28, 31, 34, 37],
  loanRate: 0.05,
  rent: 25,
  depPerMachine: 10,
  machinePrice: 100,
  materialPrices: [10, 11, 12, 13, 14, 15, 16],
  matCap: 15,
  prodCap: 15,
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const numList = (v: unknown, fallback: number[]): number[] =>
  Array.isArray(v) && v.length && v.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? (v as number[]).slice()
    : fallback.slice()

/**
 * 部分的な指定を既定値で埋めて完全な Rules にする。
 * 保存済みデータに項目が足りない／型が壊れている場合の後方互換もここで吸収する。
 */
export function normalizeRules(input?: Partial<Rules> | null): Rules {
  const d = DEFAULT_RULES
  if (!input || typeof input !== 'object') return { ...d, salaryTable: d.salaryTable.slice(), materialPrices: d.materialPrices.slice() }
  return {
    salaryTable: numList(input.salaryTable, d.salaryTable),
    loanRate: num(input.loanRate, d.loanRate),
    rent: num(input.rent, d.rent),
    depPerMachine: num(input.depPerMachine, d.depPerMachine),
    machinePrice: num(input.machinePrice, d.machinePrice),
    materialPrices: numList(input.materialPrices, d.materialPrices),
    matCap: num(input.matCap, d.matCap),
    prodCap: num(input.prodCap, d.prodCap),
  }
}
