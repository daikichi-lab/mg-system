// 進捗タブ：ゲームの途中で「目標 G を達成するには、これから何をすればよいか」を示す管理会計の指針（issue #64）。
// 数値ルール progressFromPeriod（既定 第4期）以降で、経営計画書タブが出ている期だけ表示する（Participant.tsx 側で制御）。
// 計算は lib/plan.ts の progressNow()。ここは表示だけ。
import { fmt, fmtA } from '../lib/calc'
import { normalizePlan, progressNow, type Guide } from '../lib/plan'
import type { Game } from '../state/useGame'

/** 小数1桁までの単価表示（平均単価は割り切れないことがある） */
const unit = (v: number) => (Number.isInteger(v) ? fmt(v) : v.toFixed(1))

// 有利・不利の色。粗利（MQ）のテーマ色はピンク系で「良い」に見えないので、有利は緑・不利は赤で統一する
const GOOD = 'text-emerald-700'
const BAD = 'text-accent-ink'

/** 見込みの判定を、色と一言で出す */
const STATUS: Record<Guide['status'], { cls: string; title: string }> = {
  achieved: { cls: 'bg-emerald-50 text-emerald-800 border-emerald-300', title: '目標 G に届く見込みです' },
  onTrack: { cls: 'bg-emerald-50 text-emerald-800 border-emerald-300', title: '計画の残り個数を今の単価で売れば、目標 G に届きます' },
  short: { cls: 'bg-accent/10 text-accent-ink border-accent/30', title: 'このままでは目標 G に届きません' },
}

