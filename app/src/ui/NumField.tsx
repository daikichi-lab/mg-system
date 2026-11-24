import { useState, type InputHTMLAttributes } from 'react'

/**
 * 数値の入力欄（issue #116）。
 * `value={数値}` を直接つなぐと、欄を空にした瞬間に `Number('') || 0` で 0 に戻り、初期値の 0 を消せない。
 * そこで入力中の文字列（draft）を手元に持ち、空のあいだは空のまま表示する（親には 0 として渡す）。
 * - 欄を選んだら中身を全選択する（0 のまま数字を打てば置き換わる）
 * - 欄から離れたとき空なら、親の値（0）を表示に戻す
 * - 親の値が入力と食い違ったら（上限で丸められた・別の操作で変わった）親の値を表示する
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number
  onValue: (v: number) => void
}

export function NumField({ value, onValue, onFocus, onBlur, ...rest }: Props) {
  const [draft, setDraft] = useState(String(value))
  // 入力中の文字列が親の値と同じ数を指すときだけ、そのまま見せる（空欄＝0・「05」など打っている途中の形を崩さない）。
  // 別の数を指すとき（上限で丸められた・別の操作で変わった）は親の値を見せる
  const shown = (Number(draft) || 0) === value ? draft : String(value)
  return (
    <input
      {...rest}
      type="number"
      value={shown}
      onChange={(e) => {
        setDraft(e.target.value)
        onValue(Number(e.target.value) || 0)
      }}
      onFocus={(e) => {
        e.currentTarget.select()
        onFocus?.(e)
      }}
      onBlur={(e) => {
        if (shown.trim() === '') setDraft(String(value))
        onBlur?.(e)
      }}
    />
  )
}
