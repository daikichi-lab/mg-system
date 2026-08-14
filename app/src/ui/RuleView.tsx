// ルール確認（/admin/rules/<id>）。読み取り専用。
// 編集画面と同じ6グループで並べるが、入力欄ではなく数字として見せる。
import { useEffect, useState } from 'react'
import { api, type ApiRuleset } from '../lib/api'
import { normalizeRules, type Rules } from '../lib/rules'
import { GROUPS, COL_NAMES, COL_STYLE, SALARY_PERIODS, type Field } from './ruleFields'

export function ColChip({ col, note }: { col: number | null; note?: string }) {
  if (col === null) {
    return note ? (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-canvas border border-line text-ink-400 whitespace-nowrap">
        {note}
      </span>
    ) : null
  }
  const s = COL_STYLE[col]
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ background: s.bg, color: s.fg }}
      title="この数値が効く勘定科目（記帳台帳の列）"
    >
      {COL_NAMES[col]}
    </span>
  )
}

function Value({ field, rules }: { field: Field; rules: Rules }) {
  if (field.kind === 'salary') {
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: SALARY_PERIODS }, (_, i) => (
          <div key={i} className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-center min-w-[72px]">
            <div className="text-ink-400 text-[10px] leading-none">第{i + 1}期</div>
            <div className="num font-bold text-base leading-tight mt-1">{rules.salaryTable[i] ?? '—'}</div>
          </div>
        ))}
      </div>
    )
  }
  if (field.kind === 'prices') {
    return (
      <div className="flex flex-wrap gap-1.5">
        {rules.materialPrices.map((p, i) => (
          <span key={i} className="num rounded-lg border border-line bg-canvas px-2.5 py-1 text-sm font-bold">
            {p}
          </span>
        ))}
      </div>
    )
  }
  if (field.kind === 'pct') {
    return (
      <div className="num font-bold text-xl">
        {Math.round(rules.loanRate * 1000) / 10}
        <span className="text-ink-400 text-sm font-normal ml-0.5">%</span>
      </div>
    )
  }
  return (
    <div className="num font-bold text-xl">
      {rules[field.key]}
      {field.unit && <span className="text-ink-400 text-sm font-normal ml-1">{field.unit}</span>}
    </div>
  )
}

export default function RuleView({ token, id, toast }: { token: string; id: number; toast: (m: string) => void }) {
  const [rs, setRs] = useState<ApiRuleset | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api
      .adminRuleset(token, id)
      .then((d) => setRs(d.ruleset))
      .catch((e) => setErr(e.message))
  }, [token, id])

  async function duplicate() {
    if (!rs) return
    const d = await api.adminCreateRuleset(token, {
      name: `${rs.name} のコピー`,
      description: rs.description,
      rules: rs.rules,
    })
    toast('複製しました')
    location.assign(`/admin/rules/${d.ruleset.id}/edit`)
  }

  if (err) return <NotFound message={err} />
  if (!rs) return <div className="p-6 text-ink-300 text-sm">読み込み中…</div>

  const rules = normalizeRules(rs.rules as Partial<Rules>)

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0">
          <a href="/admin/rules" className="text-ink-400 text-xs hover:underline">
            ← ルール一覧へ
          </a>
          <h1 className="font-black text-lg mt-1 flex items-center gap-2 flex-wrap" data-testid="rule-name">
            {rs.name}
            {rs.isBuiltin && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-canvas border border-line text-ink-400">
                既定
              </span>
            )}
          </h1>
          {rs.description && <p className="text-ink-400 text-xs mt-0.5">{rs.description}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            data-testid="rule-duplicate"
            onClick={duplicate}
            className="h-10 px-4 rounded-xl border border-line text-ink-600 text-sm font-bold hover:bg-white whitespace-nowrap"
          >
            複製
          </button>
          {rs.isBuiltin ? (
            <span className="text-ink-300 text-xs max-w-[260px] leading-snug">
              既定ルールは編集できません。変えるときは複製してください。
            </span>
          ) : (
            <a
              data-testid="rule-edit"
              href={`/admin/rules/${rs.id}/edit`}
              className="h-10 px-4 rounded-xl bg-ink text-white text-sm font-bold hover:bg-ink-600 grid place-items-center whitespace-nowrap"
            >
              編集
            </a>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3" data-testid="rule-view">
        {GROUPS.map((g) => (
          <section
            key={g.title}
            className="bg-white rounded-xl border border-line p-4"
          >
            <div className="mb-3">
              <h2 className="font-bold text-sm">{g.title}</h2>
              <p className="text-ink-400 text-[11px]">{g.lead}</p>
            </div>
            <div className="space-y-3">
              {g.fields.map((f) => (
                <div key={f.key}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-ink-600">{f.label}</span>
                    <ColChip col={f.col} note={'colNote' in f ? f.colNote : undefined} />
                  </div>
                  <div className="mt-1.5">
                    <Value field={f} rules={rules} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

export function NotFound({ message }: { message: string }) {
  return (
    <div className="p-6">
      <div className="bg-white rounded-xl border border-line p-10 text-center">
        <p className="text-ink-500 text-sm">{message}</p>
        <a href="/admin/rules" className="inline-block mt-4 text-accent text-sm font-bold hover:underline">
          ルール一覧へ戻る
        </a>
      </div>
    </div>
  )
}
