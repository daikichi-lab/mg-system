// ルール一覧（/admin/rules）。数値ルールのマスタを並べる。
import { api, type ApiRuleset } from '../lib/api'

const fmtDate = (t: number) => {
  if (!t) return '—'
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function RulesList({
  token,
  rulesets,
  reload,
  toast,
}: {
  token: string
  rulesets: ApiRuleset[]
  reload: () => Promise<void>
  toast: (m: string) => void
}) {
  async function duplicate(r: ApiRuleset) {
    const d = await api.adminCreateRuleset(token, {
      name: `${r.name} のコピー`,
      description: r.description,
      rules: r.rules,
    })
    location.assign(`/admin/rules/${d.ruleset.id}/edit`)
  }

  async function remove(r: ApiRuleset) {
    if (!confirm(`ルール「${r.name}」を削除します。元に戻せません。よろしいですか？`)) return
    try {
      await api.adminDeleteRuleset(token, r.id)
      await reload()
      toast('ルールを削除しました')
    } catch (e: any) {
      alert(e.message)
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="font-black text-lg">ルール一覧</h1>
          <p className="text-ink-400 text-xs mt-0.5">研修で使う数値のセット。行を押すと内容を確認できます。</p>
        </div>
        <a
          data-testid="new-ruleset"
          href="/admin/rules/new"
          className="h-10 px-4 rounded-xl bg-ink text-white text-sm font-bold hover:bg-ink-600 grid place-items-center"
        >
          ＋ ルールを作成
        </a>
      </div>

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <table className="w-full text-sm table-fixed" data-testid="ruleset-table">
          <colgroup>
            <col className="w-[30%]" />
            <col />
            <col className="w-[150px]" />
            <col className="w-[170px]" />
          </colgroup>
          <thead>
            <tr className="bg-canvas border-b border-line text-ink-600 text-xs">
              <th className="px-4 py-2.5 text-left font-bold whitespace-nowrap">ルール名</th>
              <th className="px-4 py-2.5 text-left font-bold whitespace-nowrap">説明</th>
              <th className="px-4 py-2.5 text-left font-bold whitespace-nowrap">更新日</th>
              <th className="px-4 py-2.5 text-right font-bold whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody>
            {rulesets.map((r) => (
              <tr
                key={r.id}
                data-testid={`ruleset-row-${r.id}`}
                onClick={() => location.assign(`/admin/rules/${r.id}`)}
                className="border-b border-line/60 last:border-0 cursor-pointer hover:bg-canvas transition"
              >
                <td className="px-4 py-3 font-bold truncate" title={r.name}>
                  {r.name}
                  {r.isBuiltin && (
                    <span className="ml-2 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded bg-canvas border border-line text-ink-400">
                      既定
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-ink-500 text-xs truncate" title={r.description}>
                  {r.description || '—'}
                </td>
                <td className="px-4 py-3 num text-[11px] text-ink-400 whitespace-nowrap">{fmtDate(r.updatedAt)}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      data-testid={`dup-${r.id}`}
                      onClick={() => duplicate(r)}
                      className="h-8 px-2.5 rounded-lg border border-line text-ink-600 text-xs font-bold hover:bg-canvas whitespace-nowrap shrink-0"
                    >
                      複製
                    </button>
                    <button
                      data-testid={`del-${r.id}`}
                      onClick={() => remove(r)}
                      disabled={r.isBuiltin}
                      title={r.isBuiltin ? '既定ルールは削除できません' : undefined}
                      className="h-8 px-2.5 rounded-lg border border-accent/40 text-accent text-xs font-bold hover:bg-accent/5 whitespace-nowrap shrink-0 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      削除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rulesets.length && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-ink-300 text-sm">
                  ルールがありません。右上の「ルールを作成」から追加してください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
