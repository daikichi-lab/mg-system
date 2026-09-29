// 経営計画書（lib/plan.ts）の計算の検証。仕様は docs/仕様書.md §5.1。
// 単価はすべて数値ルールと記帳アクションから引くので、ルールを差し替えたときに追従することも見る。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newState, setRules, corporateTax, type Result, type St } from '../src/lib/calc.ts'
import {
  defaultPlan,
  normalizePlan,
  fixedCosts,
  planFigures,
  cashPlan,
  breakEvenG,
  actionNeeds,
  actionAmount,
  capacityCompare,
  cashNeeds,
  actionQtyMax,
  rankGap,
  clampQty,
  defaultQty,
  planLocked,
  planVsActual,
  stateAtPeriod,
  PLAN_ROWS,
  PLAN_ACTION_KEYS,
} from '../src/lib/plan.ts'

const reset = () => setRules(null)

// 第3期の期首：製造2・販売2・機械1・借入残高100（返済率10%）・現金252、期首の自動行（納税26・金利5）
function st3(): St {
  const st = newState()
  st.period = 3
  st.openingStaffMfg = 2
  st.openingStaffSales = 2
  st.openingMachines = 1
  st.openingLoan = 100
  st.loan = 100 // 記帳前の盤面。アプリでは recompute() が期首残高から組み直す
  st.repayRate = 10
  st.openingCash = 252
  st.tx = [
    { id: 1, label: '法人税納付(期首)', col: 10, amount: 26, isOpeningTax: true },
    { id: 2, label: '支払金利(期首)', col: 8, amount: 5, isOpeningInterest: true },
  ]
  return st
}

test('defaultPlan：投資と単価は未記入（0）、行数は 25。現況は Plan に持たない', () => {
  const p = defaultPlan()
  assert.equal(p.g, 0)
  assert.equal(p.hireMfg, 0)
  assert.equal(p.hireSales, 0)
  assert.equal(p.machinesNew, 0)
  assert.equal(p.p, 0)
  assert.equal(p.actions.length, PLAN_ROWS)
  assert.equal('staffMfg' in p, false)
})

test('固定費：現況は期首の盤面から（給料・減価償却・家賃・期首金利）、新規は入力から（採用費＋採用者の給料・機械の減価償却・チップ・新規借入金利）', () => {
  const st = st3()
  const plan = { ...defaultPlan(), hireMfg: 1, machinesNew: 1, edu: 1, ins: 1, ads: 2, dev: 1, loanNew: 100 }
  const fc = fixedCosts(plan, st)
  // 現況：給料 31×4人（製造・販売をまとめて人件費1行）、減価償却 10×1、家賃 25、期首残高 100×5% ＝ 5
  assert.equal(fc.now, 31 * 4 + 10 + 25 + 5)
  // 新規：採用費 5×1 ＋ 採用者の給料 31×1、機械購入の減価償却 10×1、教育 20、保険 5、広告 10×2、商品開発 20、新規借入 100×5% ＝ 5
  assert.equal(fc.next, 5 + 31 + 10 + 20 + 5 + 20 + 20 + 5)
  assert.equal(fc.total, fc.now + fc.next)
  // 表示用の内訳文に単価と数量が入る
  assert.equal(fc.items.find((x) => x.key === 'ads')?.detail, '10 × 2枚')
  assert.equal(fc.items.find((x) => x.key === 'salary')?.label, '人件費')
  assert.equal(fc.items.find((x) => x.key === 'salary')?.detail, '現在雇用しているスタッフ 4人 × 給料 31')
  assert.equal(fc.items.filter((x) => x.col === 'now' && x.label === '労務費').length, 0)
  // 表示用の単価
  assert.deepEqual(fc.units, { sal: 31, dep: 10, hire: 5, edu: 20, ins: 5, ads: 10, dev: 20, ratePct: 5 })
  reset()
})

