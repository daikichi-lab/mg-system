// 画面下部に一時表示する軽量トースト（更新/増資などの完了通知）。
import { useCallback, useRef, useState } from 'react'

export interface ToastItem {
  id: number
  msg: string
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const push = useCallback((msg: string) => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400)
  }, [])
  return { toasts, push }
}

export function Toaster({ toasts }: { toasts: ToastItem[] }) {
  if (!toasts.length) return null
  return (
    <div className="fixed inset-x-0 bottom-5 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          className="pointer-events-auto flex items-center gap-2 rounded-xl bg-ink text-white text-sm font-bold px-4 py-2.5 shadow-lg"
        >
          <span className="grid place-items-center w-4 h-4 rounded-full bg-emerald-400 text-ink text-[10px] leading-none">✓</span>
          {t.msg}
        </div>
      ))}
    </div>
  )
}
