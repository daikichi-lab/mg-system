// 研修一覧。管理画面の入口。
// 行を押すとその研修の管理画面が別タブで開く。右上の「研修を開始」で新しい研修を作る。
import { useState } from 'react'
import { api, type ApiOrg } from '../lib/api'

// 推測されにくい高エントロピーな組織コードを生成（紛らわしい文字を除外）
function genCode() {
  const alpha = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return 'MG-' + Array.from(bytes, (b) => alpha[b % alpha.length]).join('')
}

const urlOf = (code: string) => new URL(`/?org=${encodeURIComponent(code)}`, location.href).href

export default function SessionList({
  token,
  orgs,
  reload,
  toast,
}: {
  token: string
  orgs: ApiOrg[]
  reload: () => Promise<void>
  toast: (m: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ApiOrg | null>(null)

  async function copy(text: string, msg: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast(msg)
    } catch {
      /* クリップボード不可の環境では無視 */
    }
  }

  async function remove(o: ApiOrg) {
    if (!confirm(`研修「${o.name}」を削除します。参加者データも研修URLも無効になり、元に戻せません。よろしいですか？`)) return
    await api.adminRemoveOrg(token, o.code)
    await reload()
    toast('研修を削除しました')
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="font-black text-lg">研修一覧</h1>
          <p className="text-ink-400 text-xs mt-0.5">行を押すと、その研修の管理画面が別タブで開きます。</p>
        </div>
        <button
          data-testid="start-session"
          onClick={() => setCreating(true)}
          className="h-10 px-4 rounded-xl bg-ink text-white text-sm font-bold hover:bg-ink-600"
        >
          ＋ 研修を開始
        </button>
      </div>

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        {/* table-fixed ＋ colgroup で列幅を固定する。
            自動幅だと長い研修URLが全幅を奪い、研修名や操作ボタンが1文字ずつ折り返される */}
        <table className="w-full text-sm table-fixed" data-testid="session-table">
          <colgroup>
            <col className="w-[26%]" />
            <col />
            <col className="w-[230px]" />
          </colgroup>
          <thead>
            <tr className="bg-canvas border-b border-line text-ink-600 text-xs">
              <th className="px-4 py-2.5 text-left font-bold whitespace-nowrap">研修名</th>
              <th className="px-4 py-2.5 text-left font-bold whitespace-nowrap">研修URL</th>
              <th className="px-4 py-2.5 text-right font-bold whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr
                key={o.code}
                data-testid={`session-row-${o.code}`}
                onClick={() => window.open(`/admin/session?org=${encodeURIComponent(o.code)}`, '_blank')}
                className="border-b border-line/60 last:border-0 cursor-pointer hover:bg-canvas transition"
              >
                <td className="px-4 py-3 font-bold truncate" title={o.name || o.code}>
                  {o.name || o.code}
                </td>
                <td className="px-4 py-3 num text-[11px] text-ink-500 truncate" title={urlOf(o.code)}>
                  {urlOf(o.code)}
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      data-testid={`copy-${o.code}`}
                      onClick={() => copy(urlOf(o.code), '研修URLをコピーしました')}
                      className="h-8 px-2.5 rounded-lg border border-line text-ink-600 text-xs font-bold hover:bg-canvas whitespace-nowrap shrink-0"
                    >
                      URLコピー
                    </button>
                    <button
                      data-testid={`edit-${o.code}`}
                      onClick={() => setEditing(o)}
                      className="h-8 px-2.5 rounded-lg border border-line text-ink-600 text-xs font-bold hover:bg-canvas whitespace-nowrap shrink-0"
                    >
                      編集
                    </button>
                    <button
                      data-testid={`remove-${o.code}`}
                      onClick={() => remove(o)}
                      className="h-8 px-2.5 rounded-lg border border-accent/40 text-accent text-xs font-bold hover:bg-accent/5 whitespace-nowrap shrink-0"
                    >
                      削除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!orgs.length && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-ink-300 text-sm">
                  研修がありません。右上の「研修を開始」で作成してください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateModal
          token={token}
          onClose={() => setCreating(false)}
          onDone={reload}
          copy={copy}
        />
      )}
      {editing && (
        <EditModal
          token={token}
          org={editing}
          onClose={() => setEditing(null)}
          onDone={reload}
          toast={toast}
        />
      )}
    </div>
  )
}

function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 bg-ink/40 grid place-items-center p-4">
      <div className="bg-white rounded-2xl shadow-card border border-line w-full max-w-md p-5" data-testid="session-modal">
        <div className="font-black mb-3">{title}</div>
        {children}
      </div>
    </div>
  )
}