test('図：MQ＝G＋F、M＝P−V、Q は切り上げ、PQ・VQ はその個数で', () => {
  const st = st3()
  const plan = { ...defaultPlan(), g: 100, p: 32, v: 12 }
  const f = planFigures(plan, st)
  assert.equal(f.F, 31 * 4 + 10 + 25 + 5) // 164
  assert.equal(f.MQ, 264)
  assert.equal(f.M, 20)
  assert.equal(f.Q, 14) // 264 ÷ 20 ＝ 13.2 → 14
  assert.equal(f.PQ, 32 * 14)
  assert.equal(f.VQ, 12 * 14)
  reset()
})

test('図：粗利単価 M が 0 以下なら Q・PQ・VQ は計算不能（null）', () => {
  const st = st3()
  const f = planFigures({ ...defaultPlan(), g: 100, p: 12, v: 12 }, st)
  assert.equal(f.M, 0)
  assert.equal(f.Q, null)
  assert.equal(f.PQ, null)
  assert.equal(f.VQ, null)
  reset()
})

test('ルール差し替えに追従：家賃・給料表・減価償却・金利を変えると固定費が変わる', () => {
  setRules({ rent: 40, salaryTable: [20, 20, 20], depPerMachine: 15, loanRate: 0.1 })
  const st = st3()
  const fc = fixedCosts({ ...defaultPlan(), loanNew: 50 }, st)
  // 現況：給料 20×4、減価償却 15、家賃 40、期首金利 100×10% ＝ 10
  assert.equal(fc.now, 80 + 15 + 40 + 10)
  // 新規：新規借入 50×10% ＝ 5
  assert.equal(fc.next, 5)
  reset()
})

test('アクションプラン：前期繰越 → 期首処理 → 各行 の順に現金残高を累計する（期末処理は載せない）', () => {
  const st = st3()
  const plan = defaultPlan()
  plan.actions[0] = { key: 'shiire', qty: 5, amount: -50 }
  plan.actions[1] = { key: 'hanbai', qty: 3, amount: 80 }
  const c = cashPlan(plan, st)
  assert.equal(c.openingCash, 252)
  assert.equal(c.openingAuto, -(26 + 5)) // 期首の自動行（納税＋金利）
  assert.equal(c.rows[0].balance, 252 - 31 - 50)
  assert.equal(c.rows[1].balance, 252 - 31 - 50 + 80)
  assert.equal(c.rows[PLAN_ROWS - 1].balance, 251) // 空行は残高を変えない
  // 期末処理（給料・家賃・元本返済）はアクションプランには載せない
  assert.equal('closingAuto' in c, false)
  assert.equal('endBalance' in c, false)
  reset()
})

test('必要なアクション回数：Q と能力（期首の盤面＋今期の投資）から逆算する', () => {
  const st = st3() // 製造2・販売2・機械1・期首在庫なし
  // G100・P32・V12 → Q＝14個（'図' のテストと同じ）。投資なし
  const nd = actionNeeds({ ...defaultPlan(), g: 100, p: 32, v: 12 }, st)
  const of = (k: string) => nd.find((x) => x.key === k)!
  // 製造能力 min(2, 1台×2)×2 ＝ 4個/回 → 14個で 4回。販売能力 2人×2 ＝ 4個/回 → 4回。仕入は在庫上限 15 → 1回
  assert.equal(of('shiire').need, 1)
  assert.equal(of('seizo').need, 4)
  assert.equal(of('hanbai').need, 4)
  assert.equal(of('seizo').detail, '14個 ÷ 製造能力 4個')
  // 投資が無いので採用・機械購入などの行は出さない
  assert.equal(nd.length, 3)
  reset()
})

