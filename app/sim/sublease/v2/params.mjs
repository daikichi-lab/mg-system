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
  /**
   * 1人が1期に打つ手番の目安（本番のMGの記帳データ 2026-10：第1期 中央値11・第2期 15・第3期 24）。
   * これを渡すと、1期の時間（periodTotalMin 分）÷（人数 × 手番）を1手番の平均時間にし（±50%でばらつく）、入札の分の時間は足さない。
   * null なら turnMin（1〜3分）と人数ごとの periodMin を使う
   */
  turnsPerPeriod: { 2: 15, default: 24 },
  periodTotalMin: 45,

  // 借上げ賃料は v1 の本命から −3（2026-10-07：個人の退去が多い v2 で第3期にぎりぎり黒字）
  // 本番の手番の数（第2期15・第3期以降24）に合わせて 都市27・郊外23・地方19（2026-10-07）
  // 2026-10-07：立地ごとの部屋数・市場の人の移動カードに合わせて 都市25・郊外21・地方17
  // 2026-10-08：営業・管理をエリア配属・営業所の家賃をエリアごとにしたので 都市24・郊外20・地方16（切りのよい数）
  // 2026-10-08：入居費用・原状回復を一律5に上げたので 借上げ賃料 都市20・郊外16・地方10、地方の相場は 40 → 35
  areas: { city: { n: 6, own: 20, mkt: 50 }, suburb: { n: 10, own: 16, mkt: 45 }, rural: { n: 8, own: 10, mkt: 35 } },
  oldN: 4,
  oldDelta: -4,
  faceUp: 3,
  maxBldg: 6,
  rooms: 8,
  /** 立地ごとの部屋数（都市は狭く、地方は広い）。null なら全部 rooms（8室）。第1期に全員が借りる郊外の棟は8室のまま */
  roomsByArea: { city: 6, suburb: 8, rural: 10 }, // 都市は狭く、地方は広い（2026-10-07）

  furnPrice: 12,
  furnDep: 3,
  furnMax: 12,
  /** 入居ごとの費用 V と、退去時の原状回復（法人は会社が負担するので 0） */
  // 2026-10-08：一律5（入居費用は家賃の約1か月分の広告料・清掃・鍵交換、原状回復は約1か月分のクリーニング・補修）。法人の原状回復は法人が負担するので0
  V: { indiv: 5, corp: 5, stud: 5 },
  restore: { indiv: 5, stud: 5, corp: 0 },

  salary: [25, 27, 29, 31, 33],
  hireCost: 5,
  hireMax: 3,
  staffMax: 6,
  hq: 10,
  leasePerSales: 2, // 営業1人で1回2室（製造業MGの販売能力と同じ：2026-10-07）
  /** 営業スタッフをエリアに配属する（2026-10-08 案）：そのエリアの入札でしか使えない。配置転換（ルールB）は1人5。上限はエリアごとに staffMax */
  salesByArea: true,
  transferCost: 5,
  /** 管理スタッフもエリアに配属する（2026-10-08）：管理能力はエリアごと（そのエリアの入居者だけ管理できる）。スマートロックも付けたエリアだけに効く */
  mgmtByArea: true,
  /** スタッフ（営業・管理）がいるエリアごとに営業所の家賃 officeRent がかかる（本社家賃 hq の代わり。2026-10-08） */
  officeByArea: true,
  officeRent: 10,
  mgmtRooms: 12,
  lockRooms: 6,
  lockMax: 4,
  /** 管理能力を超えては入居させられない（2026-10-07 案）。false なら今まで通り期末に超えた分が退去 */
  mgmtHardCap: true,

  adPrice: 10,
  adPerSales: 2,
  adRooms: 2,
  // 営業チップ（2026-10-07：法人営業チップから変更）：製造業MGと同じく、入札で1枚につき2低くコールしたものとして比べる。どの種類の入札にも効く
  // 上限なし。期末に2枚以上あれば1枚だけ次の期に残る（製造業MGの商品開発チップと同じ：2026-10-07）
  salesChipPrice: 20,
  salesChipMax: Infinity,
  salesChipBid: 2,
  // リノベ（2026-10-07）：棟に付け、その棟の入居者から入る家賃が1室につき＋2（入居中の部屋にも効く）
  renoPrice: 60, // 家賃＋2 の回収が早すぎたので 30 → 60（2026-10-07）
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
  // 都市は個人が多め・郊外は学生が多め・地方は法人が多め（2026-10-07。法人は corpSupplyMult 倍）
  supply: {
    city: { corp: 0.2, indiv: 4, stud: 1 },
    suburb: { corp: 0.5, indiv: 2.5, stud: 3 },
    rural: { corp: 1, indiv: 1.5, stud: 0.5 },
  },
  indivReturn: true,
  /**
   * 市場の人駒の持ち方：'reset'＝期首に置き直す（売れ残りは去る）／'stock'＝ゲームのはじめ（第2期の期首）に1回だけ置き、
   * 売れ残りは残る。退去した人（個人・学生の卒業・法人の解約）はそのエリアの市場に戻る。法人はカードでしか増えない。
   * 学生は入札に勝つとストッカーから＋2人が加わるので年々増える（2026-10-07）。stockInit は最初に置く数の倍率（supply × 人数 × この数）
   */
  supplyMode: 'stock', // 2026-10-07 決定：ためておく市場
  stockInit: 0.7, // 2026-10-08：0.8 → 0.7
  /** 法人は毎期少しずつ市場に出てくる（2026-10-07）：期首に supply.corp × 人数 × この数 を足す（第3期以降。第2期は最初に置く分がある） */
  corpInflow: 2,
  /** 退去した個人のうち、そのエリアの市場に戻る割合（残りは他社の物件や持ち家へ移り、ゲームから去る） */
  indivReturnRate: 1,
  /** 法人の人駒を何倍にするか（法人が強すぎるときに減らす） */
  corpSupplyMult: 2, // 3倍 → 2倍（2026-10-08：法人を減らす）
  /** 学生の人駒を何倍にするか */
  studSupplyMult: 1,

  /** 学生：各期の自分の手番の4回目まで（春）。入札に勝つとストッカーから＋2人（空室があれば営業能力を超えてもよい） */
  studTurns: 4, // 春＝各期の自分の手番の4回目まで（2026-10-07）
  studBonus: 2, // 入札に勝つとストッカーから＋2人（2026-10-07）

  /** 期末の退去：個人は会社ごとにサイコロ1回、出た目の数（'full'）か半分（'half'）。学生は半分（切り上げ） */
  indivEvict: 'full',
  /** 法人：期末の退去なし。法人解約のカード（枚数）で退去：'topBuilding'＝法人がいちばん多い棟の法人全部／'half'＝法人の入居者の半分（切り上げ） */
  corpCancelCards: 1, // 手番が多くカードもよく引くので1枚（2026-10-07）
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
  /** 市場の人の移動・追加のカード（地方創生・リモートワーク・大学の新設・都心の再開発）を山札に入れる */
  moveCards: true,
  defectCost: 30,
  lawsuitCost: 20,
  repairCost: 10,

  /** 自動プレイヤー：'smart'＝打てる手を毎回比べる・戦い方は会社ごとにランダム（2026-10-08）／'persona'＝4つの性格の決め打ち（それまでの方式） */
  bot: 'smart',
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
