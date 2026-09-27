// 経営計画書タブ（第3表）。仕様は docs/仕様書.md §3.2・§5.1、様式は docs/04_【A3横20部】経営計画書.pdf。
//
// 参加者の入力は Plan（lib/plan.ts）に持ち、金額の計算はすべて lib/plan.ts の純関数で行う。
// 保存は入力が落ち着いてから（SAVE_DELAY_MS）まとめて game.savePlan() → DB。タブを離れるときは即保存。
// 数値ルール planFromPeriod より前の期ではこのタブ自体が出ない（Participant.tsx 側で制御）。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fmt, fmtA, loanRoom } from '../lib/calc'
import { stracFigureHTML } from '../lib/figures'
import type { Game } from '../state/useGame'
// 能力の比較の内訳行（1行に2つの tr）を組むのに使う。他の PR と import 行が衝突しないよう別の行にしている
import { Fragment } from 'react'
import {
  normalizePlan,
  fixedCosts,
  planFigures,
  cashPlan,
  breakEvenG,
  planLocked,
  stateAtPeriod,
  actionNeeds,
  actionAmount,
  capacityCompare,
  cashNeeds,
  rankGap,
  actionQtyMax,
  clampQty,
  defaultQty,
  EDU_MAX,
  PLAN_ACTION_OPTIONS,
  PLAN_ACTION_UNITS,
  type Plan,
  type PlanAction,
} from '../lib/plan'

/** 入力が止まってから保存するまでの待ち時間。1文字ごとに PUT を飛ばさないため */
const SAVE_DELAY_MS = 700