test('必要なアクション回数：採用（製造・販売）・機械・教育・広告は能力に効く。投資そのものの回数も出す', () => {
  const st = st3()
  const plan = { ...defaultPlan(), g: 100, p: 32, v: 12, hireMfg: 2, hireSales: 1, machinesNew: 1, edu: 1, ads: 2, dev: 2, ins: 1, loanNew: 50 }
  const nd = actionNeeds(plan, st)
  const of = (k: string) => nd.find((x) => x.key === k)!
  // 製造能力 min(製造2＋採用2, 機械2台×2)×3(教育あり) ＝ 12個/回、
  // 販売能力 (2＋採用1)人×2 ＋ min(広告2, 6)×2 ＝ 10個/回
  assert.equal(of('seizo').detail.endsWith('÷ 製造能力 12個'), true)
  assert.equal(of('hanbai').detail.endsWith('÷ 販売能力 10個'), true)
  // 1回の記帳でまとめられるものは1回、教育・商品開発は1回1枚なので枚数ぶん
  assert.equal(of('saiyo').need, 1)
  assert.equal(of('saiyo').detail, '製造 2人・販売 1人（1回でまとめて実施）')
  assert.equal(of('kikai').need, 1)
  assert.equal(of('koukoku').need, 1)
  assert.equal(of('hoken').need, 1)
  assert.equal(of('kyoiku').need, 1)
  assert.equal(of('kaihatsu').need, 2)
  assert.equal(of('kariire').need, 1)
  reset()
})

test('必要なアクション回数：期首在庫は仕入・製造の必要量から引く。Q が出せなければ回数も出さない', () => {
  const st = st3()
  st.openingMatQty = 6 // 期首在庫 6個（うち製品 4個）
  st.openingProducts = 4
  const nd = actionNeeds({ ...defaultPlan(), g: 100, p: 32, v: 12 }, st)
  const of = (k: string) => nd.find((x) => x.key === k)!
  assert.equal(of('shiire').detail, '8個 ÷ 在庫上限 15個') // 14 − 6
  assert.equal(of('seizo').detail, '10個 ÷ 製造能力 4個') // 14 − 4
  // 粗利単価 M が 0 以下なら Q が出ないので回数も null
  const none = actionNeeds({ ...defaultPlan(), g: 100, p: 12, v: 12 }, st)
  assert.deepEqual(none.map((x) => x.need), [null, null, null])
  reset()
})

test('必要なアクション回数：計画に入れた回数を数える。能力が 0 なら何回やっても届かないので null', () => {
  const st = st3()
  const plan = { ...defaultPlan(), g: 100, p: 32, v: 12 }
  plan.actions[0] = { key: 'hanbai', qty: 1, amount: 32 }
  plan.actions[1] = { key: 'hanbai', qty: 1, amount: 32 }
  assert.equal(actionNeeds(plan, st).find((x) => x.key === 'hanbai')!.planned, 2)
  // 販売スタッフが 0 人なら販売能力 0 → 必要回数は計算不能
  st.openingStaffSales = 0
  assert.equal(actionNeeds(plan, st).find((x) => x.key === 'hanbai')!.need, null)
  reset()
})

test('プルダウンの選択肢：参加者が選べる記帳アクション（ルールA・B）だけ。イベントは入れない', () => {
  assert.equal(PLAN_ACTION_KEYS.includes('shiire'), true)
  assert.equal(PLAN_ACTION_KEYS.includes('hensai'), true)
  assert.equal(PLAN_ACTION_KEYS.includes('tokubai'), false) // イベント（ルールX）
})

test('アクションプランの金額：数量から、記帳と同じ式で自動で出す（入金は＋・出金は−）', () => {
  const plan = { ...defaultPlan(), p: 32, v: 12 }
  // 仕入れは売上原価 V、販売は販売単価 P を単価に使う
  assert.equal(actionAmount('shiire', 5, plan), -60)
  assert.equal(actionAmount('hanbai', 4, plan), 128)
  // 現金が動かないもの（製造）は 0
  assert.equal(actionAmount('seizo', 5, plan), 0)
  // 単価が決まっているものは記帳と同じ額
  assert.equal(actionAmount('kikai', 1, plan), -100) // 機械 1台
  assert.equal(actionAmount('saiyo', 2, plan), -10) // 採用 5×2人
  assert.equal(actionAmount('koukoku', 2, plan), -20) // 広告 10×2枚
  assert.equal(actionAmount('kaihatsu', 1, plan), -20)
  assert.equal(actionAmount('kyoiku', 1, plan), -20)
  assert.equal(actionAmount('hoken', 3, plan), -15)
  assert.equal(actionAmount('haichi', 1, plan), -5)
  // 借入・返済は数量がそのまま金額
  assert.equal(actionAmount('kariire', 100, plan), 100)
  assert.equal(actionAmount('hensai', 30, plan), -30)
  // 未選択は 0
  assert.equal(actionAmount('', 5, plan), 0)
  reset()
})

