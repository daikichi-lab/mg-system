// 経営計画書（lib/plan.ts）の計算の検証。仕様は docs/仕様書.md §5.1。
// 単価はすべて数値ルールと記帳アクションから引くので、ルールを差し替えたときに追従することも見る。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newState, setRules, corporateTax, type St } from '../src/lib/calc.ts'
import { defaultPlan, normalizePlan, fixedCosts, planFigures, cashPlan, breakEvenG, PLAN_ROWS } from '../src/lib/plan.ts'

const reset = () => setRules(null)

// 第3期の期首：製造2・販売2・機械1・借入残高100（返済率10%）・現金252、期首の自動行（納税26・金利5）
function st3(): St {
  const st = newState()
  st.period = 3
  st.openingStaffMfg = 2
  st.openingStaffSales = 2
  st.openingMachines = 1
  st.openingLoan = 100
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
  assert.equal(p.hire, 0)
  assert.equal(p.machinesNew, 0)
  assert.equal(p.p, 0)
  assert.equal(p.actions.length, PLAN_ROWS)
  assert.equal('staffMfg' in p, false)
})

test('固定費：現況は期首の盤面から（給料・減価償却・家賃・期首金利）、新規は入力から（採用費＋採用者の給料・機械の減価償却・チップ・新規借入金利）', () => {
  const st = st3()
  const plan = { ...defaultPlan(), hire: 1, machinesNew: 1, edu: 1, ins: 1, ads: 2, dev: 1, loanNew: 100 }
  const fc = fixedCosts(plan, st)
  // 現況：給料 31×2 ＋ 31×2、減価償却 10×1、家賃 25、期首残高 100×5% ＝ 5
  assert.equal(fc.now, 62 + 62 + 10 + 25 + 5)
  // 新規：採用費 5×1 ＋ 採用者の給料 31×1、機械購入の減価償却 10×1、教育 20、保険 5、広告 10×2、商品開発 20、新規借入 100×5% ＝ 5
  assert.equal(fc.next, 5 + 31 + 10 + 20 + 5 + 20 + 20 + 5)
  assert.equal(fc.total, fc.now + fc.next)
  // 表示用の内訳文に単価と数量が入る
  assert.equal(fc.items.find((x) => x.key === 'ads')?.detail, '広告 10×2枚')
  assert.equal(fc.items.find((x) => x.key === 'salaryMfg')?.detail, '製造スタッフ給与 31×2人')
  // 表示用の単価
  assert.deepEqual(fc.units, { sal: 31, dep: 10, hire: 5, edu: 20, ins: 5, ads: 10, dev: 20, ratePct: 5 })
  reset()
})

test('図：MQ＝G＋F、M＝P−V、Q は切り上げ、PQ・VQ はその個数で', () => {
  const st = st3()
  const plan = { ...defaultPlan(), g: 100, p: 32, v: 12 }
  const f = planFigures(plan, st)
  assert.equal(f.F, 62 + 62 + 10 + 25 + 5) // 164
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

test('アクションプラン：前期繰越 → 期首処理 → 各行 → 期末処理 の順に現金残高を累計する', () => {
  const st = st3()
  const plan = defaultPlan()
  plan.actions[0] = { text: '仕入 5個', amount: -50 }
  plan.actions[1] = { text: '販売 3個', amount: 80 }
  const c = cashPlan(plan, st)
  assert.equal(c.openingCash, 252)
  assert.equal(c.openingAuto, -(26 + 5)) // 期首の自動行（納税＋金利）
  assert.equal(c.rows[0].balance, 252 - 31 - 50)
  assert.equal(c.rows[1].balance, 252 - 31 - 50 + 80)
  assert.equal(c.rows[PLAN_ROWS - 1].balance, 251) // 空行は残高を変えない
  // 期末処理：給料 31×4 ＋ 家賃 25 ＋ 返済 100×10% ＝ 10
  assert.equal(c.closingAuto, -(124 + 25 + 10))
  assert.equal(c.endBalance, 251 - 159)
  // 採用予定が 1 人なら期末の給料も 1 人分増える
  assert.equal(cashPlan({ ...plan, hire: 1 }, st).closingAuto, -(124 + 31 + 25 + 10))
  reset()
})

test('normalizePlan：壊れた保存値は初期値で埋め、行数は 25 に揃える', () => {
  assert.deepEqual(normalizePlan(null), defaultPlan())
  assert.deepEqual(normalizePlan('x'), defaultPlan())
  const p = normalizePlan({ g: 100, hire: 'a', machinesNew: 2.4, actions: [{ text: '仕入', amount: -50 }, { text: 5 }] })
  assert.equal(p.g, 100)
  assert.equal(p.hire, 0) // 型崩れは 0
  assert.equal(p.machinesNew, 2) // 人数・台数は整数に丸める
  assert.equal(p.actions.length, PLAN_ROWS)
  assert.deepEqual(p.actions[0], { text: '仕入', amount: -50 })
  assert.deepEqual(p.actions[1], { text: '', amount: 0 })
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
