// サブリース経営MG シミュレーション v2 の数値（2026-10-07 の設計見直し）。
//
// v1（../params.mjs）との違い：
// - 入居者は市場ボードの人駒。都市・郊外・地方のエリアごとに、法人・個人・学生の駒を期首に置く
// - 法人・個人・学生のどれも入札で取る（安い家賃を出した会社が勝つ）
// - 法人は期末の退去なし（法人解約のカードでだけ退去・原状回復なし）。個人は会社ごとのサイコロの出た目の数だけ退去。
//   学生は期末に半分（切り上げ）が退去し、入札に勝つとストッカーから＋1人入れられる
// 数値は v1 の本命（params.mjs の tutorial）を引き継ぎ、入居者まわりだけ作り直している。

export const V2 = {
  capital: 400,
  periods: 5,
  periodMin: { 4: 45, 5: 55, 6: 70 },
  turnMin: [1, 3],
  auctionMin: 1,

  // 借上げ賃料は v1 の本命から −3（2026-10-07：個人の退去が多い v2 で第3期にぎりぎり黒字）
  areas: { city: { n: 6, own: 22, mkt: 50 }, suburb: { n: 10, own: 18, mkt: 45 }, rural: { n: 8, own: 14, mkt: 40 } },
  oldN: 4,
  oldDelta: -4,
  faceUp: 3,
  maxBldg: 6,
  rooms: 8,

  furnPrice: 12,
  furnDep: 3,
  furnMax: 12,
  /** 入居ごとの費用 V と、退去時の原状回復（法人は会社が負担するので 0） */
  V: { indiv: 4, corp: 2, stud: 2 },
  restore: { indiv: 2, stud: 2, corp: 0 },

  salary: [25, 27, 29, 31, 33],
  hireCost: 5,
  hireMax: 3,
  staffMax: 6,
  hq: 10,
  leasePerSales: 6,
  mgmtRooms: 12,
  lockRooms: 6,
  lockMax: 4,

  adPrice: 10,
  adPerSales: 2,
  adRooms: 2,
  // 営業チップ（2026-10-07：法人営業チップから変更）：製造業MGと同じく、入札で1枚につき2低くコールしたものとして比べる。どの種類の入札にも効く
  // 上限なし。期末に2枚以上あれば1枚だけ次の期に残る（製造業MGの商品開発チップと同じ：2026-10-07）
  salesChipPrice: 20,
  salesChipMax: Infinity,
  salesChipBid: 2,
  // リノベ（2026-10-07）：棟に付け、その棟の入居者から入る家賃が1室につき＋2（入居中の部屋にも効く）
  renoPrice: 30,
  renoRent: 2,
  lockPrice: 20,
  insPrice: 5,
  claimCost: 5,

  /** 入札の上限（その棟の相場からの差）と下限 */
  bidCap: { indiv: 0, corp: 0, stud: 0 }, // どの種類も相場まで（入札で決まるので種類ごとの差は付けない：2026-10-07）
  priceFloor: { indiv: 30, corp: 30, stud: 25 },

  /**
   * 市場の人駒：1期あたり「人数 × この数」をエリア・種類ごとに置く（期首に置き直す。売れ残りは市場から去る）。
   * 前の期に退去した個人は、そのエリアの市場に戻る（indivReturn）
   */
  supply: {
    city: { corp: 0.3, indiv: 3, stud: 1.5 },
    suburb: { corp: 1, indiv: 4, stud: 2 },
    rural: { corp: 0.7, indiv: 2, stud: 0.5 },
  },
  indivReturn: true,
  /**
   * 市場の人駒の持ち方：'reset'＝期首に置き直す（売れ残りは去る）／'stock'＝ゲームのはじめ（第2期の期首）に1回だけ置き、
   * 売れ残りは残る。退去した人（個人・学生の卒業・法人の解約）はそのエリアの市場に戻る。法人はカードでしか増えない。
   * 学生は入札に勝つとストッカーから＋2人が加わるので年々増える（2026-10-07）。stockInit は最初に置く数の倍率（supply × 人数 × この数）
   */
  supplyMode: 'stock', // 2026-10-07 決定：ためておく市場
  stockInit: 2,
  /** 法人の人駒を何倍にするか（法人が強すぎるときに減らす） */
  corpSupplyMult: 3, // 法人特化も成り立つように3倍（2026-10-07）
  /** 学生の人駒を何倍にするか */
  studSupplyMult: 1,

  /** 学生：各期の自分の手番の4回目まで（春）。入札に勝つとストッカーから＋2人（空室があれば営業能力を超えてもよい） */
  studTurns: 4, // 春＝各期の自分の手番の4回目まで（2026-10-07）
  studBonus: 2, // 入札に勝つとストッカーから＋2人（2026-10-07）

  /** 期末の退去：個人は会社ごとにサイコロ1回、出た目の数（'full'）か半分（'half'）。学生は半分（切り上げ） */
  indivEvict: 'full',
  /** 法人：期末の退去なし。法人解約のカード（枚数）で退去：'topBuilding'＝法人がいちばん多い棟の法人全部／'half'＝法人の入居者の半分（切り上げ） */
  corpCancelCards: 3,
  corpCancel: 'half', // 法人の入居者の半分（切り上げ）が解約（2026-10-07）
  /** 法人の入札に勝ったあとサイコロを振り、出た目の分だけ家賃が下がる（法人営業チップ1枚ごとに1抑える） */
  corpDice: false,

  loanFrom: 2,
  loanRate: 0.05,
  loanMult: 1,
  repayRate: 0.05,
  shortRate: 0.1,
  taxRate: 0.3,
  minTax: 5,

  deckDecision: 44,
  defectCost: 30,
  lawsuitCost: 20,
  repairCost: 10,

  /** 第1期の台本（tutorial） */
  tutorial: true,
}

export function paramsV2(overrides = {}) {
  return merge(structuredClone(V2), overrides)
}
function merge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') merge(a[k], v)
    else a[k] = structuredClone(v)
  }
  return a
}