test('アクションプランの金額：数値ルールを差し替えると自動金額も追従する', () => {
  setRules({ machinePrice: 150 })
  assert.equal(actionAmount('kikai', 2, { ...defaultPlan() }), -300)
  reset()
})

test('数量の初期値：借入・返済は金額なので 0、それ以外は1回分の 1。未選択は 0', () => {
  assert.equal(defaultQty('shiire'), 1)
  assert.equal(defaultQty('kyoiku'), 1)
  assert.equal(defaultQty('kariire'), 0)
  assert.equal(defaultQty('hensai'), 0)
  assert.equal(defaultQty(''), 0)
})

test('数量の上限：記帳のバリデーションと同じ根拠（在庫上限・能力・1回1枚・借入枠）', () => {
  const st = st3() // 製造2・販売2・機械1・借入100
  const plan = { ...defaultPlan(), p: 32, v: 12 }
  // 仕入れは材料在庫の上限 15、製造は製造能力 min(2, 1台×2)×2 ＝ 4 と店舗陳列 15 の小さいほう、販売は販売能力 2人×2 ＝ 4
  assert.equal(actionQtyMax('shiire', plan, st), 15)
  assert.equal(actionQtyMax('seizo', plan, st), 4)
  assert.equal(actionQtyMax('hanbai', plan, st), 4)
  // 教育・商品開発は1回1枚
  assert.equal(actionQtyMax('kyoiku', plan, st), 1)
  assert.equal(actionQtyMax('kaihatsu', plan, st), 1)
  // 配置転換はスタッフ数まで、返済は借入残高まで
  assert.equal(actionQtyMax('haichi', plan, st), 2)
  assert.equal(actionQtyMax('hensai', plan, st), 100)
  // 借入は今期借入可能額（純資産×倍率 − 残高）まで
  assert.equal(actionQtyMax('kariire', plan, st), 0) // 純資産0・倍率0 のテスト盤面では枠なし
  // 上限が無いもの
  assert.equal(actionQtyMax('kikai', plan, st), null)
  assert.equal(actionQtyMax('saiyo', plan, st), null)
  assert.equal(actionQtyMax('koukoku', plan, st), null)
  assert.equal(actionQtyMax('hoken', plan, st), null)
  reset()
})

test('数量の上限：機械購入・教育を計画に入れると製造能力が上がり、上限も上がる', () => {
  const st = st3()
  const plan = { ...defaultPlan(), machinesNew: 1, edu: 1 }
  // 製造能力 min(製造2, 機械2台×2)×3(教育あり) ＝ 6
  assert.equal(actionQtyMax('seizo', plan, st), 6)
  reset()
})

test('clampQty：上限を超えた数量は上限まで、マイナスは 0 に丸める', () => {
  const st = st3()
  const plan = { ...defaultPlan() }
  assert.equal(clampQty('kaihatsu', 5, plan, st), 1)
  assert.equal(clampQty('shiire', 99, plan, st), 15)
  assert.equal(clampQty('kikai', 99, plan, st), 99) // 上限なしはそのまま
  assert.equal(clampQty('shiire', -3, plan, st), 0)
  reset()
})

test('normalizePlan：教育の枚数は最大1枚に収める', () => {
  assert.equal(normalizePlan({ edu: 5 }).edu, 1)
})