export default function ProgressTab({ game, onToPlan }: { game: Game; onToPlan: () => void }) {
  const st = game.st
  const plan = normalizePlan(game.plans[String(st.period)])
  const gd = progressNow(plan, st)

  // 今期の計画が無い（単価が未記入で Q が出ていない）ときは、目標が無いので経営計画書へ案内する
  if (!gd)
    return (
      <div className="bg-white rounded-2xl shadow-card border border-line p-6 text-center space-y-3" data-testid="progress-noplan">
        <p className="text-sm text-ink-600">
          第{st.period}期の経営計画がまだありません。経営計画書で G・P・V を入れて売上必要個数（Q）を出すと、ここに目標 G を達成するための指針が出ます。
        </p>
        <button onClick={onToPlan} className="h-11 px-5 rounded-xl bg-cin-base text-white font-bold hover:brightness-95">
          経営計画書へ
        </button>
      </div>
    )

  const s = STATUS[gd.status]
  const actRate = gd.plannedTotal > 0 ? Math.round((gd.doneTotal / gd.plannedTotal) * 100) : null
  const extraQ = gd.needQ == null ? null : gd.needQ - gd.planRemainQ // 計画の残り個数との差（＋なら多く売る必要）

  return (
    <div className="space-y-4" data-testid="progress">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="font-black">第{st.period}期 目標 G を達成するための指針</h2>
        <span className="text-xs text-ink-400">記帳するたびに更新されます</span>
      </div>

      {/* 結論：届く見込みか。計画の残りを今の単価で売った場合の G と目標を並べる */}
      <div className={`rounded-2xl border p-4 ${s.cls}`} data-testid="progress-status">
        <div className="font-black">{s.title}</div>
        <div className="mt-1 text-xs opacity-90">
          目標 G <b className="num">{fmtA(gd.targetG)}</b> ／ 計画の残り {gd.planRemainQ}個を今の単価で売った場合の G{' '}
          <b className="num" data-testid="progress-g-if-plan">
            {fmtA(gd.gIfPlan)}
          </b>
        </div>
      </div>

      {/* 打ち手：これからの販売で稼ぐ粗利を、数量か単価のどちらで稼ぐか */}
      {gd.remainMQ > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl shadow-card border border-line p-4" data-testid="progress-lever-q">
            <div className="text-[11px] font-bold text-ink-500">打ち手① 今の単価のまま、数量で稼ぐ</div>
            {gd.needQ == null ? (
              <p className="mt-1 text-sm text-accent-ink">1個あたりの粗利が 0 以下です。単価を上げるか、安く仕入れてください。</p>
            ) : (
              <>
                <div className="mt-1">
                  あと <b className="num text-2xl">{gd.needQ}</b> 個 売る
                  {extraQ != null && extraQ !== 0 && (
                    <span className={`ml-2 text-xs font-bold ${extraQ > 0 ? BAD : GOOD}`}>
                      計画の残り {gd.planRemainQ}個より {extraQ > 0 ? `${extraQ}個 多い` : `${-extraQ}個 少ない`}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-ink-400 mt-1">
                  1個あたりの粗利 {unit(gd.m)}（販売 {unit(gd.p.now)} − 仕入 {unit(gd.v.now)}）で、残りの粗利 {fmt(gd.remainMQ)} を稼ぐ
                  {gd.salesTimes != null && gd.needQ > 0 && `・今の販売能力（1回 ${gd.salesCap}個）で販売 ${gd.salesTimes}回`}
                  {gd.salesTimes == null && gd.needQ > 0 && '・今は販売能力が 0 です（販売員・広告が必要）'}
                </div>
              </>
            )}
          </div>
          <div className="bg-white rounded-2xl shadow-card border border-line p-4" data-testid="progress-lever-p">
            <div className="text-[11px] font-bold text-ink-500">打ち手② 計画の残り個数のまま、単価で稼ぐ</div>
            {gd.needP == null ? (
              <p className="mt-1 text-sm text-ink-600">計画の個数はもう売り終えています。数量（打ち手①）で稼いでください。</p>
            ) : (
              <>
                <div className="mt-1">
                  残り {gd.planRemainQ}個を 平均 <b className="num text-2xl">{fmt(gd.needP)}</b> 以上で売る
                  {gd.needP !== Math.round(gd.p.now) && (
                    <span className={`ml-2 text-xs font-bold ${gd.needP > gd.p.now ? BAD : GOOD}`}>
                      今の平均 {unit(gd.p.now)}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-ink-400 mt-1">
                  仕入単価 {unit(gd.v.now)} ＋ 残りの粗利 {fmt(gd.remainMQ)} ÷ {gd.planRemainQ}個
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 目標 G に必要な粗利：G ＋ 固定費の見込み − 稼いだ粗利 ＝ これから稼ぐ粗利 */}
      <div className="bg-white rounded-2xl shadow-card border border-line p-4">
        <h3 className="font-bold text-sm mb-2">目標 G に必要な粗利（MQ）</h3>
        <div className="space-y-1.5 text-sm" data-testid="progress-mq">
          <div className="flex justify-between">
            <span className="text-ink-600">目標 G</span>
            <b className="num">{fmtA(gd.targetG)}</b>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-600">
              ＋ 固定費 F の見込み
              <span className="block text-[10px] text-ink-400">
                今の盤面で期末を迎えた場合 {fmt(gd.fNow)}
                {gd.fRemain > 0 && ` ＋ 計画のうちまだ実施していない投資 ${fmt(gd.fRemain)}`}
              </span>
            </span>
            <b className="num" data-testid="progress-f">
              {fmt(gd.fForecast)}
            </b>
          </div>
          <div className="flex justify-between border-t border-line pt-1.5">
            <span className="font-bold">＝ 必要な粗利</span>
            <b className="num">{fmt(gd.needMQ)}</b>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-600">− 今までに稼いだ粗利</span>
            <b className="num" data-testid="progress-mq-done">
              {fmtA(gd.mqDone)}
            </b>
          </div>
          <div className={`flex justify-between rounded-lg px-3 py-2 font-bold ${gd.remainMQ > 0 ? 'bg-canvas text-ink' : 'bg-emerald-50 text-emerald-800'}`}>
            <span>{gd.remainMQ > 0 ? '＝ これからの販売で稼ぐ粗利' : '＝ 目標まで稼ぎ終えています'}</span>
            <b className="num" data-testid="progress-remain-mq">
              {fmt(Math.abs(gd.remainMQ))}
            </b>
          </div>
        </div>
        {gd.remainItems.length > 0 && (
          <p className="mt-2 text-[10px] text-ink-400">
            まだ実施していない投資：{gd.remainItems.map((x) => `${x.label} ${x.detail}（${fmt(x.amount)}）`).join('、')}
          </p>
        )}
      </div>

      {/* 計画と今の見込みで違う前提。有利なら緑、不利なら赤で、何をすればよいかを添える */}
      <div className="bg-white rounded-2xl shadow-card border border-line p-4">
        <h3 className="font-bold text-sm mb-2">計画から変わった前提</h3>
        <div className="space-y-2" data-testid="progress-factors">
          {gd.factors.map((f) => (
            <div key={f.key} className="border-t border-line/60 pt-2 first:border-0 first:pt-0" data-testid={`progress-factor-${f.key}`}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-bold">{f.label}</span>
                <span className="num whitespace-nowrap">
                  <span className="text-ink-400 text-xs">計画 {unit(f.plan)} → </span>
                  <b>{unit(f.now)}</b>
                  {f.diff !== 0 && (
                    <span className={`ml-1.5 text-xs font-bold ${f.good ? GOOD : BAD}`}>
                      {f.diff > 0 ? '＋' : '−'}
                      {unit(Math.abs(f.diff))}
                    </span>
                  )}
                </span>
              </div>
              <div className={`text-[11px] mt-0.5 ${f.good == null ? 'text-ink-400' : f.good ? GOOD : BAD}`}>{f.note}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-ink-400">
          販売単価は今期の売上高 ÷ 売上個数、仕入単価は今期の仕入金額の合計 ÷ 仕入個数（まだ無ければ計画の値）。
        </p>
      </div>

      {/* 参考：アクションプランの計画回数と、ここまでの実施回数 */}
      <div className="bg-white rounded-2xl shadow-card border border-line p-4">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h3 className="font-bold text-sm">アクションの実施回数</h3>
          <span className="text-[11px] text-ink-400 num" data-testid="progress-act-rate">
            消化 {actRate ?? '—'}%（{gd.doneTotal}／{gd.plannedTotal}回）・今の現金 {fmtA(gd.cash)}
          </span>
        </div>
        {gd.actions.length ? (
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
              {gd.actions.map((a) => {
                const left = a.plan - a.done
                return (
                  <tr key={a.key} className="border-t border-line/70" data-testid={`progress-act-${a.key}`}>
                    <td className="py-1.5">{a.label}</td>
                    <td className="py-1.5 px-2 text-right num">{a.plan}回</td>
                    <td className="py-1.5 px-2 text-right num font-bold">{a.done}回</td>
                    {/* 計画どおり＝済、計画より多い＝＋、計画外のアクションは計画 0 回として＋で出す */}
                    <td className={`py-1.5 pl-2 text-right num ${left > 0 ? 'text-ink-600' : GOOD}`}>
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
