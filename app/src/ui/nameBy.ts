// 成績一覧（表形式・グラフ形式・経営戦略分析表）で、会社を「会社名」と「社長名」のどちらで出すかの切り替え。issue #111
// 切り替えは表示だけ。会社の選択・data-testid・React の key は会社名のまま（研修内で一意なのは会社名なので）。

/** 成績一覧に出す名前の種類。会社名／社長名 */
export type NameBy = 'company' | 'president'

/** 表示する名前。社長名が未入力の会社は会社名で出す（空欄だと誰の列か分からないため） */
export function displayName(c: { name: string; president?: string | null }, nameBy: NameBy): string {
  const pres = c.president?.trim()
  return nameBy === 'president' && pres ? pres : c.name
}

/** もう一方の名前（表形式の見出しで小さく添える）。社長名が未入力なら「—」 */
export function otherName(c: { name: string; president?: string | null }, nameBy: NameBy): string {
  return nameBy === 'president' ? c.name : c.president?.trim() || '—'
}
