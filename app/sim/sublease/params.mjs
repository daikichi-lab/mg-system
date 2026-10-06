// サブリース経営MG シミュレーションの数値（issue #104）。
//
// 設計案（https://claude.ai/artifact/23T6G3k6jSxUC6Ki2DUQRx）の「初期設定の数値例」をそのまま既定値にしている。
// 調整した数値案は TUNED に置き、`run.mjs --params tuned` で切り替える。
// 金額の単位は製造業MGと同じ（1 ＝ 1万円相当の抽象単位）。1期＝1年。

export const BASE = {
  /** 開業資本金 */
  capital: 300,
  /** 期数 */
  periods: 5,
  /** 1人あたりの出納帳の行数（第1期は25行、第2期以降は45行）。誰かが使い切ったら、その周回で期を終える */
  rows: [25, 45, 45, 45, 45],

  /**
   * 期の進め方：'rows'＝行数制（誰かが最終行まで行ったら期末）／'time'＝時間制（1期 periodMin 分。時間が来たらその周回で期末）。
   * 時間制では、家賃と借上げ賃料を「経過時間 ÷ 1期の時間」で積み立て、自分の手番が来たときに受け取る・払う
   */
  pace: 'rows',
  periodMin: 55,
  /** 時間制：1手番にかかる時間（分）の範囲と、個人の入札があった手番に足す時間 */
  turnMin: [1, 3],
  auctionMin: 1,
  /** 家具家電を買ったら、その場で未準備の部屋に置く（購入と募集準備を1回にまとめる） */
  directFurnish: false,
  /** 物件を借りるのと同じ手番で、その棟の家具家電も買える */
  leaseFurnish: false,
  /** 開業準備：第1期の時計を動かす前に、資本金で棟を借りて家具を入れる（1棟を充実／2棟にまんべんなく） */
  setupOpening: false,
  /** 開始時に物件を持たない（資本金だけで始め、最初の手番で棟を借りる） */
  startEmpty: false,
  /** 山札の構成（意思決定・リスク・チャンス）。リスク・チャンスの内訳は cards.mjs */
  deckDecision: 44,

  /** 棟カード（借上げ物件）。1棟8室。own＝借上げ賃料（1室・1期）、mkt＝相場家賃（個人の入札の上限） */
  areas: {
    city: { n: 6, own: 32, mkt: 50 },
    suburb: { n: 10, own: 28, mkt: 45 },
    rural: { n: 8, own: 24, mkt: 40 },
  },
  /** 築古（どの立地にも混ぜる）：枚数と、借上げ賃料・相場家賃の差 */
  oldN: 4,
  oldDelta: -4, // 築古は「漏水・設備故障」の修繕費が倍（cards の効果側で扱う）
  roomsPerBldg: 8,
  maxBldg: 6,
  /** 表向きに並べる棟カードの枚数 */
  faceUp: 3,
  /** 開始時の物件（各社に1棟、市場の山札とは別に配る） */
  startArea: 'suburb',
  /**
   * 開始時の物件を「営業中」で渡すか（家具8セットを置き済み＝資本金の一部が家具、入居者あり）。
   * startTenants は入居している室数（法人は相場−2、個人は相場−1、学生は相場−5 のプライスカード）。
   * 入居者の家賃は第1期の期首に継続家賃として入る。null なら設計案どおり家具なし・空室で始める
   */
  startTenants: null,

  /** 家具家電セット：単価・1期の減価償却・倉庫の上限 */
  furnPrice: 12,
  furnDep: 3,
  whCap: 12,

  /** 入居1室ごとの費用 V（仲介手数料・広告料・入居時清掃） */
  V: 4,
  /** 退去1室の原状回復費 */
  restore: 2,

  /** 給料（1人・1期）・採用費（1人）・1回に採用できる人数・それぞれの上限 */
  salary: [25, 28, 31, 34, 37],
  hireCost: 5,
  hireMax: 3,
  staffMax: 6,
  /** 本社家賃（1期） */
  hq: 25,

  /** 能力：営業1人で1回の入居契約2室、管理1人で募集準備1回4室・管理12室、スマートロック1枚で管理＋6室 */
  leasePerSales: 2,
  prepPerMgmt: 4,
  mgmtRooms: 12,
  lockRooms: 6,
  lockMax: 4,

  /**
   * 新規入居の家賃の計上：'full'＝入居時に1期分（設計案）／'quarter'＝入居した四半期から期末までの分（按分）。
   * 四半期は、その会社が出納帳を何行使ったか（行数の1/4ずつ）で決める。継続入居は期首に1期分
   */
  rentMode: 'full',
  /** 市場：法人は相場−2・学生は相場−5で固定、個人は入札（下限は手持ちのプライスカード） */
  corpDisc: 2,
  studDisc: 5,
  priceFloor: 30,
  /** 法人枠：1期の基本の室数 ＋ 法人営業チップ1枚あたりの室数（チップは3枚まで） */
  corpBase: 2,
  corpPerChip: 2,
  corpChipMax: 3,
  /**
   * 個人の入居希望者（卓で共有）：1期あたり「人数 × この数」人。入札で埋まった分だけ減り、0 になったらその期の個人市場は閉じる。
   * null なら上限なし（設計案）。{ 4: 7, 6: 8 } のように人数ごとにも書ける（書いていない人数は一番近い小さい人数の値）
   */
  indivPool: null,
  /** 学生：1期1社4室まで、各期の自分の手番の2回目まで */
  studMax: 4,
  studTurns: 2,
  /** 期末の退去率（種類ごとに 入居室数 × 率 を切り上げ） */
  evict: { corp: 0.1, indiv: 0.25, stud: 0.5 },

  /** チップ単価 */
  adPrice: 10,
  adPerSales: 2, // 広告は営業スタッフ1人につき2枚まで
  adRooms: 2, // 広告1枚で個人市場の1回の契約 ＋2室
  corpChipPrice: 20,
  renoPrice: 30,
  renoMkt: 3, // リノベした棟の相場家賃 ＋3
  renoBid: 2, // 入札では2安いものとして比べる
  lockPrice: 20,
  insPrice: 5,

  /** 管理能力を超えた入居1室あたりのクレーム費用 */
  claimCost: 5,

  /** 借入（製造業MGと同じ）：第2期から。金利5%（借入時に前払い・期首に残高×5%）、枠＝純資産×倍率、期末に残高×返済率を返す */
  loanFrom: 2,
  loanRate: 0.05,
  loanMult: 1,
  repayRate: 0.05,
  /** 期末に現金が足りないときの短期借入の金利（ペナルティ。資金ショートとして数える） */
  shortRate: 0.1,

  /** 法人税（製造業MGの corporateTax と同じ：30%・最低5） */
  taxRate: 0.3,
  minTax: 5,

  /** リスク・チャンスの金額 */
  defectCost: 30,
  lawsuitCost: 20,
  repairCost: 10,
  negotiateCut: 3, // 借上げ賃料の減額交渉に成功したときの1室あたりの減額
  /**
   * リスクカードの重さ：'design'＝設計案どおり／'light'＝山札が1期に何周もする前提で軽くしたもの
   * （1社が1期に約40枚引くので、1枚しかないカードでも1期に約0.7回当たる）
   */
  riskMode: 'design',
}