test('1位との差：純資産が1番多い他社との差と、それを埋めるのに必要な経常利益', () => {
  const st = st3() // 自社は資本金0・利益剰余金0 → 純資産 0
  const cs = [
    { name: 'じぶん', results: [{ capEnd: 300, retEnd: 50 }] },
    { name: 'A社', results: [{ capEnd: 300, retEnd: 20 }] },
    { name: 'B社', results: [{ capEnd: 300, retEnd: 100 }] }, // 純資産 400 で1位
    { name: 'C社', results: [] }, // 決算がまだ無い会社は対象外
  ]
  st.name = 'じぶん'
  const r = rankGap(st, cs)!
  assert.equal(r.topName, 'B社')
  assert.equal(r.topEquity, 400)
  assert.equal(r.myEquity, 0)
  assert.equal(r.gap, 400)
  // 税引後 400 を残す最小の G（法人税30%・最低5）
  assert.equal(r.g! - corporateTax(r.g!, st.retained) >= 400, true)
  assert.equal(r.g! - 1 - corporateTax(r.g! - 1, st.retained) >= 400, false)
  reset()
})

test('1位との差：自社が1位なら必要額は出さない。他社の決算が無ければ目安そのものを出さない', () => {
  const st = st3()
  st.name = 'じぶん'
  st.openingCapital = 500 // 自社の純資産 500
  const top = rankGap(st, [{ name: 'A社', results: [{ capEnd: 300, retEnd: 20 }] }])!
  assert.equal(top.gap, -180)
  assert.equal(top.g, null)
  // 決算がまだ無い／自分しかいない
  assert.equal(rankGap(st, [{ name: 'A社', results: [] }]), null)
  assert.equal(rankGap(st, [{ name: 'じぶん', results: [{ capEnd: 1, retEnd: 1 }] }]), null)
  reset()
})

test('記帳を始めたら計画は変更できない。期首処理の自動行だけなら変更できる', () => {
  const st = st3() // 期首の自動行（法人税納付・支払金利）だけがある状態
  assert.equal(planLocked(st), false)
  // 資本金の行（第1期の会社作成）も記帳には数えない
  st.tx.push({ id: 9, label: '資本金', col: 0, amount: 300, isCapital: true })
  assert.equal(planLocked(st), false)
  // アクションを1件でも記帳したら固定
  st.tx.push({ id: 10, key: 'shiire', label: '仕入れ', col: 5, amount: 60 })
  assert.equal(planLocked(st), true)
  reset()
})

test('記帳が無くても、期末処理や決算まで進んだ期は計画を変更できない', () => {
  const a = st3()
  a.closingPrep = true
  assert.equal(planLocked(a), true)
  const b = st3()
  b.settled = true
  assert.equal(planLocked(b), true)
  reset()
})

// 計画と実績の差に使う、最小限の決算結果
function res(period: number, over: Partial<Result> = {}): Result {
  return {
    period,
    Q: 0, PQ: 0, vPQ: 0, mPQ: 0, F: 0, G: 0, net: 0, tax: 0,
    capStart: 0, capEnd: 0, retEnd: 0, cashEnd: 0, endInvQty: 0, endInvVal: 0, prodEnd: 0,
    equipEnd: 0, machines: 0, staffMfg: 0, staffSales: 0, loanEnd: 0, dev: 0, ads: 0,
    loanMult: 2, repayRate: 10, openInterest: 0, laborF: 0, sellF: 0, adminF: 0, depF: 0,
    loanRepay: 0, name: '', president: '', colTot: [], rows: [],
    ...over,
  } as unknown as Result
}

