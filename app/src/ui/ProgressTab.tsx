// 進捗タブ：ゲームの途中で、今期の経営計画に対して今どこまで来ているかを見る（issue #64）。
// 数値ルール progressFromPeriod（既定 第4期）以降で、経営計画書タブが出ている期だけ表示する（Participant.tsx 側で制御）。
// 計算は lib/plan.ts の progressNow()。ここは表示だけ。
import { fmt, fmtA } from '../lib/calc'
import { normalizePlan, progressNow, type ProgressItem } from '../lib/plan'
import type { Game } from '../state/useGame'

/** 達成率のバー。100% を超えたら満タンで止める */
function Bar({ rate }: { rate: number | null }) {
  const w = rate == null ? 0 : Math.max(0, Math.min(100, rate))
  return (
    <div className="h-1.5 w-full rounded-full bg-line/70 overflow-hidden">
      <div className={`h-full rounded-full ${w >= 100 ? 'bg-m-ink' : 'bg-cin-base'}`} style={{ width: `${w}%` }} />
    </div>
  )
}

export default function ProgressTab({ game, onToPlan }: { game: Game; onToPlan: () => void }) {
  const st = game.st
  const plan = normalizePlan(game.plans[String(st.period)])
  const pr = progressNow(plan, st)

  // 今期の計画が無い（単価が未記入で Q が出ていない）ときは、比べるものが無いので経営計画書へ案内する
  if (!pr)
    return (
      <div className="bg-white rounded-2xl shadow-card border border-line p-6 text-center space-y-3" data-testid="progress-noplan">
        <p className="text-sm text-ink-600">
          第{st.period}期の経営計画がまだありません。経営計画書で G・P・V を入れて売上必要個数（Q）を出すと、ここで計画と実績を比べられます。
        </p>
        <button onClick={onToPlan} className="h-11 px-5 rounded-xl bg-cin-base text-white font-bold hover:brightness-95">
          経営計画書へ
        </button>
      </div>
    )

  const val = (it: ProgressItem, v: number) => (it.key === 'MQ' ? fmtA(v) : fmt(v))
  const q = pr.items.find((x) => x.key === 'Q')!
  const actRate = pr.plannedTotal > 0 ? Math.round((pr.doneTotal / pr.plannedTotal) * 100) : null

  return (
    <div className="space-y-4" data-testid="progress">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="font-black">第{st.period}期 計画に対する進捗</h2>
        <span className="text-xs text-ink-400">記帳するたびに更新されます</span>
      </div>

      {/* 要約：売上の達成率・行動の消化率・残りの販売回数・今の現金 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl bg-white border border-line shadow-card px-3 py-2">
          <div className="text-[10px] text-ink-500">売上個数の達成率</div>
          <div className="num font-black text-xl" data-testid="progress-q-rate">
            {q.rate ?? '—'}
            <span className="text-xs font-normal text-ink-400">%</span>
          </div>
        </div>
        <div className="rounded-xl bg-white border border-line shadow-card px-3 py-2">
          <div className="text-[10px] text-ink-500">アクションプランの消化</div>
          <div className="num font-black text-xl" data-testid="progress-act-rate">
            {actRate ?? '—'}
            <span className="text-xs font-normal text-ink-400">%</span>
          </div>
          <div className="text-[10px] text-ink-400 num">
            {pr.doneTotal} ／ {pr.plannedTotal} 回
          </div>
        </div>
        <div className="rounded-xl bg-white border border-line shadow-card px-3 py-2">
          <div className="text-[10px] text-ink-500">計画達成まで</div>
          <div className="num font-black text-xl" data-testid="progress-q-left">
            {q.remain}
            <span className="text-xs font-normal text-ink-400">個</span>
          </div>
          {/* 残りの個数を今の販売能力で割った回数。能力 0 のときは販売員・広告が必要 */}
          <div className="text-[10px] text-ink-400" data-testid="progress-sales-times">
            {q.remain === 0
              ? '達成しました'
              : pr.salesLeftTimes == null
                ? '販売能力が 0 です'
                : `販売あと ${pr.salesLeftTimes} 回（1回 ${pr.salesCap}個）`}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-line shadow-card px-3 py-2">
          <div className="text-[10px] text-ink-500">今の現金</div>
          <div className={`num font-black text-xl ${pr.cash < 0 ? 'text-accent-ink' : ''}`} data-testid="progress-cash">
            {fmtA(pr.cash)}
          </div>
        </div>
      </div>

      {/* 計画とここまでの実績。達成率と残り */}
      <div className="bg-white rounded-2xl shadow-card border border-line p-4">
        <h3 className="font-bold text-sm mb-2">今期の計画と、ここまでの実績</h3>
        <div className="space-y-3">
          {pr.items.map((it) => (
            <div key={it.key} data-testid={`progress-${it.key}`}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-bold">{it.label}</span>
                <span className="num whitespace-nowrap">
                  <b className="text-base">{val(it, it.actual)}</b>
                  <span className="text-ink-400 text-xs">
                    {' '}
                    ／ 計画 {val(it, it.plan)}
                    {it.unit}
                  </span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Bar rate={it.rate} />
                <span className="num text-[11px] text-ink-500 w-10 text-right">{it.rate == null ? '—' : `${it.rate}%`}</span>
              </div>
              {it.remain > 0 && (
                <div className="text-[10px] text-ink-400 mt-0.5">
                  残り {val(it, it.remain)}
                  {it.unit}
                </div>
              )}
            </div>
          ))}
        </div>
        {/* 期中は売上原価が棚卸で決まらないので、今期の仕入の実績から1個あたりの原価を出して概算する */}
        <p className="mt-3 text-[10px] text-ink-400" data-testid="progress-cost">
          粗利益は期中は売上原価が決まらないため、売上高 −（売上個数 × 1個あたりの原価
          <b className="num text-ink-600"> {pr.cost.unit}</b>）の概算です。
          {pr.cost.from === 'buy'
            ? `1個あたりの原価は今期の仕入金額の合計 ${fmt(pr.cost.buyAmt)} ÷ 仕入個数 ${pr.cost.buyQty}個。`
            : '今期はまだ仕入が無いので、計画の売上原価 V を使っています。'}
        </p>
      </div>

      {/* アクションプランの計画回数と、ここまでの実施回数 */}
      <div className="bg-white rounded-2xl shadow-card border border-line p-4">
        <h3 className="font-bold text-sm mb-2">アクションの実施回数</h3>
        {pr.actions.length ? (
          <table className="w-full text-sm" data-testid="progress-actions">
            <thead>
              <tr className="text-[11px] text-ink-400">
                <th className="text-left font-normal py-1">アクション</th>
                <th className="text-right font-normal py-1 px-2">計画</th>
                <th className="text-right font-normal py-1 px-2">実施</th>
                <th className="text-right font-normal py-1 pl-2">残り</th>
              </tr>
            </thead>
            <tbody>
              {pr.actions.map((a) => {
                const left = a.plan - a.done
                return (
                  <tr key={a.key} className="border-t border-line/70" data-testid={`progress-act-${a.key}`}>
                    <td className="py-1.5">{a.label}</td>
                    <td className="py-1.5 px-2 text-right num">{a.plan}回</td>
                    <td className="py-1.5 px-2 text-right num font-bold">{a.done}回</td>
                    {/* 計画どおり＝済、計画より多い＝＋、計画外のアクションは計画 0 回として＋で出す */}
                    <td className={`py-1.5 pl-2 text-right num ${left > 0 ? 'text-ink-600' : 'text-m-ink'}`}>
                      {left > 0 ? `${left}回` : left === 0 ? '済' : `＋${-left}回`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-ink-400">アクションプランが未入力です。</p>
        )}
      </div>
    </div>
  )
}