/**
 * 調整後の数値案。BASE からの差分だけを書く。
 * どの値をなぜ変えたかは docs/sublease-sim.md に書く。
 */
export const TUNED = {
  // 新規入居の家賃・新しく借りた棟の借上げ賃料を四半期で按分する（期の終わりの駆け込み入居で1期分の家賃が入るのを防ぐ）。
  // 期の途中で出ていった入居者は、いまの四半期から期末までの家賃を返す
  rentMode: 'quarter',
  // リスクカードは山札が1期に何周もする前提で軽く（施工不備は半分退去、訴訟は費用だけ）。家賃の滞納は1枚
  riskMode: 'light',
  cardCounts: { arrears: 1 },
  // 借上げ賃料を4下げる（1室の粗利を厚く）
  areas: { city: { own: 28 }, suburb: { own: 24 }, rural: { own: 20 } },
  // 給料の上がり方を緩やかに
  salary: [25, 27, 29, 31, 33],
  // 開始時の物件は営業中（家具8セット・法人2室・個人5室が入居）
  startTenants: { corp: 2, indiv: 5 },
  // 個人の入居希望者は卓で共有（1人あたり5人／期。6人卓は入札の参加で手番が減るので6人）。埋まったらその期の個人市場は閉じる
  indivPool: { 4: 5, 6: 6 },
  // 法人枠の基本を 2 → 3（法人比率を現実に近づけ、法人営業チップだけが強い状態をなくす）
  corpBase: 3,
  // 個人の期末の退去率 25% → 20%
  evict: { indiv: 0.2 },
}

/**
 * 時間制の案（2026-10-07 の要望：1期50〜60分・1手番1〜3分・収入は自分の手番に入る・資本金で1棟充実か2棟まんべんなくかを選べる）。
 * TUNED に重ねる差分。どの値をなぜ変えたかは docs/sublease-sim.md に書く
 */
export const TIME = {
  pace: 'time',
  // 1期の時間：1人あたりの手番がそろうよう人数に比例（約11分×人数）。1人1期あたり約5.5〜5.7手番
  periodMin: { 4: 45, 5: 55, 6: 65 },
  turnMin: [1, 3],
  auctionMin: 1,
  // 手番が少ないので、家具は買ったら部屋に置く・借りるときに家具も買える
  directFurnish: true,
  leaseFurnish: true,
  // 資本金500だけで始め、第1期の前の開業準備で棟を借りて家具を入れる（1棟に8セット／2棟に4セットずつ）
  capital: 500,
  startEmpty: true,
  setupOpening: true,
  startTenants: null,
  // 手番が少ないぶん、1回の入居契約を大きく：営業1人で1回6室まで・法人枠の基本6室・個人の入居希望者は1人あたり10人
  leasePerSales: 6,
  corpBase: 6,
  indivPool: 10,
  // 借上げ賃料をさらに1下げ、本社家賃を15に（第3期にぎりぎり黒字）
  areas: { city: { own: 27 }, suburb: { own: 23 }, rural: { own: 19 } },
  hq: 15,
}

/** 名前から数値のセットを作る（BASE に差分を重ねる。time は TUNED の上に TIME を重ねる） */
export function paramsOf(name = 'base', overrides = {}) {
  let p = structuredClone(BASE)
  if (name === 'tuned' || name === 'time') p = deepMerge(p, TUNED)
  if (name === 'time') p = deepMerge(p, TIME)
  return deepMerge(p, overrides)
}

function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') deepMerge(a[k], v)
    else a[k] = structuredClone(v)
  }
  return a
}
