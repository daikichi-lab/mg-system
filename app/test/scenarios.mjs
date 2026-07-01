// mock と TS エンジンの数値一致を検証する共有シナリオ。
// 各シナリオ: { name, capital, loanMult?, repayRate?, periods: [ [ {key,fvals}, ... ], ... ] }
// イベントの動的 fvals（suigai/ibutsu の discard/payout/insuredUsed）は、その時点の盤面から手計算で固定。
export const scenarios = [
  {
    name: '黒字（単期）',
    capital: 300,
    periods: [
      [
        { key: 'kikai', fvals: { n: 1 } },
        { key: 'saiyo', fvals: { mfg: 2, sales: 1, fail: 0 } },
        { key: 'shiire', fvals: { qty: 10, unit: 13 } },
        { key: 'seizo', fvals: { qty: 8 } },
        { key: 'hanbai', fvals: { qty: 8, unit: 50 } },
        { key: 'koukoku', fvals: { n: 1 } },
        { key: 'kaihatsu', fvals: { n: 1, result: '成功' } },
        { key: 'hoken', fvals: { n: 1 } },
        { key: 'kyoiku', fvals: { n: 1 } },
      ],
    ],
  },
  {
    name: '赤字（単期）',
    capital: 300,
    periods: [
      [
        { key: 'kikai', fvals: { n: 1 } },
        { key: 'saiyo', fvals: { mfg: 2, sales: 2, fail: 0 } },
        { key: 'koukoku', fvals: { n: 3 } },
        { key: 'kyoiku', fvals: { n: 1 } },
        { key: 'hoken', fvals: { n: 1 } },
        { key: 'shiire', fvals: { qty: 6, unit: 13 } },
        { key: 'seizo', fvals: { qty: 5 } },
        { key: 'hanbai', fvals: { qty: 5, unit: 28 } },
      ],
    ],
  },
  {
    name: '水害（イベント・保険・材料破棄）',
    capital: 300,
    periods: [
      [
        { key: 'kikai', fvals: { n: 1 } },
        { key: 'saiyo', fvals: { mfg: 1, sales: 1, fail: 0 } },
        { key: 'shiire', fvals: { items: [{ qty: 4, unit: 11 }, { qty: 6, unit: 12 }] } },
        { key: 'seizo', fvals: { qty: 3 } },
        { key: 'hanbai', fvals: { qty: 2, unit: 36 } },
        { key: 'koukoku', fvals: { n: 1 } },
        { key: 'kaihatsu', fvals: { n: 1, result: '成功' } },
        { key: 'hoken', fvals: { n: 1 } },
        // 直前 rawCubes = 10(仕入) - 3(製造) = 7、保険1加入中 → 全材料破棄・保険金70
        { key: 'suigai', fvals: { discard: 7, payout: 70, insuredUsed: 1 } },
      ],
    ],
  },
  {
    name: '異物混入（製品破棄・保険）',
    capital: 300,
    periods: [
      [
        { key: 'kikai', fvals: { n: 1 } },
        { key: 'saiyo', fvals: { mfg: 2, sales: 1, fail: 0 } },
        { key: 'shiire', fvals: { qty: 5, unit: 13 } },
        { key: 'seizo', fvals: { qty: 5 } },
        { key: 'hoken', fvals: { n: 1 } },
        // products=5、保険1 → 製品2破棄・保険金20
        { key: 'ibutsu', fvals: { discard: 2, payout: 20, insuredUsed: 1 } },
        { key: 'hanbai', fvals: { qty: 3, unit: 40 } },
      ],
    ],
  },
  {
    name: 'スタッフ退職（期末半額給料）',
    capital: 300,
    periods: [
      [
        { key: 'kikai', fvals: { n: 1 } },
        { key: 'saiyo', fvals: { mfg: 2, sales: 1, fail: 0 } },
        { key: 'taishoku_mfg', fvals: {} },
        { key: 'shiire', fvals: { items: [{ qty: 4, unit: 11 }, { qty: 6, unit: 12 }] } },
        { key: 'seizo', fvals: { qty: 3 } },
        { key: 'hanbai', fvals: { qty: 3, unit: 36 } },
      ],
    ],
  },
  {
    name: '販売機会イベント（開発成功・独占）',
    capital: 300,
    periods: [
      [
        { key: 'kikai', fvals: { n: 1 } },
        { key: 'saiyo', fvals: { mfg: 1, sales: 2, fail: 0 } },
        { key: 'koukoku', fvals: { n: 1 } },
        { key: 'kaihatsu', fvals: { n: 1, result: '成功' } },
        { key: 'shiire', fvals: { qty: 8, unit: 13 } },
        { key: 'seizo', fvals: { qty: 6 } },
        { key: 'hanbai', fvals: { qty: 2, unit: 50 } },
        { key: 'kaihatsu_win', fvals: { qty: 2 } },
        { key: 'dokusen', fvals: { qty: 2, unit: 45 } },
      ],
    ],
  },
  {
    name: '3期通し（繰越・借入・金利・返済）',
    capital: 300,
    loanMult: 2,
    repayRate: 20,
    periods: [
      [
        { key: 'kikai', fvals: { n: 1 } },
        { key: 'saiyo', fvals: { mfg: 2, sales: 1, fail: 0 } },
        { key: 'shiire', fvals: { qty: 10, unit: 13 } },
        { key: 'seizo', fvals: { qty: 8 } },
        { key: 'hanbai', fvals: { qty: 8, unit: 50 } },
        { key: 'kyoiku', fvals: { n: 1 } },
      ],
      [
        { key: 'kariire', fvals: { a: 100 } },
        { key: 'kikai', fvals: { n: 1 } },
        { key: 'saiyo', fvals: { mfg: 1, sales: 1, fail: 0 } },
        { key: 'shiire', fvals: { qty: 12, unit: 12 } },
        { key: 'seizo', fvals: { qty: 12 } },
        { key: 'hanbai', fvals: { qty: 12, unit: 48 } },
        { key: 'kyoiku', fvals: { n: 1 } },
      ],
      [
        { key: 'saiyo', fvals: { mfg: 1, sales: 0, fail: 0 } },
        { key: 'shiire', fvals: { qty: 10, unit: 11 } },
        { key: 'seizo', fvals: { qty: 14 } },
        { key: 'hanbai', fvals: { qty: 14, unit: 46 } },
      ],
    ],
  },
]
