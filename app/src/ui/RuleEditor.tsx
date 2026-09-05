// ルール作成（/admin/rules/new）／編集（/admin/rules/<id>/edit）。
// 確認画面と同じ6グループ・同じ順序で、値を入力欄にしたもの。
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { normalizeRules, type Rules } from '../lib/rules'
import { GROUPS, SALARY_PERIODS, type Field } from './ruleFields'
import { ColChip, NotFound } from './RuleView'

// 幅は使う側で指定する。ここに w-28 を入れて呼び出し側で w-20 を足すと、
// Tailwind の出力順で幅が衝突して意図した幅にならない
const NUM_BASE = 'num h-10 border border-line rounded-lg px-3 text-right bg-white outline-none focus:border-ink/40'

function FieldInput({
  field,
  rules,
  set,
}: {
  field: Field
  rules: Rules
  set: (patch: Partial<Rules>) => void
}) {
  if (field.kind === 'salary') {
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: SALARY_PERIODS }, (_, i) => (
          <label key={i} className="block">
            <span className="block text-ink-400 text-[10px] mb-1 text-center">第{i + 1}期</span>
            <input
              data-testid={`f-salary-${i}`}
              type="number"
              min={0}
              value={rules.salaryTable[i] ?? 0}
              onChange={(e) => {
                const next = [...rules.salaryTable]
                next[i] = Number(e.target.value)
                set({ salaryTable: next })
              }}
              className={`${NUM_BASE} w-20`}
            />
          </label>
        ))}
      </div>
    )
  }

  if (field.kind === 'prices') {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {rules.materialPrices.map((p, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-line bg-canvas pl-2.5 pr-1 py-1">
            <span className="num text-sm font-bold">{p}</span>
            <button
              data-testid={`price-del-${p}`}
              onClick={() => set({ materialPrices: rules.materialPrices.filter((_, k) => k !== i) })}
              className="text-ink-300 hover:text-accent text-sm leading-none px-1"
              title="この単価を外す"
            >
              ×
            </button>
          </span>
        ))}
        <AddPrice
          onAdd={(v) => {
            if (rules.materialPrices.includes(v)) return
            set({ materialPrices: [...rules.materialPrices, v].sort((a, b) => a - b) })
          }}
        />
      </div>
    )
  }

  if (field.kind === 'pct') {
    return (
      <div className="flex items-center gap-1">
        <input
          data-testid="f-loanRate"
          type="number"
          min={0}
          step={0.1}
          value={Math.round(rules.loanRate * 1000) / 10}
          onChange={(e) => set({ loanRate: Number(e.target.value) / 100 })}
          className={`${NUM_BASE} w-28`}
        />
        <span className="text-ink-400 text-sm">%</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <input
        data-testid={`f-${field.key}`}
        type="number"
        min={field.min}
        value={rules[field.key]}
        onChange={(e) => set({ [field.key]: Number(e.target.value) } as Partial<Rules>)}
        className={`${NUM_BASE} w-28`}
      />
      {field.unit && <span className="text-ink-400 text-sm">{field.unit}</span>}
    </div>
  )
}

function AddPrice({ onAdd }: { onAdd: (v: number) => void }) {
  const [v, setV] = useState('')
  const commit = () => {
    const n = Number(v)
    if (!v || !Number.isFinite(n) || n < 0) return
    onAdd(n)
    setV('')
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        data-testid="price-new"
        type="number"
        min={0}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        placeholder="単価"
        className="num h-8 w-20 border border-line rounded-lg px-2 text-right bg-white outline-none focus:border-ink/40"
      />
      <button
        data-testid="price-add"
        onClick={commit}
        className="h-8 px-2.5 rounded-lg border border-line text-ink-600 text-xs font-bold hover:bg-canvas"
      >
        追加
      </button>
    </span>
  )
}