test('計画と実績の差：計画と決算の両方がある期だけ、実績−計画を出す', () => {
  const st = newState()
  st.period = 4
  // 第2期の決算（＝第3期の期首）：製造2・販売2・機械1・借入100・現金252
  const r2 = res(2, {
    staffMfg: 2, staffSales: 2, machines: 1, loanEnd: 100, cashEnd: 252,
    capEnd: 0, retEnd: 0, endInvQty: 0, prodEnd: 0, equipEnd: 100, tax: 0,
  } as Partial<Result>)
  const r3 = res(3, { Q: 12, PQ: 396, vPQ: 144, mPQ: 252, F: 306, G: -54 } as Partial<Result>)
  const plans = { '3': { g: 34, p: 32, v: 12 } }
  const [c] = planVsActual([r2, r3], plans, st)
  assert.equal(c.period, 3)
  const of = (k: string) => c.items.find((x) => x.key === k)!
  // 計画：F は第3期の期首の盤面から（給料31×4人＋減価償却10×1台＋家賃25＋期首金利100×5% ＝ 164）
  assert.equal(of('F').plan, 164)
  assert.equal(of('F').actual, 306)
  assert.equal(of('F').diff, 142)
  assert.equal(of('F').ok, false) // 固定費は計画より多いと×
  // Q＝⌈(34＋164)÷(32−12)⌉＝10 個の計画に対し実績 12 個
  assert.equal(of('Q').plan, 10)
  assert.equal(of('Q').diff, 2)
  assert.equal(of('Q').ok, true)
  // 売上は計画 32×10 を超えたので○、売上原価は計画 12×10 を超えたので×（少ないほうが良い）
  assert.deepEqual([of('PQ').plan, of('PQ').diff, of('PQ').ok], [320, 76, true])
  assert.deepEqual([of('VQ').plan, of('VQ').diff, of('VQ').ok], [120, 24, false])
  // 経常利益は計画 36 に対し実績 ▲54
  assert.deepEqual([of('G').plan, of('G').diff, of('G').ok], [36, -90, false])
  // 1個あたりの単価。実績は決算の合計から割り戻す（PQ396÷12個＝33、vPQ144÷12個＝12）
  assert.deepEqual([of('P').plan, of('P').actual, of('P').ok], [32, 33, true])
  assert.deepEqual([of('V').plan, of('V').actual, of('V').ok], [12, 12, true])
  // 計画が無い期・決算が無い期は出さない
  assert.equal(planVsActual([r2, r3], {}, st).length, 0)
  assert.equal(planVsActual([r2], plans, st).length, 0)
  reset()
})

test('計画と実績の差：アクションプランの回数を、計画と決算に残った記帳行で比べる', () => {
  const st = newState()
  st.period = 4
  const r2 = res(2, { staffMfg: 2, staffSales: 2, machines: 1 } as Partial<Result>)
  const r3 = res(3, {
    Q: 4, PQ: 120, vPQ: 48, mPQ: 72, F: 100, G: -28,
    rows: [
      { id: 1, key: 'shiire', amount: 48 },
      { id: 2, key: 'seizo', amount: 0 },
      { id: 3, key: 'hanbai', amount: 120 },
      { id: 4, key: 'suigai', amount: 0 }, // イベントは数えない
      { id: 5, label: '給料', amount: 124 }, // 期末処理の自動行も数えない
      { id: 6, key: 'koukoku', amount: 10 }, // 計画に無いが実施したもの
    ],
  } as Partial<Result>)
  // 計画：仕入れ1回・販売2回・製造1回
  const plans = {
    '3': {
      g: 30, p: 30, v: 12,
      actions: [
        { key: 'shiire', qty: 5, amount: -60 },
        { key: 'seizo', qty: 5, amount: 0 },
        { key: 'hanbai', qty: 2, amount: 60 },
        { key: 'hanbai', qty: 2, amount: 60 },
      ],
    },
  }
  const [c] = planVsActual([r2, r3], plans, st)
  const of = (k: string) => c.actions.find((x) => x.key === k)!
  assert.deepEqual([of('shiire').plan, of('shiire').actual, of('shiire').diff], [1, 1, 0])
  assert.deepEqual([of('seizo').plan, of('seizo').actual, of('seizo').diff], [1, 1, 0])
  assert.deepEqual([of('hanbai').plan, of('hanbai').actual, of('hanbai').diff], [2, 1, -1])
  assert.deepEqual([of('koukoku').plan, of('koukoku').actual, of('koukoku').diff], [0, 1, 1]) // 計画外の実施も出す
  assert.equal(c.actions.find((x) => x.key === 'suigai'), undefined)
  reset()
})

