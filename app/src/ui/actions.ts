// 記帳モーダルのフォーム定義（キー→入力欄）と、アクションのグループ分け。
import { MATERIAL_PRICES } from '../lib/calc'

export interface Field {
  name: string
  label: string
  type: 'int' | 'select'
  default: number | string
  min?: number
  fixed?: boolean
  options?: { value: string; label: string }[]
}

export interface FormDef {
  fields: Field[]
  multi?: boolean // 行追加（items）対応
  rowFields?: Field[] // multi 時の1行分
  note?: string
}

const priceOpts = MATERIAL_PRICES.map((p) => ({ value: String(p), label: String(p) }))

export const FORMS: Record<string, FormDef> = {
  shiire: {
    fields: [],
    multi: true,
    rowFields: [
      { name: 'qty', label: '個数', type: 'int', default: 1, min: 1 },
      { name: 'unit', label: '単価', type: 'select', default: '10', options: priceOpts },
    ],
    note: '材料を仕入れる（在庫上限15）',
  },
  seizo: { fields: [{ name: 'qty', label: '製造個数', type: 'int', default: 1, min: 1 }], note: '材料→製品' },
  hanbai: {
    fields: [],
    multi: true,
    rowFields: [
      { name: 'qty', label: '個数', type: 'int', default: 1, min: 1 },
      { name: 'unit', label: '売価', type: 'int', default: 30, min: 0 },
    ],
    note: '製品を販売する',
  },
  kikai: { fields: [{ name: 'n', label: '台数', type: 'int', default: 1, min: 1 }], note: '1台100・減価償却10/台' },
  saiyo: {
    fields: [
      { name: 'mfg', label: '製造', type: 'int', default: 0, min: 0 },
      { name: 'sales', label: '販売', type: 'int', default: 0, min: 0 },
      { name: 'fail', label: '採用失敗', type: 'int', default: 0, min: 0 },
    ],
    note: '1人あたり5',
  },
  koukoku: { fields: [{ name: 'n', label: '枚数', type: 'int', default: 1, min: 1 }], note: '10/枚・販売能力+2' },
  kaihatsu: {
    fields: [
      { name: 'n', label: '枚数', type: 'int', default: 1, min: 1, fixed: true },
      {
        name: 'result',
        label: '結果',
        type: 'select',
        default: '成功',
        options: [
          { value: '成功', label: '成功' },
          { value: '失敗', label: '失敗' },
        ],
      },
    ],
    note: '20/枚・成功で製造能力の質向上（失敗でも費用発生）',
  },
  hoken: { fields: [{ name: 'n', label: '枚数', type: 'int', default: 1, min: 1 }], note: '5/枚・被害時に補償' },
  kyoiku: {
    fields: [{ name: 'n', label: '枚数', type: 'int', default: 1, min: 1, fixed: true }],
    note: '20/枚・製造能力+1（最大1）',
  },
  haichi: {
    fields: [
      { name: 'n', label: '人数', type: 'int', default: 1, min: 1 },
      {
        name: 'dir',
        label: '方向',
        type: 'select',
        default: 'mfg->sales',
        options: [
          { value: 'mfg->sales', label: '製造→販売' },
          { value: 'sales->mfg', label: '販売→製造' },
        ],
      },
    ],
    note: '5/人',
  },
  kariire: { fields: [{ name: 'a', label: '金額', type: 'int', default: 100, min: 1 }], note: '純資産×倍率の枠内・金利5%' },
  hensai: { fields: [{ name: 'a', label: '返済額', type: 'int', default: 0, min: 0 }], note: '借入残高まで' },
  // イベント（フォームありのもの）
  kaihatsu_win: { fields: [{ name: 'qty', label: '個数', type: 'int', default: 0, min: 0 }], note: '開発チップ1枚2個・1個32で販売' },
  dokusen: {
    fields: [
      { name: 'qty', label: '個数', type: 'int', default: 0, min: 0 },
      { name: 'unit', label: '売価', type: 'int', default: 30, min: 0 },
    ],
    note: '販売スタッフ1人につき2個・空いた市場で独占',
  },
  tokubai: { fields: [{ name: 'qty', label: '個数', type: 'int', default: 0, min: 0 }], note: '1個10で最大5個' },
  keiki: { fields: [{ name: 'qty', label: '個数', type: 'int', default: 0, min: 0 }], note: '1個12で最大3個' },
}

export const A_KEYS = ['shiire', 'seizo', 'hanbai', 'kikai', 'saiyo', 'koukoku', 'kaihatsu']
export const B_KEYS = ['hoken', 'kyoiku', 'haichi', 'kariire', 'hensai']

export interface EventDef {
  key: string
  cat: string
  label: string
}
export const EVENTS: EventDef[] = [
  { key: 'kaihatsu_win', cat: '販売機会', label: '商品開発成功!' },
  { key: 'dokusen', cat: '販売機会', label: '独占販売!' },
  { key: 'tokubai', cat: '仕入機会', label: '特別サービス!' },
  { key: 'keiki', cat: '仕入機会', label: '景気上昇' },
  { key: 'ibutsu', cat: '在庫被害', label: '異物混入' },
  { key: 'suigai', cat: '在庫被害', label: '水害発生' },
  { key: 'taishoku_mfg', cat: '退職', label: '製造スタッフ退職' },
  { key: 'taishoku_sales', cat: '退職', label: '販売スタッフ退職' },
  { key: 'claim', cat: '費用・トラブル', label: 'クレーム発生' },
  { key: 'kitchen', cat: '費用・トラブル', label: '厨房機器故障' },
  { key: 'rousai', cat: '費用・トラブル', label: '労災発生' },
  { key: 'kaihatsu_fail', cat: '手番のみ', label: '商品開発失敗' },
  { key: 'kansen', cat: '手番のみ', label: '感染症の流行' },
  { key: 'chiiki', cat: '手番のみ', label: '地域行事参加' },
  { key: 'fuhyo', cat: '手番のみ', label: '風評被害発生' },
  { key: 'gyaku', cat: '手番のみ', label: '逆回り' },
]
