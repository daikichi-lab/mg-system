// 経営計画書タブ（第3表）。仕様は docs/仕様書.md §3.2・§5.1、様式は docs/04_【A3横20部】経営計画書.pdf。
//
// 参加者の入力は Plan（lib/plan.ts）に持ち、金額の計算はすべて lib/plan.ts の純関数で行う。
// 保存は入力が落ち着いてから（SAVE_DELAY_MS）まとめて game.savePlan() → DB。タブを離れるときは即保存。
// 数値ルール planFromPeriod より前の期ではこのタブ自体が出ない（Participant.tsx 側で制御）。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fmt, fmtA } from '../lib/calc'
import type { Game } from '../state/useGame'
import { normalizePlan, fixedCosts, planFigures, cashPlan, breakEvenG, type Plan, type PlanAction } from '../lib/plan'

/** 入力が止まってから保存するまでの待ち時間。1文字ごとに PUT を飛ばさないため */
const SAVE_DELAY_MS = 700

export default function PlanTab({ game }: { game: Game }) {
  const st = game.st
  const period = st.period
  const ro = game.spectator // 閲覧専用（講師ビュー）では入力できない
  const [plan, setPlan] = useState<Plan>(() => normalizePlan(game.plans[String(period)]))
  const dirty = useRef(false)
  // 最新の入力と保存関数を ref に持つ（アンマウント時の即保存と、依存配列の肥大化を避けるため）
  const latest = useRef({ period, plan })
  latest.current = { period, plan }
  const saveRef = useRef(game.savePlan)
  saveRef.current = game.savePlan

  // 期が変わったら（次の期へ進んだ）その期の保存値から作り直す
  useEffect(() => {
    setPlan(normalizePlan(game.plans[String(period)]))
    dirty.current = false
  }, [period]) // eslint-disable-line react-hooks/exhaustive-deps

  // 入力のたびに保存すると1文字ごとに PUT が飛ぶので、落ち着いてから保存する
  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(() => {
      dirty.current = false
      saveRef.current(latest.current.period, latest.current.plan)
    }, SAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [plan])

  // タブを離れる（アンマウント）ときに未保存分を即保存
  useEffect(
    () => () => {
      if (dirty.current) {
        dirty.current = false
        saveRef.current(latest.current.period, latest.current.plan)
      }
    },
    [],
  )

  const update = (patch: Partial<Plan>) => {
    if (ro) return
    dirty.current = true
    setPlan((p) => ({ ...p, ...patch }))
  }
  const updateAction = (i: number, patch: Partial<PlanAction>) => {
    if (ro) return
    dirty.current = true
    setPlan((p) => ({ ...p, actions: p.actions.map((a, k) => (k === i ? { ...a, ...patch } : a)) }))
  }

  const fc = fixedCosts(plan, st)
  const fig = planFigures(plan, st)
  const cash = cashPlan(plan, st)
  const gHint = breakEvenG(st) // 期首の利益剰余金がマイナスのときだけ値が入る
  const n = (v: number | null | undefined) => (v == null ? '—' : fmt(v))

  // 数値入力（0 以上）。閲覧専用では無効
  const numIn = (testid: string, value: number, onChange: (v: number) => void, cls = 'w-20') => (
    <input
      data-testid={testid}
      type="number"
      min={0}
      value={value}
      disabled={ro}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className={`h-9 border border-line rounded px-2 num text-sm text-right bg-white disabled:bg-canvas ${cls}`}
    />
  )
  const card = (title: ReactNode, body: ReactNode, cls = '') => (
    <div className={`bg-white rounded-2xl shadow-card border border-line p-5 text-sm ${cls}`}>
      <h2 className="font-bold mb-2">{title}</h2>
      {body}
    </div>
  )
  // 投資の1行：項目／名称／入力欄／単位／固定費の式／金額。
  // 名称・入力欄・単位は別の列にして縦に揃える（入力欄の幅はすべて同じ）。閲覧専用では入力できない
  const invRow = (
    key: string,
    label: string,
    name: string,
    value: number,
    onChange: (v: number) => void,
    unitLabel: string,
    formula: string,
    amount: number,
  ) => (
    <tr key={key} className="border-b border-line/60">
      <td className="py-1.5 pr-2 text-ink-500 whitespace-nowrap">{label}</td>
      <td className="py-1.5 pr-2 whitespace-nowrap">{name}</td>
      <td className="py-1.5 pr-1 w-24">{numIn(`plan-${key}`, value, (v) => onChange(Math.round(v)), 'w-20 h-7')}</td>
      <td className="py-1.5 pr-3 text-ink-500 whitespace-nowrap w-6">{unitLabel}</td>
      <td className="py-1.5 pr-2 text-ink-400 whitespace-nowrap">{formula}</td>
      <td className="py-1.5 pl-2 text-right num whitespace-nowrap">{fmt(amount)}</td>
    </tr>
  )
  // 入力欄のない行（上の入力から決まる費用。例：期末で追加の給料）
  const derivedRow = (key: string, label: string, name: string, formula: string, amount: number) => (
    <tr key={key} className="border-b border-line/60">
      <td className="py-1.5 pr-2 text-ink-500 whitespace-nowrap">{label}</td>
      <td className="py-1.5 pr-2 whitespace-nowrap">{name}</td>
      <td className="py-1.5 pr-1 w-24"></td>
      <td className="py-1.5 pr-3 w-6"></td>
      <td className="py-1.5 pr-2 text-ink-400 whitespace-nowrap">{formula}</td>
      <td className="py-1.5 pl-2 text-right num whitespace-nowrap">{fmt(amount)}</td>
    </tr>
  )
  const u = fc.units
  const item = (key: string) => fc.items.find((x) => x.key === key)!

  return (
    <div className="space-y-4" data-testid="plan">
      <div className="rounded-2xl border border-g-base/30 bg-g-bg px-5 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="font-black text-g-ink">第{period}期 経営計画書</h2>
        <span className="text-g-ink/80 text-xs">
          会社名 <b>{st.name}</b>　社長名 <b>{st.president}</b>
        </span>
        <p className="text-g-ink/80 text-xs basis-full">
          記帳を始める前に、目標の経常利益から「いくつ売る必要があるか」を逆算します。入力は自動で保存されます。
          {ro && '（閲覧専用）'}
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* 左：第3表 経営計画 */}
        <div className="space-y-4">
          {card(
            <span className="text-g-ink">1. 必要経常利益（G）を決定</span>,
            <div>
              <div className="flex items-center gap-3">
                <span className="text-ink-500">経常利益目標</span>
                {numIn('plan-g', plan.g, (v) => update({ g: v }), 'w-28 text-base font-bold text-g-ink border-g-base/50')}
              </div>
              {/* 期首の利益剰余金がマイナスなら、期末にゼロへ戻す目安を出す（プラスなら何も出さない） */}
              {gHint != null && (
                <div data-testid="plan-g-hint" className="mt-2 rounded-lg bg-accent-bg border border-accent/30 px-3 py-2 text-xs text-ink-600 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    期首の利益剰余金が <b className="num text-accent-ink">▲{fmt(-st.retained)}</b> です。期末にプラスマイナスゼロへ戻すには、経常利益{' '}
                    <b className="num text-ink">{fmt(gHint)}</b> 以上が目安です（法人税を引いた後で赤字を埋め切る額）。
                  </span>
                  {!ro && (
                    <button
                      data-testid="plan-g-hint-apply"
                      onClick={() => update({ g: gHint })}
                      className="h-7 px-2 rounded-md border border-line bg-white text-ink-600 font-bold"
                    >
                      この値を入れる
                    </button>
                  )}
                </div>
              )}
            </div>,
          )}

          {card(
            <span className="text-f-ink">2. 固定費（F）を算出</span>,
            <div className="space-y-3">
              {/* 上：現況（最低限必要）。期首の会社盤から必ず出る費用なので入力欄は無い */}
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-xs font-bold text-ink-600">現況（最低限必要）</span>
                  <span className="text-[10px] text-ink-400">期首の会社盤から自動で計算</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {fc.items
                        .filter((x) => x.col === 'now')
                        .map((x) => (
                          <tr key={x.key} className="border-b border-line/60" data-testid={`plan-now-${x.key}`}>
                            <td className="py-1.5 pr-2 text-ink-500 whitespace-nowrap">{x.label}</td>
                            <td className="py-1.5 pr-2 whitespace-nowrap">{x.detail}</td>
                            <td className="py-1.5 pl-2 text-right num whitespace-nowrap">{fmt(x.amount)}</td>
                          </tr>
                        ))}
                      <tr className="font-bold">
                        <td className="py-1.5 pr-2" colSpan={2}>
                          現況 小計
                        </td>
                        <td className="py-1.5 pl-2 text-right num" data-testid="plan-F-now">
                          {fmt(fc.now)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 下：戦略的投資（新規）。これからの投資を入力すると、それに伴う固定費が出る */}
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-xs font-bold text-ink-600">戦略的投資（新規）</span>
                  <span className="text-[10px] text-ink-400">これからの投資を入力</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-ink-400 border-b border-line">
                        <th className="text-left py-1 pr-2 font-normal">項目</th>
                        <th className="text-left py-1 pr-2 font-normal" colSpan={3}>
                          予定
                        </th>
                        <th className="text-left py-1 pr-2 font-normal">固定費の式</th>
                        <th className="text-right py-1 pl-2 font-normal">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invRow('hire', '一般管理費', '社員採用', plan.hire, (v) => update({ hire: v }), '人', `採用費 ${u.hire}×${plan.hire}`, item('hire').amount)}
                      {derivedRow('hireSalary', '人件費', '期末で追加の給料', `${u.sal}×${plan.hire}人`, item('hireSalary').amount)}
                      {invRow('machinesNew', '減価償却費', '機械購入', plan.machinesNew, (v) => update({ machinesNew: v }), '台',
                        `減価償却 ${u.dep}×${plan.machinesNew}`, item('depNew').amount)}
                      {invRow('edu', '一般管理費', '教育', plan.edu, (v) => update({ edu: v }), '枚', `${u.edu}×${plan.edu}`, item('edu').amount)}
                      {invRow('ins', '', '保険加入', plan.ins, (v) => update({ ins: v }), '枚', `${u.ins}×${plan.ins}`, item('ins').amount)}
                      {invRow('ads', '販売費', '広告', plan.ads, (v) => update({ ads: v }), '枚', `${u.ads}×${plan.ads}`, item('ads').amount)}
                      {invRow('dev', '研究開発費', '商品開発', plan.dev, (v) => update({ dev: v }), '枚', `${u.dev}×${plan.dev}`, item('dev').amount)}
                      {invRow('loanNew', '営業外費用', '新規借入', plan.loanNew, (v) => update({ loanNew: v }), '',
                        `借入額 × 金利${u.ratePct}%`, item('intNew').amount)}
                      <tr className="font-bold">
                        <td className="py-1.5 pr-2" colSpan={5}>
                          投資 小計
                        </td>
                        <td className="py-1.5 pl-2 text-right num" data-testid="plan-F-new">
                          {fmt(fc.next)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-between items-center rounded-lg bg-f-bg px-3 py-2">
                <span className="font-bold text-f-ink">★ 固定費（F）合計　現況 ＋ 投資</span>
                <b className="num text-f-ink text-lg" data-testid="plan-F">
                  {fmt(fig.F)}
                </b>
              </div>
            </div>,
          )}

          {card(
            <span className="text-m-ink">3. 商品の必要粗利益（付加価値）額（MQ）を計算</span>,
            <div className="flex justify-between items-center rounded-lg bg-m-bg px-3 py-2">
              <span className="text-m-ink text-xs">1. 経常利益目標（G）＋ 2. 固定費（F）合計</span>
              <b className="num text-m-ink text-lg" data-testid="plan-MQ">
                {fmt(fig.MQ)}
              </b>
            </div>,
          )}

          {card(
            <span className="text-p-ink">4. 商品の各単価目標を設定</span>,
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-ink-500">①販売単価（P）　商品1個あたり平均いくらで売るか</span>
                {numIn('plan-p', plan.p, (v) => update({ p: v }), 'w-24 text-p-ink font-bold')}
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-ink-500">②売上原価（V）　売上原価1個あたり平均いくらで仕入れるか</span>
                {numIn('plan-v', plan.v, (v) => update({ v: v }), 'w-24 text-v-ink font-bold')}
              </div>
              <div className="flex items-center justify-between rounded-lg bg-m-bg px-3 py-2">
                <span className="text-m-ink text-xs">③計画粗利益（付加価値）単価（M）　式＜P − V＞</span>
                <b className="num text-m-ink text-lg" data-testid="plan-M">
                  {fmtA(fig.M)}
                </b>
              </div>
            </div>,
          )}

          {card(
            '5. 売上必要個数（Q）を算出',
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-canvas px-3 py-2">
                <span className="text-ink-500 text-xs">
                  MQ ÷ M ＝ 必要個数（小数点以下は切り上げ）
                  {fig.Q == null && <span className="text-accent-ink ml-2">※ 粗利単価 M が 0 以下のため計算できません</span>}
                </span>
                <b className="num text-lg" data-testid="plan-Q">
                  {n(fig.Q)}
                  <span className="text-xs font-normal text-ink-400 ml-0.5">個</span>
                </b>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex justify-between rounded-lg border border-line px-3 py-2">
                  <span className="text-ink-500">売上高計（P×Q）</span>
                  <b className="num" data-testid="plan-PQ">
                    {n(fig.PQ)}
                  </b>
                </div>
                <div className="flex justify-between rounded-lg border border-line px-3 py-2">
                  <span className="text-ink-500">売上原価計（V×Q）</span>
                  <b className="num" data-testid="plan-VQ">
                    {n(fig.VQ)}
                  </b>
                </div>
              </div>
            </div>,
          )}
        </div>

        {/* 右：アクションプラン */}
        <div className="space-y-4">
          {card(
            <span className="flex justify-between items-baseline">
              <span>● アクションプラン</span>
              <span className="text-xs font-normal text-ink-500">
                前期繰越残高 <b className="num text-ink">{fmt(cash.openingCash)}</b>
              </span>
            </span>,
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[420px]">
                <thead>
                  <tr className="text-ink-400 border-b border-line">
                    <th className="w-7 py-1 font-normal"></th>
                    <th className="text-left py-1 font-normal">スケジュール（予定）</th>
                    <th className="text-right py-1 px-1 font-normal whitespace-nowrap">入出金（＋入／−出）</th>
                    <th className="text-right py-1 px-1 font-normal">現金残高</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line/60 bg-canvas">
                    <td></td>
                    <td className="py-1.5 text-ink-500">期首処理（納税・支払金利）</td>
                    <td className="py-1.5 px-1 text-right num">{fmtA(cash.openingAuto)}</td>
                    <td className="py-1.5 px-1 text-right num">{fmt(cash.openingCash + cash.openingAuto)}</td>
                  </tr>
                  {cash.rows.map((r, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="py-1 text-ink-400 text-center num">{i + 1}</td>
                      <td className="py-1 pr-1">
                        <input
                          data-testid={`plan-act-text-${i}`}
                          type="text"
                          value={plan.actions[i].text}
                          disabled={ro}
                          onChange={(e) => updateAction(i, { text: e.target.value })}
                          className="h-7 w-full border border-line rounded px-2 text-xs bg-white disabled:bg-canvas"
                        />
                      </td>
                      <td className="py-1 px-1 text-right">
                        <input
                          data-testid={`plan-act-amt-${i}`}
                          type="number"
                          value={plan.actions[i].amount}
                          disabled={ro}
                          onChange={(e) => updateAction(i, { amount: Number(e.target.value) || 0 })}
                          className="h-7 w-24 border border-line rounded px-2 num text-xs text-right bg-white disabled:bg-canvas"
                        />
                      </td>
                      <td className={`py-1 px-1 text-right num ${r.balance < 0 ? 'text-accent-ink font-bold' : ''}`}>
                        {fmtA(r.balance)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-canvas">
                    <td></td>
                    <td className="py-1.5 text-ink-500">
                      期末処理（人件費・経費など）
                      <span className="text-[10px] text-ink-400 ml-1">{cash.closingDetail}</span>
                    </td>
                    <td className="py-1.5 px-1 text-right num">{fmtA(cash.closingAuto)}</td>
                    <td
                      className={`py-1.5 px-1 text-right num font-bold ${cash.endBalance < 0 ? 'text-accent-ink' : ''}`}
                      data-testid="plan-end-balance"
                    >
                      {fmtA(cash.endBalance)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>,
          )}

        </div>
      </div>
    </div>
  )
}