test('計画と実績の差：単価が未記入で個数が出ていない計画は比べない', () => {
  const st = newState()
  st.period = 4
  const r2 = res(2, { staffMfg: 1, staffSales: 1, machines: 1 } as Partial<Result>)
  const r3 = res(3, { Q: 5, PQ: 100 } as Partial<Result>)
  assert.equal(planVsActual([r2, r3], { '3': { g: 100 } }, st).length, 0)
  reset()
})

test('過去の期の盤面：第1期は前の期が無いので、期首の値がすべて 0 の盤面を返す', () => {
  const st = newState()
  st.period = 3
  const a = stateAtPeriod(1, [], st)!
  assert.equal(a.period, 1)
  assert.equal(a.openingStaffMfg, 0)
  assert.equal(a.openingCapital, 0)
  assert.equal(a.openingLoan, 0)
  // 第2期以降は前の期の決算が要る
  assert.equal(stateAtPeriod(3, [], st), null)
  reset()
})

test('normalizePlan：古い保存値（採用の製造/販売分け・自由記入の text）を今の形に読み替える', () => {
  const p = normalizePlan({ hireMfg: 2, hireSales: 1, actions: [{ text: '仕入れ', amount: -50 }, { text: '仕入 5個', amount: -50 }] })
  assert.equal(p.hireMfg, 2) // 製造・販売に分けて保存された計画はそのまま
  assert.equal(p.hireSales, 1)
  // 合計（hire）だけを保存していた時期の計画は、製造の採用として読む
  const old = normalizePlan({ hire: 3 })
  assert.deepEqual([old.hireMfg, old.hireSales], [3, 0])
  assert.equal(p.actions[0].key, 'shiire')
  assert.equal(p.actions[1].key, '') // 一致しない自由記入は未選択
})

test('normalizePlan：壊れた保存値は初期値で埋め、行数は 25 に揃える', () => {
  assert.deepEqual(normalizePlan(null), defaultPlan())
  assert.deepEqual(normalizePlan('x'), defaultPlan())
  const p = normalizePlan({
    g: 100,
    hireMfg: 'a',
    machinesNew: 2.4,
    actions: [{ key: 'shiire', qty: 5, amount: -50 }, { key: 'nope', amount: 3 }, { key: 5 }],
  })
  assert.equal(p.g, 100)
  assert.equal(p.hireMfg, 0) // 型崩れは 0
  assert.equal(p.machinesNew, 2) // 人数・台数は整数に丸める
  assert.equal(p.actions.length, PLAN_ROWS)
  assert.deepEqual(p.actions[0], { key: 'shiire', qty: 5, amount: -50 })
  assert.deepEqual(p.actions[1], { key: '', qty: 0, amount: 3 }) // 知らないキーは未選択に
  assert.deepEqual(p.actions[2], { key: '', qty: 0, amount: 0 })
})

test('G の目安：期首の利益剰余金がマイナスなら、税引後でゼロへ戻す最小の G（＝赤字＋最低税額 5）。プラスなら出さない', () => {
  const st = st3()
  st.retained = -130
  const g = breakEvenG(st)
  assert.equal(g, 135) // 繰越損失があるので課税は赤字を埋めた残り 5 だけ → 最低税額 5 → 税引後 130
  assert.equal(corporateTax(g!, st.retained), 5)
  assert.equal(g! - corporateTax(g!, st.retained), 130)
  // 1 少ないと届かない
  assert.ok(134 - corporateTax(134, st.retained) < 130)
  st.retained = 0
  assert.equal(breakEvenG(st), null)
  st.retained = 61
  assert.equal(breakEvenG(st), null)
})