// ---- 研修を開始（新規作成）----
function CreateModal({
  token,
  onClose,
  onDone,
  copy,
}: {
  token: string
  onClose: () => void
  onDone: () => Promise<void>
  copy: (text: string, msg: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState(() => genCode())
  const [err, setErr] = useState('')
  const [created, setCreated] = useState<ApiOrg | null>(null)

  async function create() {
    setErr('')
    if (!name.trim()) return setErr('研修名を入力してください')
    if (!code.trim()) return setErr('研修URLを入力してください')
    try {
      const d = await api.adminCreateOrg(token, code.trim(), name.trim())
      setCreated(d.org)
      await onDone()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  if (created) {
    const url = urlOf(created.code)
    return (
      <Modal title="研修を開始しました">
        <p className="text-ink-400 text-sm mb-2">
          このURLを参加者に配ってください。開くと会社名を入れて開始できます（ログイン不要）。
        </p>
        <input data-testid="created-url" readOnly value={url} className="w-full h-10 border border-line rounded-lg px-2 text-[11px] num bg-canvas" />
        <button
          data-testid="created-copy"
          onClick={() => copy(url, '研修URLをコピーしました')}
          className="mt-2 w-full h-10 rounded-xl border border-line text-ink-600 text-sm font-bold hover:bg-canvas"
        >
          研修URLをコピー
        </button>
        <button data-testid="created-close" onClick={onClose} className="mt-2 w-full h-10 rounded-xl bg-ink text-white text-sm font-bold">
          閉じる
        </button>
      </Modal>
    )
  }

  return (
    <Modal title="研修を開始">
      <label className="block text-xs font-bold text-ink-400 mb-1">研修名</label>
      <input
        data-testid="new-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="例：第12期 経営研修"
        className="w-full h-10 border border-line rounded-lg px-3 text-sm"
      />
      <label className="block text-xs font-bold text-ink-400 mt-3 mb-1">研修URL</label>
      <div className="flex gap-2">
        <input
          data-testid="new-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="flex-1 h-10 border border-line rounded-lg px-3 text-[11px] num min-w-0"
        />
        <button
          data-testid="gen-code"
          onClick={() => setCode(genCode())}
          className="h-10 px-3 rounded-lg border border-line text-ink-600 text-xs font-bold shrink-0"
        >
          再生成
        </button>
      </div>
      <p className="text-ink-300 text-[10px] mt-1 leading-snug num break-all">{urlOf(code)}</p>
      <p className="text-accent-ink text-xs mt-2 h-4" data-testid="new-err">
        {err}
      </p>
      <div className="flex gap-2 mt-1">
        <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-line text-ink-600 text-sm font-bold">
          キャンセル
        </button>
        <button data-testid="create-session" onClick={create} className="flex-1 h-10 rounded-xl bg-ink text-white text-sm font-bold">
          作成
        </button>
      </div>
    </Modal>
  )
}

// ---- 研修名・研修URLの変更 ----
function EditModal({
  token,
  org,
  onClose,
  onDone,
  toast,
}: {
  token: string
  org: ApiOrg
  onClose: () => void
  onDone: () => Promise<void>
  toast: (m: string) => void
}) {
  const [name, setName] = useState(org.name)
  const [code, setCode] = useState(org.code)
  const [err, setErr] = useState('')
  const codeChanged = code.trim() !== org.code

  async function save() {
    setErr('')
    if (!name.trim()) return setErr('研修名を入力してください')
    if (!code.trim()) return setErr('研修URLを入力してください')
    if (codeChanged && !confirm('研修URLを変更すると、すでに配布したURLは使えなくなります。よろしいですか？')) return
    try {
      await api.adminUpdateOrg(token, org.code, { name: name.trim(), newCode: code.trim() })
      await onDone()
      toast('研修を更新しました')
      onClose()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <Modal title="研修を編集">
      <label className="block text-xs font-bold text-ink-400 mb-1">研修名</label>
      <input
        data-testid="edit-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full h-10 border border-line rounded-lg px-3 text-sm"
      />
      <label className="block text-xs font-bold text-ink-400 mt-3 mb-1">研修URL</label>
      <input
        data-testid="edit-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="w-full h-10 border border-line rounded-lg px-3 text-[11px] num"
      />
      <p className="text-ink-300 text-[10px] mt-1 leading-snug num break-all">{urlOf(code)}</p>
      {codeChanged && (
        <p data-testid="edit-warn" className="text-accent-ink text-[11px] mt-2 leading-snug">
          ⚠ 研修URLを変えると、<b>すでに配布したURLでは参加できなくなります</b>。参加者データは新しいURLへ引き継がれます。
        </p>
      )}
      <p className="text-accent-ink text-xs mt-2 h-4" data-testid="edit-err">
        {err}
      </p>
      <div className="flex gap-2 mt-1">
        <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-line text-ink-600 text-sm font-bold">
          キャンセル
        </button>
        <button data-testid="save-session" onClick={save} className="flex-1 h-10 rounded-xl bg-ink text-white text-sm font-bold">
          保存
        </button>
      </div>
    </Modal>
  )
}