export default function PlanTab({
  game,
  viewPeriod,
  onBack,
}: {
  game: Game
  /** 履歴から開いた過去の期。今の期と同じ／未指定なら今の期を出す */
  viewPeriod?: number | null
  /** 過去の期を見ているときの「履歴に戻る」 */
  onBack?: () => void
}) {
  // 過去の期は、その期の期首の盤面を前の期の決算から組み直して読み取り専用で見せる
  const past = viewPeriod != null && viewPeriod !== game.st.period ? stateAtPeriod(viewPeriod, game.history, game.st) : null
  const st = past ?? game.st
  const period = st.period
  // その期の記帳を始めたら計画は固定する（計画は記帳の前に立てるもの）。過去の期は常に固定
  const locked = planLocked(st) || !!past
  const ro = game.spectator || locked // 閲覧専用（講師ビュー）・記帳開始後・過去の期は入力できない
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
    setPlan((p) => {
      const next = { ...p, ...patch }
      // 単価（P・V）を変えたら、それを使っている仕入れ・販売の行の金額を出しなおす
      if ('p' in patch || 'v' in patch)
        next.actions = next.actions.map((a) =>
          a.key === 'shiire' || a.key === 'hanbai' ? { ...a, amount: actionAmount(a.key, a.qty, next) } : a,
        )
      return next
    })
  }
  const updateAction = (i: number, patch: Partial<PlanAction>) => {
    if (ro) return
    dirty.current = true
    setPlan((p) => ({
      ...p,
      actions: p.actions.map((a, k) => {
        if (k !== i) return a
        const next = { ...a, ...patch }
        // アクションを選び直したら数量を初期値に戻す。アクションか数量が変わったら金額を出しなおす
        // （金額そのものを直したときは、その値をそのまま残す）
        if ('key' in patch) next.qty = defaultQty(next.key)
        // 1回でできる上限を超えないようにする（記帳と同じ根拠。例：商品開発・教育は1回1枚）
        if ('key' in patch || 'qty' in patch) {
          next.qty = clampQty(next.key, next.qty, p, st)
          next.amount = actionAmount(next.key, next.qty, p)
        }
        return next
      }),
    }))
  }

  // 1位との差を出すために、同じ研修の他社の決算結果を1回だけ取りに行く
  const [orgCompanies, setOrgCompanies] = useState<{ name: string; results?: { capEnd: number; retEnd: number }[] }[]>([])
  const refreshOrgRef = useRef(game.refreshOrg)
  refreshOrgRef.current = game.refreshOrg
  const isPast = past != null
  useEffect(() => {
    if (isPast) {
      setOrgCompanies([])
      return
    }
    void refreshOrgRef.current().then((cs) => setOrgCompanies(cs as never))
  }, [period, isPast])
  // 目安を出したあとの説明用モーダル
  const [gHelp, setGHelp] = useState(false)

  const fc = fixedCosts(plan, st)
  const fig = planFigures(plan, st)
  const capRows = capacityCompare(plan, st)
  const need = cashNeeds(plan, st)
  const cash = cashPlan(plan, st)
  const needs = actionNeeds(plan, st) // どのアクションを何回しないといけないか
  const gHint = breakEvenG(st) // 期首の利益剰余金がマイナスのときだけ値が入る
  const gap = rankGap(st, orgCompanies) // 純資産が1番多い他社との差（決算がまだ無ければ null）
  const room = loanRoom(st) // 今期借入可能額（純資産×倍率 − 借入残高。第1期は 0）
  const n = (v: number | null | undefined) => (v == null ? '—' : fmt(v))

  // 計画の数値で STRAC 面積図を描く（決算の図と同じ描画関数を使う）。
  // 面積を合わせるため経常利益は「粗利 − 固定費」で出す。Q は切り上げるので目標の G 以上になる。
  const stracHtml = (() => {
    if (fig.Q == null || fig.PQ == null || fig.VQ == null) return null
    const mPQ = fig.PQ - fig.VQ
    // 固定費の内訳は計画の勘定科目ごとにまとめる（0 の科目は出さない）
    const byLabel = new Map<string, number>()
    for (const x of fc.items) if (x.amount) byLabel.set(x.label || 'その他', (byLabel.get(x.label || 'その他') || 0) + x.amount)
    return stracFigureHTML({
      Q: fig.Q,
      PQ: fig.PQ,
      vPQ: fig.VQ,
      mPQ,
      F: fig.F,
      G: mPQ - fig.F,
      fParts: [...byLabel].map(([label, value]) => ({ label, value })),
    })
  })()

  // 計画（目標・単価）がそろって売上必要個数 Q が出たら、下の「動き方を決める」を開く
  const ready = plan.g > 0 && plan.p > 0 && plan.v > 0 && fig.Q != null
  // 開くのに足りないものを、空の段にそのまま並べる
  const missing: string[] = []
  if (plan.g <= 0) missing.push('経常利益目標（G）を入力する')
  if (plan.p <= 0) missing.push('販売単価（P）を入力する')
  if (plan.v <= 0) missing.push('売上原価（V）を入力する')
  if (plan.g > 0 && plan.p > 0 && plan.v > 0 && fig.Q == null) missing.push('販売単価（P）を売上原価（V）より高く設定する')
  // 計画をたたんで要約1行にする（アクションプランを書くときに縦を詰める）
  const [folded, setFolded] = useState(false)
  // 計画を書き直して未完成に戻ったら、たたんだままにしない
  useEffect(() => {
    if (!ready) setFolded(false)
  }, [ready])
  // 出現アニメは「開いた瞬間」だけ。最初から完成しているタブでは動かさない
  const [revealOnOpen] = useState(() => !ready)

  // 意味の塊ごとに分けて出し、塊の間だけで改行させる（語の途中で切れないように）。
  // 塊の間に <wbr> を入れて改行できる場所を明示する。gap は全角スペースの代わりの余白
  const chunks = (parts: string[], gap = false) =>
    parts.flatMap((t, i) => [
      ...(i ? [<wbr key={`w${i}`} />] : []),
      <span key={i} className={`inline-block ${gap && i ? 'ml-2' : ''}`}>
        {t}
      </span>,
    ])
  // 全角スペースで区切った見出し用
  const phrases = (text: string) => chunks(text.split('　'), true)

  // 数値入力（0 以上）。閲覧専用では無効
  const numIn = (testid: string, value: number, onChange: (v: number) => void, cls = 'w-20', max?: number) => (
    <input
      data-testid={testid}
      type="number"
      min={0}
      max={max}
      value={value}
      disabled={ro}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className={`h-9 border border-line rounded px-2 num text-sm text-right bg-white disabled:bg-canvas ${cls}`}
    />
  )
  const card = (title: ReactNode, body: ReactNode, cls = '') => (
    <div className={`bg-white rounded-2xl shadow-card border border-line p-4 sm:p-5 text-sm ${cls}`}>
      <h2 className="font-bold mb-2">{title}</h2>
      {body}
    </div>
  )
  // 投資の1行：項目／名称／入力欄／単位／固定費の式／金額。
  // 名称・入力欄・単位は別の列にして縦に揃える（入力欄の幅はすべて同じ）。閲覧専用では入力できない
  const invRow = (
    key: string,
    label: string,
    name: ReactNode,
    value: number,
    onChange: (v: number) => void,
    unitLabel: string,
    formula: string,
    amount: number,
    max?: number,
  ) => (
    <tr key={key} className="h-11 border-b border-line/60 align-middle">
      <td className="hidden sm:table-cell pr-2 text-ink-500 whitespace-nowrap">{label}</td>
      <td className="pr-2 whitespace-nowrap leading-tight">
        {name}
        {/* 狭い画面では勘定科目と計算式を名称の下にまとめる（列を減らして横スクロールを避ける） */}
        <span className="sm:hidden block text-[10px] text-ink-400 whitespace-normal">
          {label && `${label}　`}
          {formula}
        </span>
      </td>
      <td className="pr-1 w-20">{numIn(`plan-${key}`, value, (v) => onChange(Math.round(v)), 'w-16 h-7', max)}</td>
      <td className="pr-3 text-ink-500 whitespace-nowrap w-6">{unitLabel}</td>
      <td className="hidden sm:table-cell pr-2 text-ink-400 whitespace-nowrap">{formula}</td>
      <td className="pl-2 text-right num whitespace-nowrap">{fmt(amount)}</td>
    </tr>
  )
  // 入力欄のない行（上の入力から決まる費用。例：採用した人の期末の給料）
  const derivedRow = (key: string, label: string, name: string, formula: string, amount: number) => (
    <tr key={key} className="h-11 border-b border-line/60 align-middle">
      <td className="hidden sm:table-cell pr-2 text-ink-500 whitespace-nowrap">{label}</td>
      <td className="pr-2 whitespace-nowrap leading-tight">
        {name}
        {/* 狭い画面では勘定科目と計算式を名称の下にまとめる */}
        <span className="sm:hidden block text-[10px] text-ink-400 whitespace-normal">
          {label && `${label}　`}
          {formula}
        </span>
      </td>
      <td className="pr-1 w-20"></td>
      <td className="pr-3 w-6"></td>
      <td className="hidden sm:table-cell pr-2 text-ink-400 whitespace-nowrap">{formula}</td>
      <td className="pl-2 text-right num whitespace-nowrap">{fmt(amount)}</td>
    </tr>
  )
  // アクションプラン1行の数量の上限と、その説明（入力欄の title に出す）
  const qtyMax = (i: number) => actionQtyMax(plan.actions[i].key, plan, st)
  const qtyHint = (i: number) => {
    const max = qtyMax(i)
    return max == null ? '1回の上限なし' : `1回の上限 ${max}${PLAN_ACTION_UNITS[plan.actions[i].key] ?? ''}`
  }
  const u = fc.units
  const item = (key: string) => fc.items.find((x) => x.key === key)!
  // 目安の1行：見出し・説明・その値を入れるボタン
  const hintRow = (testid: string, title: string, body: ReactNode, value: number) => (
    <div
      data-testid={testid}
      className="rounded-lg bg-accent-bg border border-accent/30 px-3 py-2 text-xs text-ink-600 flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      <span className="font-bold text-accent-ink whitespace-nowrap">{title}</span>
      <span className="min-w-0">{body}</span>
      {!ro && (
        <button
          data-testid={`${testid}-apply`}
          onClick={() => update({ g: value })}
          className="ml-auto h-7 px-2 rounded-md border border-line bg-white text-ink-600 font-bold whitespace-nowrap"
        >
          この値を入れる
        </button>
      )}
    </div>
  )
  // たたんだ計画の要約1項目。見出しの上下で分けて、狭い画面でも縦のラインがそろうようにする
  const sumItem = (label: string, value: string, cls: string) => (
    <div key={label} className="min-w-0">
      <div className="text-[11px] text-ink-400 whitespace-nowrap">{label}</div>
      <b className={`num text-base ${cls}`}>{value}</b>
    </div>
  )

  return (
    <div className="space-y-6" data-testid="plan">
      <div className="rounded-2xl border border-g-base/30 bg-g-bg px-5 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="font-black text-g-ink">第{period}期 経営計画書</h2>
        <span className="text-g-ink/80 text-xs">
          会社名 <b>{st.name}</b>　社長名 <b>{st.president}</b>
        </span>
        {past && onBack && (
          <button
            data-testid="plan-back"
            onClick={onBack}
            className="ml-auto h-7 px-3 rounded-md border border-g-base/40 bg-white text-xs font-bold text-g-ink"
          >
            履歴に戻る
          </button>
        )}
        <p className="text-g-ink/80 text-xs basis-full" data-testid="plan-note">
          {past
            ? `第${period}期に立てた経営計画です（記録）。変更はできません。`
            : locked
              ? '記帳を始めたので、この期の経営計画は変更できません。'
              : `入力は自動で保存されます。${game.spectator ? '（閲覧専用）' : ''}`}
        </p>
      </div>

      {/* 段1：計画を立てる。ここがそろうまで段2（動き方）は開かない */}
      <section className="relative pl-5" data-testid="plan-stage-plan">
        <span aria-hidden className="absolute left-0 top-1 bottom-0 w-[3px] rounded-full bg-g-base/60" />
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-black">まず、経営計画を立てる</h2>
          <p className="text-xs text-ink-400">目標の経常利益から、必要な販売数を逆算します</p>
          {ready && (
            <button
              data-testid="plan-fold"
              onClick={() => setFolded((v) => !v)}
              className="ml-auto h-7 px-3 rounded-md border border-line bg-white text-xs font-bold text-ink-600"
            >
              {folded ? '経営計画を表示' : '経営計画を折りたたむ'}
            </button>
          )}
        </div>
        {folded ? (
          // たたんだときは、動き方を書くのに要る数字だけ1行で残す
          <div
            className="rounded-2xl border border-line bg-white shadow-card px-4 sm:px-5 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3"
            data-testid="plan-summary"
          >
            {sumItem('経常利益 G', fmt(plan.g), 'text-g-ink')}
            {sumItem('固定費 F', fmt(fig.F), 'text-f-ink')}
            {sumItem('必要粗利益 MQ', fmt(fig.MQ), 'text-m-ink')}
            {sumItem('粗利単価 M', fmtA(fig.M), 'text-m-ink')}
            {sumItem('売上必要個数 Q', `${n(fig.Q)}個`, 'text-ink')}
          </div>
        ) : (
          // 上から順に1カラム。2. 固定費のカードの中だけ「現況｜戦略的投資」の2カラムにする
          <div className="space-y-4">
          {card(
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-g-ink">1. 必要経常利益（G）を決定</span>
              <button
                data-testid="plan-g-help"
                onClick={() => setGHelp(true)}
                aria-label="経常利益の目安の説明を開く"
                className="shrink-0 w-6 h-6 rounded-full border border-line bg-white text-ink-400 font-bold text-xs leading-none"
              >
                ?
              </button>
            </span>,
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-500">経常利益目標</span>
                {numIn('plan-g', plan.g, (v) => update({ g: v }), 'w-28 text-base font-bold text-g-ink border-g-base/50')}
              </div>
              {/* 目安：赤字の解消（期首の利益剰余金がマイナスのとき）と、1位との差（他社の決算があるとき） */}
              {(gHint != null || (gap && gap.g != null)) && (
                <div className="mt-2 space-y-2">
                  {gHint != null &&
                    hintRow(
                      'plan-g-hint',
                      '赤字を解消する',
                      <>
                        期首の利益剰余金 <b className="num text-accent-ink">▲{fmt(-st.retained)}</b> を期末にゼロへ戻すには、経常利益{' '}
                        <b className="num text-ink">{fmt(gHint)}</b> 以上
                      </>,
                      gHint,
                    )}
                  {gap && gap.g != null &&
                    hintRow(
                      'plan-rank-hint',
                      '1位との差を埋める',
                      <>
                        <b>{gap.topName}</b> と純資産で <b className="num text-accent-ink">{fmt(gap.gap)}</b> 差。今期で埋めるには、経常利益{' '}
                        <b className="num text-ink">{fmt(gap.g)}</b> 以上
                      </>,
                      gap.g,
                    )}
                </div>
              )}
            </div>,
          )}
          {card(
            <span className="text-f-ink">2. 固定費（F）を算出</span>,
            <div className="space-y-3">
              {/* 左：現況（入力なし）／右：戦略的投資（入力あり）。合計はその下に置く */}
              <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-x-6 gap-y-3">
              <div className="min-w-0 flex flex-col">
                <div className="flex justify-between items-baseline gap-2 mb-1 h-6">
                  <span className="text-xs font-bold text-ink-600">{phrases('現況　今期必ず発生する費用')}</span>
                  <span className="hidden sm:inline text-[10px] text-ink-400 whitespace-nowrap">入力なし・自動で計算</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="h-7 text-ink-400 border-b border-line align-bottom">
                        <th className="text-left pr-2 font-normal whitespace-nowrap">勘定科目</th>
                        <th className="text-left pr-2 font-normal whitespace-nowrap">内訳</th>
                        <th className="text-right pl-2 font-normal whitespace-nowrap">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fc.items
                        .filter((x) => x.col === 'now')
                        .map((x) => (
                          <tr
                            key={x.key}
                            className="h-11 border-b border-line/60 align-middle"
                            data-testid={`plan-now-${x.key}`}
                          >
                            <td className="pr-2 text-ink-500 whitespace-nowrap">{x.label}</td>
                            <td className="pr-2 leading-tight">{x.detail}</td>
                            <td className="pl-2 text-right num whitespace-nowrap">{fmt(x.amount)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {/* 小計は表の外に出し、mt-auto で列の下端へ。左右の小計の高さがそろう */}
                <div className="mt-auto h-11 flex items-center justify-between font-bold text-xs">
                  <span>現況 小計</span>
                  <span className="num" data-testid="plan-F-now">
                    {fmt(fc.now)}
                  </span>
                </div>
              </div>

              {/* 右：戦略的投資。実施する数を入力すると、それに伴う固定費が出る */}
              <div className="min-w-0 flex flex-col">
                <div className="flex justify-between items-baseline gap-2 mb-1 h-6">
                  <span className="text-xs font-bold text-ink-600">{phrases('戦略的投資　今期あらたに実施する投資')}</span>
                  <span className="hidden sm:inline text-[10px] text-ink-400 whitespace-nowrap">実施する数量を入力</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="h-7 text-ink-400 border-b border-line align-bottom">
                        <th className="hidden sm:table-cell text-left pr-2 font-normal whitespace-nowrap">勘定科目</th>
                        <th className="text-left pr-2 font-normal whitespace-nowrap" colSpan={3}>
                          今期の実施内容
                        </th>
                        <th className="hidden sm:table-cell text-left pr-2 font-normal whitespace-nowrap">固定費の計算</th>
                        <th className="text-right pl-2 font-normal whitespace-nowrap">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* 採用は製造・販売に分けて入れる（配置先で能力が変わるため） */}
                      {invRow('hireMfg', '一般管理費', '今期 採用する製造スタッフ', plan.hireMfg, (v) => update({ hireMfg: v }), '人',
                        `採用費 ${u.hire} × ${plan.hireMfg}人`, item('hireMfg').amount)}
                      {invRow('hireSales', '一般管理費', '今期 採用する販売員', plan.hireSales, (v) => update({ hireSales: v }), '人',
                        `採用費 ${u.hire} × ${plan.hireSales}人`, item('hireSales').amount)}
                      {derivedRow('hireSalary', '人件費', '採用したスタッフの期末給料', `給料 ${u.sal} × ${plan.hireMfg + plan.hireSales}人`, item('hireSalary').amount)}
                      {invRow('machinesNew', '減価償却費', '今期 購入する機械（什器）', plan.machinesNew, (v) => update({ machinesNew: v }), '台',
                        `減価償却 ${u.dep} × ${plan.machinesNew}台`, item('depNew').amount)}
                      {/* 教育チップは期を通して最大1枚（記帳と同じ） */}
                      {invRow('edu', '一般管理費', '今期 実施する教育', plan.edu, (v) => update({ edu: Math.min(EDU_MAX, v) }), '枚',
                        `${u.edu} × ${plan.edu}枚`, item('edu').amount, EDU_MAX)}
                      {invRow('ins', '', '今期 加入する保険', plan.ins, (v) => update({ ins: v }), '枚',
                        `${u.ins} × ${plan.ins}枚`, item('ins').amount)}
                      {invRow('ads', '販売費', '今期 実施する広告', plan.ads, (v) => update({ ads: v }), '枚',
                        `${u.ads} × ${plan.ads}枚`, item('ads').amount)}
                      {invRow('dev', '研究開発費', '今期 実施する商品開発', plan.dev, (v) => update({ dev: v }), '枚',
                        `${u.dev} × ${plan.dev}枚`, item('dev').amount)}
                      {invRow(
                        'loanNew',
                        '営業外費用',
                        <>
                          今期 あらたに借入する金額
                          {/* いくらまで借りられるかが分からないと金額を決められないので、枠をその場に出す */}
                          <span
                            className={`block text-[10px] leading-tight ${
                              plan.loanNew > room ? 'text-accent-ink font-bold' : 'text-ink-400'
                            }`}
                            data-testid="plan-loan-room"
                          >
                            今期借入可能額 {fmt(room)}
                            {plan.loanNew > room && '　※ 超過'}
                          </span>
                        </>,
                        plan.loanNew,
                        (v) => update({ loanNew: v }),
                        '',
                        `借入額 × 金利${u.ratePct}%`,
                        item('intNew').amount,
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="mt-auto h-11 flex items-center justify-between font-bold text-xs">
                  <span>戦略的投資 小計</span>
                  <span className="num" data-testid="plan-F-new">
                    {fmt(fc.next)}
                  </span>
                </div>
              </div>
              </div>

              <div className="flex justify-between items-center rounded-lg bg-f-bg px-3 py-2">
                <span className="font-bold text-f-ink">{phrases('★ 固定費（F）合計　現況 ＋ 戦略的投資')}</span>
                <b className="num text-f-ink text-lg" data-testid="plan-F">
                  {fmt(fig.F)}
                </b>
              </div>
            </div>,
          )}
          {/* 2. の投資で能力がどれだけ増えるか。期首 ／ 投資で増える分 ／ 合計（投資を全部実施したときの最大） */}
          {card(
            <span className="flex items-baseline gap-2 flex-wrap">
              <span className="text-f-ink">能力の比較</span>
              <span className="text-xs font-normal text-ink-400">期首の能力と、戦略的投資でどれだけ増えるか（1回あたり）</span>
            </span>,
            <div className="space-y-2" data-testid="plan-capacity">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-ink-400">
                      <th className="text-left font-normal py-1"></th>
                      <th className="text-right font-normal py-1 px-2 whitespace-nowrap">期首</th>
                      <th className="text-right font-normal py-1 px-2 whitespace-nowrap">投資で増える</th>
                      <th className="text-right font-normal py-1 pl-2 whitespace-nowrap">合計（最大）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capRows.map((c) => (
                      <Fragment key={c.key}>
                      <tr className="border-t border-line/70 align-top" data-testid={`plan-cap-${c.key}`}>
                        <td className="py-2 pr-2">
                          <div className="font-bold whitespace-nowrap">{c.label}</div>
                          <div className="text-[10px] text-ink-400">期首：{c.openDetail}</div>
                        </td>
                        <td className="py-2 px-2 text-right num" data-testid={`plan-cap-${c.key}-open`}>
                          {c.open}
                          <span className="text-[10px] text-ink-400 ml-0.5">個</span>
                        </td>
                        {/* 増えた数は下の内訳の行に出すので、能力の行では空けておく */}
                        <td className="py-2 px-2" />
                        <td className="py-2 pl-2 text-right num font-black text-base" data-testid={`plan-cap-${c.key}-total`}>
                          {c.total}
                          <span className="text-[10px] font-normal text-ink-400 ml-0.5">個</span>
                        </td>
                      </tr>
                      {/* 投資ごとの内訳：流れ順に1つずつ足したときに何個増えるか。上限で頭打ちの投資は理由を注意の色で出す */}
                      {c.steps.map((sp) => (
                        <Fragment key={sp.key}>
                          {/* 名前は「期首」の列までまたいで幅を取り、根拠・理由は次の行に全幅で出す（スマホで細く折り返さないように） */}
                          <tr className="align-top" data-testid={`plan-cap-step-${sp.key}`}>
                            <td colSpan={2} className="pt-0.5 pr-2 pl-3 text-xs text-ink-600">
                              └ {sp.label}
                            </td>
                            <td
                              className={`pt-0.5 px-2 text-right num text-xs whitespace-nowrap ${sp.delta > 0 ? 'text-f-ink' : 'text-accent-ink'}`}
                              data-testid={`plan-cap-step-${sp.key}-delta`}
                            >
                              ＋{sp.delta}
                              <span className="text-[10px] text-ink-400 ml-0.5">個</span>
                            </td>
                            {/* 合計は能力の行に出すので、内訳の行では空けておく */}
                            <td className="pt-0.5 pl-2" />
                          </tr>
                          <tr>
                            <td colSpan={4} className={`pb-1.5 pl-6 text-[10px] ${sp.limited ? 'text-accent-ink' : 'text-ink-400'}`}>
                              {sp.limited ? '⚠ ' : ''}
                              {sp.note}
                            </td>
                          </tr>
                        </Fragment>
                      ))}
                      {!c.steps.length && (
                        <tr>
                          <td colSpan={4} className="pb-1.5 pl-3 text-[10px] text-ink-400">
                            {c.key === 'mfg' ? '製造スタッフの採用・機械購入・教育' : '販売員の採用・広告'}を入れると、ここに増える内訳が出ます
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>,
          )}
          {card(
            <span className="text-m-ink">{chunks(['3. 商品の必要粗利益（付加価値）', '額（MQ）を計算'])}</span>,
            <div className="flex justify-between items-center rounded-lg bg-m-bg px-3 py-2">
              <span className="text-m-ink text-xs">{phrases('1. 経常利益目標（G）　＋　2. 固定費（F）合計')}</span>
              <b className="num text-m-ink text-lg" data-testid="plan-MQ">
                {fmt(fig.MQ)}
              </b>
            </div>,
          )}
          {card(
            <span className="text-p-ink">4. 商品の各単価目標を設定</span>,
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-ink-500">{phrases('①販売単価（P）　商品1個あたり平均いくらで売るか')}</span>
                {numIn('plan-p', plan.p, (v) => update({ p: v }), 'w-24 text-p-ink font-bold')}
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-ink-500">{phrases('②売上原価（V）　売上原価1個あたり平均いくらで仕入れるか')}</span>
                {numIn('plan-v', plan.v, (v) => update({ v: v }), 'w-24 text-v-ink font-bold')}
              </div>
              <div className="flex items-center justify-between rounded-lg bg-m-bg px-3 py-2">
                <span className="text-m-ink text-xs">{phrases('③計画粗利益（付加価値）単価（M）　式＜P − V＞')}</span>
                <b className="num text-m-ink text-lg" data-testid="plan-M">
                  {fmtA(fig.M)}
                </b>
              </div>
            </div>,
          )}
          {card(
            '5. 売上必要個数（Q）を算出',
            <div className="space-y-2">
              <div className="rounded-lg bg-canvas px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink-500 text-xs">{chunks(['MQ ÷ M ＝ 必要個数', '（小数点以下は切り上げ）'])}</span>
                  <b className="num text-lg whitespace-nowrap" data-testid="plan-Q">
                    {n(fig.Q)}
                    <span className="text-xs font-normal text-ink-400 ml-0.5">個</span>
                  </b>
                </div>
                {/* 計算できない理由は、行を折り返さず下に置く */}
                {fig.Q == null && (
                  <p className="mt-1 text-xs text-accent-ink">粗利単価 M が 0 以下のため計算できません</p>
                )}
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
          {/* 1〜5 の数字を面積で見る。決算書の STRAC 図と同じ描き方 */}
          {stracHtml &&
            card(
              <span className="flex items-baseline gap-2 flex-wrap">
                <span>計画の STRAC 図</span>
                <span className="text-xs font-normal text-ink-400">1〜5 の数字を面積で見る</span>
              </span>,
              <div>
                <div data-testid="plan-strac" className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: stracHtml }} />
                {/* 個数は切り上げるので、図の経常利益は目標より少し多くなることがある */}
                {fig.Q != null && fig.PQ != null && fig.VQ != null && fig.PQ - fig.VQ - fig.F !== plan.g && (
                  <p className="mt-2 text-[10px] text-ink-400">
                    売上必要個数を切り上げているので、図の経常利益 G は目標の <b className="num">{fmt(plan.g)}</b> より{' '}
                    <b className="num">{fmt(fig.PQ - fig.VQ - fig.F - plan.g)}</b> 多くなっています。
                  </p>
                )}
              </div>,
            )}
          {/* このプランを実施するのに必要な現金。期首処理を払ったあとの現金と比べて、足りるか・借入が要るかを見る */}
          {card(
            <span className="flex items-baseline gap-2 flex-wrap">
              <span>このプランの実施に必要な現金</span>
              <span className="text-xs font-normal text-ink-400">当期に出ていくお金の全部</span>
            </span>,
            <div className="space-y-2 text-sm" data-testid="plan-cash">
              {need.items.map((it) => (
                <div key={it.key} className="flex justify-between items-baseline gap-3 border-b border-line/60 pb-1.5">
                  <span className="min-w-0">
                    <span className="font-bold">{it.label}</span>
                    <span className="block text-[10px] text-ink-400">{it.detail}</span>
                  </span>
                  <b className="num whitespace-nowrap" data-testid={`plan-cash-${it.key}`}>
                    {fmt(it.amount)}
                  </b>
                </div>
              ))}
              <div className="flex justify-between items-center rounded-lg bg-canvas px-3 py-2">
                <span className="font-bold">当期の出金 合計</span>
                <b className="num text-lg" data-testid="plan-cash-total">
                  {fmt(need.total)}
                </b>
              </div>
              <div className="flex justify-between items-baseline gap-3 px-3">
                <span className="text-ink-500 text-xs">前期から繰り越した現金</span>
                <b className="num" data-testid="plan-cash-open">
                  {fmtA(need.openingCash)}
                </b>
              </div>
              {/* 差がマイナスなら売上の入金前に現金が足りなくなる → 借入などで手当てが必要 */}
              <div
                className={`flex justify-between items-center rounded-lg px-3 py-2 font-bold ${
                  need.diff < 0 ? 'bg-accent/10 text-accent-ink' : 'bg-m-bg text-m-ink'
                }`}
                data-testid="plan-cash-diff"
              >
                <span>{need.diff < 0 ? '不足（借入などが必要）' : '余裕'}</span>
                <b className="num text-lg">{fmt(Math.abs(need.diff))}</b>
              </div>
              {need.endCash != null && (
                <p className="text-[11px] text-ink-400 px-1" data-testid="plan-cash-end">
                  売上高 <b className="num text-ink-600">{fmt(need.sales ?? 0)}</b> が入ると、期末の現金の見込みは{' '}
                  <b className="num text-ink-600">{fmtA(need.endCash)}</b>
                </p>
              )}
            </div>,
          )}
          </div>
        )}
      </section>

      {/* 段2：動き方を決める。計画がそろってから開く（開く瞬間だけ出現アニメ） */}
      {ready ? (
        <section
          className={`relative pl-5 ${revealOnOpen ? 'plan-reveal' : ''}`}
          data-testid="plan-stage-actions"
        >
          <span aria-hidden className="absolute left-0 top-1 bottom-0 w-[3px] rounded-full bg-cin-base/60" />
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-black">次に、実行計画を決める</h2>
            <p className="text-xs text-ink-400">
              <span className="inline-block">
                <b className="num text-ink">{n(fig.Q)}</b> 個を販売するために、
              </span>
              <wbr />
              <span className="inline-block">どのアクションを何回実施するかを決めます</span>
            </p>
          </div>
          {/* 回数を確かめてから表に落とす順なので、横に並べず上から下へ積む */}
          <div className="space-y-4">
          {/* 計画から逆算した「どのアクションを何回やるか」。下の表で選んだ回数と見くらべられるようにする */}
          {card(
            <span className="flex justify-between items-baseline">
              <span>6. 必要なアクション回数</span>
              <span className="hidden sm:inline text-xs font-normal text-ink-500">1行＝1回として集計します</span>
            </span>,
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:min-w-[430px]">
                <thead>
                  <tr className="text-ink-400 border-b border-line">
                    <th className="text-left py-1 pr-2 font-normal whitespace-nowrap">アクション</th>
                    <th className="text-right py-1 px-1 font-normal whitespace-nowrap">必要</th>
                    <th className="hidden sm:table-cell text-left py-1 px-2 font-normal">根拠</th>
                    <th className="text-right py-1 px-1 font-normal whitespace-nowrap">計画</th>
                    <th className="text-right py-1 pl-1 font-normal whitespace-nowrap">過不足</th>
                  </tr>
                </thead>
                <tbody>
                  {needs.map((nd) => {
                    // 必要回数 − 計画に入れた回数。プラスなら足りない
                    const short = nd.need == null ? null : nd.need - nd.planned
                    return (
                      <tr key={nd.key} className="border-b border-line/60" data-testid={`plan-need-${nd.key}`}>
                        <td className="py-1.5 pr-2 whitespace-nowrap">{nd.label}</td>
                        <td className="py-1.5 px-1 text-right num whitespace-nowrap">{nd.need == null ? '—' : `${nd.need}回`}</td>
                        <td className="hidden sm:table-cell py-1.5 px-2 text-ink-400 whitespace-nowrap">{nd.detail}</td>
                        <td className="py-1.5 px-1 text-right num whitespace-nowrap">{nd.planned}回</td>
                        <td
                          className={`py-1.5 pl-1 text-right whitespace-nowrap ${
                            short != null && short > 0 ? 'text-accent-ink font-bold' : 'text-ink-400'
                          }`}
                        >
                          {short == null ? '—' : short > 0 ? `残り${short}回` : '✓'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-ink-400">
                製造能力・販売能力は「現在の会社盤 ＋ 今期の機械購入・教育・広告」で算出しています。
                採用するスタッフは製造・販売どちらに配置するかで能力が変わるため、ここには含めていません。
              </p>
            </div>,
          )}
          {card(
            <span className="flex justify-between items-baseline">
              <span>7. アクションプラン</span>
              <span className="text-xs font-normal text-ink-500 whitespace-nowrap">
                前期繰越残高 <b className="num text-ink">{fmt(cash.openingCash)}</b>
              </span>
            </span>,
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:min-w-[420px]">
                <thead>
                  <tr className="text-ink-400 border-b border-line">
                    <th className="hidden sm:table-cell w-7 py-1 font-normal"></th>
                    <th className="text-left py-1 font-normal whitespace-nowrap">アクション</th>
                    <th className="text-right py-1 px-1 pr-6 font-normal whitespace-nowrap">数量</th>
                    <th className="text-right py-1 px-1 font-normal whitespace-nowrap">
                      <span className="sm:hidden">入出金</span>
                      <span className="hidden sm:inline">入出金（＋入／−出）</span>
                    </th>
                    <th className="text-right py-1 px-1 font-normal whitespace-nowrap">現金残高</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line/60 bg-canvas">
                    <td className="hidden sm:table-cell" />
                    <td className="py-1.5 text-ink-500" colSpan={2}>
                      期首処理（納税・支払金利）
                    </td>
                    <td className="py-1.5 px-1 text-right num">{fmtA(cash.openingAuto)}</td>
                    <td className="py-1.5 px-1 text-right num">{fmt(cash.openingCash + cash.openingAuto)}</td>
                  </tr>
                  {cash.rows.map((r, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="hidden sm:table-cell py-1 text-ink-400 text-center num">{i + 1}</td>
                      <td className="py-1 pr-1 min-w-24">
                        <select
                          data-testid={`plan-act-key-${i}`}
                          value={plan.actions[i].key}
                          disabled={ro}
                          onChange={(e) => updateAction(i, { key: e.target.value })}
                          className="h-7 w-full border border-line rounded px-2 text-xs bg-white disabled:bg-canvas"
                        >
                          <option value="">（未選択）</option>
                          {PLAN_ACTION_OPTIONS.map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 px-1 whitespace-nowrap">
                        {/* 数量を入れると入出金が自動で入る。単位はアクションで変わるが、
                            単位が無いアクション（借入・返済）でも入力欄の位置がずれないよう幅を固定する */}
                        {plan.actions[i].key && (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              data-testid={`plan-act-qty-${i}`}
                              type="number"
                              min={0}
                              max={qtyMax(i) ?? undefined}
                              title={qtyHint(i)}
                              value={plan.actions[i].qty}
                              disabled={ro}
                              onChange={(e) => updateAction(i, { qty: Number(e.target.value) || 0 })}
                              className="h-7 w-12 sm:w-16 border border-line rounded px-1 sm:px-2 num text-xs text-right bg-white disabled:bg-canvas"
                            />
                            <span className="w-4 text-ink-400">{PLAN_ACTION_UNITS[plan.actions[i].key] ?? ''}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-1 px-1 text-right">
                        <input
                          data-testid={`plan-act-amt-${i}`}
                          type="number"
                          value={plan.actions[i].amount}
                          disabled={ro}
                          onChange={(e) => updateAction(i, { amount: Number(e.target.value) || 0 })}
                          className="h-7 w-[4.25rem] sm:w-24 border border-line rounded px-1 sm:px-2 num text-xs text-right bg-white disabled:bg-canvas"
                        />
                      </td>
                      <td className={`py-1 px-1 text-right num ${r.balance < 0 ? 'text-accent-ink font-bold' : ''}`}>
                        {fmtA(r.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-ink-400">
                数量は1回でできる上限までに収まります。仕入れは材料在庫の上限、製造は製造能力と店舗陳列の上限、販売は販売能力、
                教育・商品開発は1回1枚、配置転換はスタッフ数、借入は今期借入可能額、返済は借入残高までです。
              </p>
            </div>,
          )}
          </div>
        </section>
      ) : (
        <section className="relative pl-5" data-testid="plan-stage-locked">
          <span aria-hidden className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-line" />
          <div className="rounded-2xl border-2 border-dashed border-line px-5 py-6">
            <h2 className="text-lg font-black text-ink-400">次に、実行計画を決める</h2>
            <p className="mt-1 text-xs text-ink-400">
              経営計画が完成すると、必要なアクション回数と 25 行のアクションプランを表示します。
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-ink-600" data-testid="plan-locked-todo">
              {missing.map((m) => (
                <li key={m} className="flex items-baseline gap-2">
                  <span className="text-ink-300 text-xs">○</span>
                  {m}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* 「?」の説明。目安をどう出しているかを書く */}
      {gHelp && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" data-testid="plan-g-help-modal">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setGHelp(false)} />
          <div
            className="relative w-full sm:max-w-md max-h-[85vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 text-sm"
            style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
          >
            <h3 className="font-black text-lg mb-1">経常利益（G）の決め方</h3>
            <p className="text-ink-500 text-xs mb-4">目標をいくらにするか迷ったときの、2つの目安の出し方です。</p>

            <h4 className="font-bold text-accent-ink mb-1">赤字を解消する</h4>
            <p className="text-ink-600 text-xs leading-relaxed mb-2">
              期首の利益剰余金がマイナスのときだけ出ます。期末にそれをゼロへ戻すには、
              <b>法人税を引いたあとの利益（当期純利益）が赤字の額以上</b>になる必要があります。
              決算と同じ法人税の式で「経常利益 − 法人税 ≧ 赤字」となる最小の額を探しています。
              繰越損失があるぶんは課税されないので、実質「赤字 ＋ 最低税額 5」になります。
            </p>
            {gHint != null && (
              <p className="text-ink-500 text-xs mb-4">
                いまの計算：赤字 <b className="num">{fmt(-st.retained)}</b> → 必要な経常利益{' '}
                <b className="num text-ink">{fmt(gHint)}</b>
              </p>
            )}

            <h4 className="font-bold text-accent-ink mb-1">1位との差を埋める</h4>
            <p className="text-ink-600 text-xs leading-relaxed mb-2">
              同じ研修で<b>純資産（資本金 ＋ 利益剰余金）が1番多い会社</b>との差を見ます。
              期末の純資産は「期首の純資産 ＋ 当期純利益」なので、差を埋めるには
              <b>税引後の利益が差の額以上</b>になる必要があります。赤字解消と同じ式で必要な経常利益を出しています。
            </p>
            <p className="text-ink-400 text-xs leading-relaxed mb-2">
              ※ 相手も今期伸びるので、これは「いまの差」に対する目安です。増資をすれば純資産は増えますが、
              ここでは増資しない前提で計算しています。他社の決算がまだ1件も無いときは出ません。
            </p>
            {gap && (
              <p className="text-ink-500 text-xs mb-4">
                いまの計算：1位 <b>{gap.topName}</b> の純資産 <b className="num">{fmt(gap.topEquity)}</b> − 自社{' '}
                <b className="num">{fmt(gap.myEquity)}</b> ＝ 差 <b className="num">{fmt(gap.gap)}</b>
                {gap.g != null ? (
                  <>
                    {' '}→ 必要な経常利益 <b className="num text-ink">{fmt(gap.g)}</b>
                  </>
                ) : (
                  <>（自社が1位です）</>
                )}
              </p>
            )}

            <button
              data-testid="plan-g-help-close"
              onClick={() => setGHelp(false)}
              className="w-full h-11 rounded-xl bg-ink text-white font-bold"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