export default function RuleEditor({
  token,
  id,
  toast,
}: {
  token: string
  id: number | null // null = 新規作成
  toast: (m: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState<Rules>(() => normalizeRules(null))
  const [loaded, setLoaded] = useState(id === null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [notFound, setNotFound] = useState('')
  // 未保存かどうかは ref でも持つ。state の更新は非同期なので、保存直後の
  // location.assign までに beforeunload の解除が間に合わず離脱確認が出てしまう
  const dirtyRef = useRef(false)
  // 二重送信ガード。state だけだと連打の2回目が更新前の値を見てしまう
  const savingRef = useRef(false)

  useEffect(() => {
    if (id === null) return
    api
      .adminRuleset(token, id)
      .then((d) => {
        if (d.ruleset.isBuiltin) {
          setNotFound('既定ルールは編集できません。複製してください。')
          return
        }
        setName(d.ruleset.name)
        setDescription(d.ruleset.description)
        setRules(normalizeRules(d.ruleset.rules as Partial<Rules>))
        setLoaded(true)
      })
      .catch((e) => setNotFound(e.message))
  }, [token, id])

  // 未保存のまま離れようとしたら止める
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const markDirty = () => {
    dirtyRef.current = true
    setDirty(true)
  }

  const set = (patch: Partial<Rules>) => {
    setRules((r) => ({ ...r, ...patch }))
    markDirty()
  }

  function validate(): string {
    if (!name.trim()) return 'ルール名を入力してください'
    if (!rules.materialPrices.length) return '仕入単価の選択肢を1つ以上入れてください'
    if (rules.matCap < 1 || rules.prodCap < 1) return '在庫の上限は1以上にしてください'
    if (!Number.isInteger(rules.planFromPeriod) || rules.planFromPeriod < 1)
      return '経営計画書タブを出す期は1以上の整数にしてください'
    const nums = [rules.rent, rules.depPerMachine, rules.machinePrice, rules.loanRate, ...rules.salaryTable]
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return '数値は0以上で入力してください'
    return ''
  }

  async function save() {
    if (savingRef.current) return // 送信中は受け付けない（二重送信でルールが2件できる）
    const msg = validate()
    setErr(msg)
    if (msg) return
    savingRef.current = true
    setSaving(true)
    const body = { name: name.trim(), description: description.trim(), rules }
    try {
      const d = id === null ? await api.adminCreateRuleset(token, body) : await api.adminUpdateRuleset(token, id, body)
      dirtyRef.current = false
      setDirty(false)
      toast(id === null ? 'ルールを作成しました' : 'ルールを保存しました')
      // 保存したルールの確認画面へ。遷移が終わるまで保存ボタンは無効のままにする
      location.assign(`/admin/rules/${d.ruleset.id}`)
    } catch (e: any) {
      setErr(e.message)
      savingRef.current = false
      setSaving(false)
    }
  }

  function leave(url: string) {
    if (dirtyRef.current && !confirm('保存していない変更があります。破棄して移動しますか？')) return
    dirtyRef.current = false
    location.assign(url)
  }

  if (notFound) return <NotFound message={notFound} />
  if (!loaded) return <div className="p-6 text-ink-300 text-sm">読み込み中…</div>

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <button
            data-testid="rule-back"
            onClick={() => leave('/admin/rules')}
            className="h-8 px-3 rounded-lg border border-line bg-white text-ink-600 text-xs font-bold hover:bg-canvas"
          >
            ← ルール一覧へ
          </button>
          <h1 className="font-black text-lg mt-2">{id === null ? 'ルールを作成' : 'ルールを編集'}</h1>
          <p className="text-ink-400 text-xs mt-0.5">ゲームの流れ順に並んでいます。色の付いた印は、その数値が効く勘定科目です。</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => leave(id === null ? '/admin/rules' : `/admin/rules/${id}`)}
            disabled={saving}
            className="h-10 px-4 rounded-xl border border-line text-ink-600 text-sm font-bold hover:bg-white disabled:opacity-40"
          >
            やめる
          </button>
          <button
            data-testid="rule-save"
            onClick={save}
            disabled={saving}
            className="h-10 px-5 rounded-xl bg-ink text-white text-sm font-bold hover:bg-ink-600 disabled:opacity-40 disabled:hover:bg-ink"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-line p-4 mb-3">
        <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
          <label className="block">
            <span className="block text-xs font-bold text-ink-600 mb-1">ルール名</span>
            <input
              data-testid="rule-name-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                markDirty()
              }}
              placeholder="例：上級編（高金利）"
              className="w-full h-10 border border-line rounded-lg px-3 text-sm outline-none focus:border-ink/40"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-ink-600 mb-1">説明（任意）</span>
            <input
              data-testid="rule-desc-input"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                markDirty()
              }}
              placeholder="どんな狙いの設定か"
              className="w-full h-10 border border-line rounded-lg px-3 text-sm outline-none focus:border-ink/40"
            />
          </label>
        </div>
        {err && (
          <p data-testid="rule-err" className="text-accent-ink text-xs mt-2">
            {err}
          </p>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        {GROUPS.map((g) => (
          <section
            key={g.title}
            className="bg-white rounded-xl border border-line p-4"
          >
            <div className="mb-3">
              <h2 className="font-bold text-sm">{g.title}</h2>
              <p className="text-ink-400 text-[11px]">{g.lead}</p>
            </div>
            <div className="space-y-4">
              {g.fields.map((f) => (
                <div key={f.key}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-ink-600">{f.label}</span>
                    <ColChip col={f.col} note={'colNote' in f ? f.colNote : undefined} />
                  </div>
                  <p className="text-ink-400 text-[11px] mt-0.5 mb-1.5">{f.desc}</p>
                  <FieldInput field={f} rules={rules} set={set} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-end gap-3 flex-wrap">
        <button
          data-testid="rule-save-bottom"
          onClick={save}
          disabled={saving}
          className="h-10 px-5 rounded-xl bg-ink text-white text-sm font-bold hover:bg-ink-600 disabled:opacity-40 disabled:hover:bg-ink"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
