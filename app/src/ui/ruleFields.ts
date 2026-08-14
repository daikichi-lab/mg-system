// ルール編集・確認画面で共通に使う項目定義。
//
// 8項目を「ゲームの流れ順」の6グループに分けている。縦に8個並べるより、
// 講師が盤面のどの場面の数字かを追いやすいため。
// 各項目には効く先の勘定科目（記帳台帳の列）を持たせ、画面ではその列の色で示す。
// 盤面の上限や決算でしか出てこないものは列を持たない（chip を出さない）。
import type { Rules } from '../lib/rules'

/** 記帳台帳の列（COL_LABELS の添字）。null は勘定科目に直結しないもの */
export type ColRef = number | null

export interface NumField {
  kind: 'num'
  key: 'rent' | 'depPerMachine' | 'machinePrice' | 'matCap' | 'prodCap'
  label: string
  desc: string
  unit?: string
  min: number
  col: ColRef
  colNote?: string
}
export interface PctField {
  kind: 'pct'
  key: 'loanRate'
  label: string
  desc: string
  min: number
  col: ColRef
  colNote?: string
}
export interface SalaryField {
  kind: 'salary'
  key: 'salaryTable'
  label: string
  desc: string
  col: ColRef
}
export interface PricesField {
  kind: 'prices'
  key: 'materialPrices'
  label: string
  desc: string
  col: ColRef
}
export type Field = NumField | PctField | SalaryField | PricesField

export interface Group {
  title: string
  lead: string
  fields: Field[]
}

/** ゲームの流れ順（仕入れ → 製造 → 販売 → 人材 → 金融 → 期末） */
export const GROUPS: Group[] = [
  {
    title: '仕入れ',
    lead: '材料をいくらで、いくつまで持てるか',
    fields: [
      {
        kind: 'prices',
        key: 'materialPrices',
        label: '仕入単価の選択肢',
        desc: '記帳画面のプルダウンに出る単価。安く買えるほど粗利が増えます',
        col: 5,
      },
      {
        kind: 'num',
        key: 'matCap',
        label: '材料在庫の上限',
        desc: '原料置き場に置ける個数。超える仕入れはできません',
        unit: '個',
        min: 1,
        col: null,
        colNote: '盤面の上限',
      },
    ],
  },
  {
    title: '製造と機械',
    lead: '設備投資の重さ',
    fields: [
      {
        kind: 'num',
        key: 'machinePrice',
        label: '機械1台の価格',
        desc: '高くすると増産の判断が重くなります',
        unit: '／台',
        min: 0,
        col: 4,
      },
      {
        kind: 'num',
        key: 'depPerMachine',
        label: '減価償却（1台・1期）',
        desc: '決算で固定費Fに計上されます',
        unit: '／台・期',
        min: 0,
        col: null,
        colNote: '決算で計上',
      },
    ],
  },
  {
    title: '販売',
    lead: '店頭に並べられる量',
    fields: [
      {
        kind: 'num',
        key: 'prodCap',
        label: '製品（店舗陳列）の上限',
        desc: '陳列できる個数。超える製造はできません',
        unit: '個',
        min: 1,
        col: null,
        colNote: '盤面の上限',
      },
    ],
  },
  {
    title: '人材',
    lead: '期が進むほど1人あたりの給料が上がる',
    fields: [
      {
        kind: 'salary',
        key: 'salaryTable',
        label: '給料（1人あたり）',
        desc: '期末処理で「在籍人数 × その期の給料」として計上されます。表にない期は 28 を使います',
        col: 6,
      },
    ],
  },
  {
    title: '金融機関',
    lead: '借入のコスト',
    fields: [
      {
        kind: 'pct',
        key: 'loanRate',
        label: '借入金利',
        desc: '借入時と期首に支払金利として計上されます（第1期は借入なし）',
        min: 0,
        col: 8,
      },
    ],
  },
  {
    title: '期末・決算',
    lead: '毎期かならず出ていく費用',
    fields: [
      {
        kind: 'num',
        key: 'rent',
        label: '家賃（期末）',
        desc: '期末処理で必ず計上されます',
        min: 0,
        col: 8,
      },
    ],
  },
]

/** 記帳台帳と同じ勘定科目の色（Participant の LCOL と揃える） */
export const COL_STYLE: { bg: string; fg: string }[] = [
  { bg: '#fdf1f6', fg: '#b03a6a' }, // ア 資本金
  { bg: '#fef9e6', fg: '#9a7d10' }, // イ 借入金
  { bg: '#fef3e6', fg: '#b5630f' }, // ウ 売上
  { bg: '#fdf4f8', fg: '#b85c7e' }, // A 受取保険金
  { bg: '#f3eefb', fg: '#6b4fa0' }, // エ 什器
  { bg: '#eef7f0', fg: '#3f7d4f' }, // オ 材料仕入
  { bg: '#eef2fb', fg: '#3a5aa8' }, // カ 人件費
  { bg: '#fdf0ec', fg: '#b1543a' }, // キ 販売費
  { bg: '#f0f2f5', fg: '#59616e' }, // ク 管理費
  { bg: '#f4f1ea', fg: '#7a6a45' }, // ケ 借入金返済
  { bg: '#f7eef0', fg: '#8a5560' }, // コ 納税
]

export const COL_NAMES = [
  'ア 資本金',
  'イ 借入金',
  'ウ 売上',
  'A 受取保険金',
  'エ 什器',
  'オ 材料仕入',
  'カ 人件費',
  'キ 販売費',
  'ク 管理費',
  'ケ 借入金返済',
  'コ 納税',
]

/** 給料表の期数。ここを増やすと入力欄も増える */
export const SALARY_PERIODS = 5

/** 画面の入力値 → Rules。空欄や不正値は既定にせず 0 扱いにせず、呼び出し側で検証する */
export function rulesFromForm(r: Rules): Rules {
  return {
    ...r,
    salaryTable: r.salaryTable.slice(0, SALARY_PERIODS),
    materialPrices: [...r.materialPrices].sort((a, b) => a - b),
  }
}
