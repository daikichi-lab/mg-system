// 経営計画書タブ（第3表）。仕様は docs/仕様書.md §3.2・§5.1、様式は docs/04_【A3横20部】経営計画書.pdf。
//
// 参加者の入力は Plan（lib/plan.ts）に持ち、金額の計算はすべて lib/plan.ts の純関数で行う。
// 保存は入力が落ち着いてから（SAVE_DELAY_MS）まとめて game.savePlan() → DB。タブを離れるときは即保存。
// 数値ルール planFromPeriod より前の期ではこのタブ自体が出ない（Participant.tsx 側で制御）。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fmt, fmtA } from '../lib/calc'
import type { Game } from '../state/useGame'
import { normalizePlan, fixedCosts, planFigures, cashPlan, actualsFor, type Plan, type PlanAction } from '../lib/plan'

/** 入力が止まってから保存するまでの待ち時間。1文字ごとに PUT を飛ばさないため */
const SAVE_DELAY_MS = 700

export default function PlanTab({ game }: { game: Game }) {
  const st = game.st
  const period = st.period
  const ro = game.spectator // 閲覧専用（講師ビュー）では入力できない
  const [plan, setPlan] = useState<Plan>(() => normalizePlan(game.plans[String(period)], st))
  const dirty = useRef(false)
  // 最新の入力と保存関数を ref に持つ（アンマウント時の即保存と、依存配列の肥大化を避けるため）
  const latest = useRef({ period, plan })
  latest.current = { period, plan }
  const saveRef = useRef(game.savePlan)
  saveRef.current = game.savePlan

  // 期が変わったら（次の期へ進んだ）その期の保存値から作り直す
  useEffect(() => {
    setPlan(normalizePlan(game.plans[String(period)], st))
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
  const actual = actualsFor(period, st, game.history)
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
  // 固定費の1行（人数・枚数が編集できる項目は入力欄を出す）
  const costRow = (
    key: string,
    label: string,
    detail: ReactNode,
    amount: number,
    col: 'now' | 'new',
  ) => (
    <tr key={key} className="border-b border-line/60">
      <td className="py-1.5 pr-2 text-ink-500 whitespace-nowrap">{label}</td>
      <td className="py-1.5 pr-2">{detail}</td>
      <td className={`py-1.5 px-2 text-right num ${col === 'now' ? '' : 'bg-canvas text-ink-300'}`}>
        {col === 'now' ? fmt(amount) : ''}
      </td>
      <td className={`py-1.5 px-2 text-right num ${col === 'new' ? '' : 'bg-canvas text-ink-300'}`}>
        {col === 'new' ? fmt(amount) : ''}
      </td>
    </tr>
  )
  const item = (key: string) => fc.items.find((x) => x.key === key)!
  // 予算／実績の5項目
  const pl: [string, number | null, number | undefined][] = [
    ['①売上高（PQ）', fig.PQ, actual?.PQ],
    ['②売上原価（VQ）', fig.VQ, actual?.vPQ],
    ['③粗利益（MQ）', fig.MQ, actual?.mPQ],
    ['④固定費（F）', fig.F, actual?.F],
    ['⑤経常利益（G）', plan.g, actual?.G],
  ]

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
            <div className="flex items-center gap-3">
              <span className="text-ink-500">経常利益目標</span>
              {numIn('plan-g', plan.g, (v) => update({ g: v }), 'w-28 text-base font-bold text-g-ink border-g-base/50')}
            </div>,
          )}

          {card(
            <span className="text-f-ink">2. 固定費（F）を算出</span>,
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[520px]">
                <thead>
                  <tr className="text-ink-400 border-b border-line">
                    <th className="text-left py-1 pr-2 font-normal">項目</th>
                    <th className="text-left py-1 pr-2 font-normal">詳細内訳（人数・枚数は予定）</th>
                    <th className="text-right py-1 px-2 font-normal whitespace-nowrap">
                      現況
                      <br />
                      <span className="text-[10px]">（最低限必要）</span>
                    </th>
                    <th className="text-right py-1 px-2 font-normal whitespace-nowrap">
                      戦略的投資
                      <br />
                      <span className="text-[10px]">（新規）</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {costRow(
                    'salaryMfg',
                    '労務費',
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      製造スタッフ給与 {item('salaryMfg').detail.replace(/×.*$/, '×')}
                      {numIn('plan-staffMfg', plan.staffMfg, (v) => update({ staffMfg: Math.round(v) }), 'w-14 h-7')}人
                    </span>,
                    item('salaryMfg').amount,
                    'now',
                  )}
                  {costRow(
                    'salarySales',
                    '人件費',
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      販売スタッフ給与 {item('salarySales').detail.replace(/×.*$/, '×')}
                      {numIn('plan-staffSales', plan.staffSales, (v) => update({ staffSales: Math.round(v) }), 'w-14 h-7')}人
                    </span>,
                    item('salarySales').amount,
                    'now',
                  )}
                  {costRow(
                    'dep',
                    '減価償却費',
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      {item('dep').detail.replace(/×.*$/, '×')}
                      {numIn('plan-machines', plan.machines, (v) => update({ machines: Math.round(v) }), 'w-14 h-7')}台
                    </span>,
                    item('dep').amount,
                    'now',
                  )}
                  {costRow('rent', '家賃', item('rent').detail, item('rent').amount, 'now')}
                  {costRow(
                    'hire',
                    '一般管理費',
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      {item('hire').detail.replace(/×.*$/, '×')}
                      {numIn('plan-hire', plan.hire, (v) => update({ hire: Math.round(v) }), 'w-14 h-7')}人
                    </span>,
                    item('hire').amount,
                    'new',
                  )}
                  {costRow(
                    'edu',
                    '',
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      {item('edu').detail.replace(/×.*$/, '×')}
                      {numIn('plan-edu', plan.edu, (v) => update({ edu: Math.round(v) }), 'w-14 h-7')}枚
                    </span>,
                    item('edu').amount,
                    'new',
                  )}
                  {costRow(
                    'ins',
                    '',
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      {item('ins').detail.replace(/×.*$/, '×')}
                      {numIn('plan-ins', plan.ins, (v) => update({ ins: Math.round(v) }), 'w-14 h-7')}枚
                    </span>,
                    item('ins').amount,
                    'new',
                  )}
                  {costRow(
                    'ads',
                    '販売費',
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      {item('ads').detail.replace(/×.*$/, '×')}
                      {numIn('plan-ads', plan.ads, (v) => update({ ads: Math.round(v) }), 'w-14 h-7')}枚
                    </span>,
                    item('ads').amount,
                    'new',
                  )}
                  {costRow(
                    'dev',
                    '研究開発費',
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      {item('dev').detail.replace(/×.*$/, '×')}
                      {numIn('plan-dev', plan.dev, (v) => update({ dev: Math.round(v) }), 'w-14 h-7')}枚
                    </span>,
                    item('dev').amount,
                    'new',
                  )}
                  {costRow('intOpen', '営業外費用', item('intOpen').detail, item('intOpen').amount, 'now')}
                  {costRow(
                    'intNew',
                    '（借入金利息）',
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      今期新規借入
                      {numIn('plan-loanNew', plan.loanNew, (v) => update({ loanNew: Math.round(v) }), 'w-20 h-7')}
                      {item('intNew').detail.replace(/^今期新規借入 \d+/, '')}
                    </span>,
                    item('intNew').amount,
                    'new',
                  )}
                  <tr className="font-bold">
                    <td className="py-2 pr-2" colSpan={2}>
                      固定費合計
                    </td>
                    <td className="py-2 px-2 text-right num" data-testid="plan-F-now">
                      {fmt(fc.now)}
                    </td>
                    <td className="py-2 px-2 text-right num" data-testid="plan-F-new">
                      {fmt(fc.next)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="flex justify-between items-center mt-2 rounded-lg bg-f-bg px-3 py-2">
                <span className="font-bold text-f-ink">★ 固定費（F）合計</span>
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

        {/* 右：アクションプラン・予算実績 */}
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

          {card(
            '● 経営計画数値／目標実績管理',
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-400 border-b border-line text-xs">
                  <th className="text-left py-1 font-normal">損益計算書＜P/L＞</th>
                  <th className="text-right py-1 px-2 font-normal">予算</th>
                  <th className="text-right py-1 px-2 font-normal text-accent-ink">実績</th>
                  <th className="text-right py-1 px-2 font-normal">予算対比</th>
                </tr>
              </thead>
              <tbody>
                {pl.map(([label, budget, act], i) => (
                  <tr key={label} className="border-b border-line/60">
                    <td className="py-2 font-bold">{label}</td>
                    <td className="py-2 px-2 text-right num" data-testid={`plan-budget-${i}`}>
                      {n(budget)}
                    </td>
                    <td className="py-2 px-2 text-right num" data-testid={`plan-actual-${i}`}>
                      {n(act)}
                    </td>
                    <td className="py-2 px-2 text-right num">{act == null || budget == null ? '—' : fmtA(act - budget)}</td>
                  </tr>
                ))}
              </tbody>
            </table>,
          )}
          {!actual && <p className="text-ink-400 text-xs">実績はこの期の決算後に自動で入ります。</p>}
        </div>
      </div>
    </div>
  )
}