test('corporateTax：決算と同じ式（30%・最低 5・繰越損失は繰越後に課税）', () => {
  assert.equal(corporateTax(116, 0), 35) // 116×0.3 ＝ 34.8 → 35
  assert.equal(corporateTax(-10, 0), 5) // 赤字は最低税額
  assert.equal(corporateTax(10, 0), 5) // 3 → 最低 5
  assert.equal(corporateTax(200, -130), 21) // 繰越後 70×0.3 ＝ 21
  assert.equal(corporateTax(100, -130), 5) // 繰越を含めてマイナス → 5
})

test('能力の比較：期首の能力と、投資（機械・教育・広告・採用）を全部実施したときの最大', () => {
  const st = st3() // 製造2・販売2・機械1・広告0
  // 何もしなければ 期首＝合計、増分 0
  const none = capacityCompare(defaultPlan(), st)
  assert.deepEqual(
    none.map((c) => [c.key, c.open, c.add, c.total]),
    [
      ['mfg', 4, 0, 4], // 作業者 min(2, 機械1×2)=2 × 2個
      ['sales', 4, 0, 4], // 販売2人 × 2個
    ],
  )
  // 製造の採用1・販売員の採用1・機械1・教育1・広告1
  const c = capacityCompare({ ...defaultPlan(), hireMfg: 1, hireSales: 1, machinesNew: 1, edu: 1, ads: 1 }, st)
  const mfg = c.find((x) => x.key === 'mfg')!
  const sales = c.find((x) => x.key === 'sales')!
  assert.equal(mfg.total, 9) // 作業者 min(3, 機械2×2)=3 × 教育あり3個
  assert.equal(mfg.add, 5)
  assert.equal(sales.total, 8) // 販売3人×2 ＋ 広告 min(1, 6)×2
  assert.equal(sales.add, 4)
})

test('必要な現金：期首処理・仕入代・固定費（減価償却と期首の金利を除く）・機械代・元本返済の合計と、前期繰越の現金との差', () => {
  const st = st3() // 現金252・期首の自動行 31（納税26・金利5）・借入100×返済率10%
  const plan = { ...defaultPlan(), machinesNew: 1, p: 30, v: 12 }
  // F ＝ 現況 31×4＋10＋25＋5 ＝ 164、新規 減価償却 10 → 174。MQ 174 ÷ M 18 → Q 10
  const n = cashNeeds(plan, st)
  const by = Object.fromEntries(n.items.map((x) => [x.key, x.amount]))
  assert.equal(by.opening, 31) // 納税 26 ＋ 期首の金利 5
  assert.equal(by.buy, 120) // 期首の材料 0 → 10個 × 12
  assert.equal(by.fixed, 149) // 174 − 減価償却 20 − 期首の金利 5
  assert.equal(by.machine, 100)
  assert.equal(by.repay, 10) // 100 × 10%
  assert.equal(n.total, 410)
  assert.equal(n.openingCash, 252)
  assert.equal(n.diff, -158) // 252 − 410：不足
  assert.equal(n.sales, 300)
  assert.equal(n.endCash, 142) // −158 ＋ 売上 300
})

test('必要な現金：元本返済は今期あらたに借入する金額も含める（期末処理と同じ式）', () => {
  const st = st3() // 借入100・返済率10%
  const n = cashNeeds({ ...defaultPlan(), loanNew: 200, p: 30, v: 12 }, st)
  assert.equal(n.items.find((x) => x.key === 'repay')!.amount, 30) // (100 ＋ 200) × 10%
})

test('必要な現金：期首に材料があれば仕入代から引く。Q が出せなければ仕入代 0・期末見込みなし', () => {
  const st = st3()
  st.openingMatQty = 4
  const n = cashNeeds({ ...defaultPlan(), p: 30, v: 12 }, st)
  // F 164 → Q ＝ ⌈164÷18⌉ ＝ 10、仕入は 10 − 4 ＝ 6個
  assert.equal(n.items.find((x) => x.key === 'buy')!.amount, 72)
  const noQ = cashNeeds({ ...defaultPlan(), p: 10, v: 12 }, st)
  assert.equal(noQ.items.find((x) => x.key === 'buy')!.amount, 0)
  assert.equal(noQ.endCash, null)
})
