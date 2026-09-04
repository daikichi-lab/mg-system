// 経営計画書（lib/plan.ts）の計算の検証。仕様は docs/仕様書.md §5.1。
// 単価はすべて数値ルールと記帳アクションから引くので、ルールを差し替えたときに追従することも見る。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newState, setRules, type St, type Result } from '../src/lib/calc.ts'
import { defaultPlan, normalizePlan, fixedCosts, planFigures, cashPlan, actualsFor, PLAN_ROWS } from '../src/lib/plan.ts'

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

test('defaultPlan：人数・台数は期首の盤面、投資と単価は未記入（0）、行数は 25', () => {
  const p = defaultPlan(st3())
  assert.equal(p.staffMfg, 2)
  assert.equal(p.staffSales, 2)
  assert.equal(p.machines, 1)
  assert.equal(p.g, 0)
  assert.equal(p.p, 0)
  assert.equal(p.actions.length, PLAN_ROWS)
})

test('固定費：既定ルールで 現況（給料・減価償却・家賃・期首金利）と新規（採用・チップ・新規借入金利）', () => {
  const st = st3()
  const plan = { ...defaultPlan(st), hire: 1, edu: 1, ins: 1, ads: 2, dev: 1, loanNew: 100 }
  const fc = fixedCosts(plan, st)
  // 現況：給料 31×2 ＋ 31×2、減価償却 10×1、家賃 25、期首残高 100×5% ＝ 5
  assert.equal(fc.now, 62 + 62 + 10 + 25 + 5)
  // 新規：採用 5×1、教育 20×1、保険 5×1、広告 10×2、商品開発 20×1、新規借入 100×5% ＝ 5
  assert.equal(fc.next, 5 + 20 + 5 + 20 + 20 + 5)
  assert.equal(fc.total, fc.now + fc.next)
  // 表示用の内訳文に単価と数量が入る
  assert.equal(fc.items.find((x) => x.key === 'ads')?.detail, '広告 10×2枚')
  reset()
})

test('図：MQ＝G＋F、M＝P−V、Q は切り上げ、PQ・VQ はその個数で', () => {
  const st = st3()
  const plan = { ...defaultPlan(st), g: 100, p: 32, v: 12 }
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
  const f = planFigures({ ...defaultPlan(st), g: 100, p: 12, v: 12 }, st)
  assert.equal(f.M, 0)
  assert.equal(f.Q, null)
  assert.equal(f.PQ, null)
  assert.equal(f.VQ, null)
  reset()
})

test('ルール差し替えに追従：家賃・給料表・減価償却・金利を変えると固定費が変わる', () => {
  setRules({ rent: 40, salaryTable: [20, 20, 20], depPerMachine: 15, loanRate: 0.1 })
  const st = st3()
  const fc = fixedCosts({ ...defaultPlan(st), loanNew: 50 }, st)
  // 現況：給料 20×4、減価償却 15、家賃 40、期首金利 100×10% ＝ 10
  assert.equal(fc.now, 80 + 15 + 40 + 10)
  // 新規：新規借入 50×10% ＝ 5
  assert.equal(fc.next, 5)
  reset()
})

test('アクションプラン：前期繰越 → 期首処理 → 各行 → 期末処理 の順に現金残高を累計する', () => {
  const st = st3()
  const plan = defaultPlan(st)
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
  reset()
})

test('normalizePlan：壊れた保存値は初期値で埋め、行数は 25 に揃える', () => {
  const st = st3()
  assert.deepEqual(normalizePlan(null, st), defaultPlan(st))
  assert.deepEqual(normalizePlan('x', st), defaultPlan(st))
  const p = normalizePlan({ g: 100, hire: 'a', staffMfg: 0, actions: [{ text: '仕入', amount: -50 }, { text: 5 }] }, st)
  assert.equal(p.g, 100)
  assert.equal(p.hire, 0) // 型崩れは 0
  assert.equal(p.staffMfg, 0) // 0 が保存されていればそのまま
  assert.equal(p.staffSales, 2) // 未保存なら盤面の値
  assert.equal(p.actions.length, PLAN_ROWS)
  assert.deepEqual(p.actions[0], { text: '仕入', amount: -50 })
  assert.deepEqual(p.actions[1], { text: '', amount: 0 })
})

test('actualsFor：当期は決算済みなら st.result、過去期は履歴から。無ければ null', () => {
  const st = st3()
  const r = { period: 3, PQ: 400, vPQ: 120, mPQ: 280, F: 164, G: 116 } as unknown as Result
  assert.equal(actualsFor(3, st, []), null)
  st.settled = true
  st.result = r
  assert.deepEqual(actualsFor(3, st, []), { PQ: 400, vPQ: 120, mPQ: 280, F: 164, G: 116 })
  assert.equal(actualsFor(2, st, [{ ...r, period: 2, G: 50 } as Result])?.G, 50)
})
