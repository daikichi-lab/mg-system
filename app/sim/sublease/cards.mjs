// サブリース経営MG のリスク・チャンスカード（issue #104）。
// 設計案「リスクカード・チャンスカード」の12種類。山札は 意思決定44 ＋ リスク10 ＋ チャンス6 ＝ 60枚。
// 効果は引いた会社だけにかかる（製造業MGのリスクカードと同じ扱い）。

/** リスクカード：key・名前・枚数 */
export const RISKS = [
  { key: 'defect', name: '施工不備の発覚', n: 1 },
  { key: 'corpCancel', name: '大口法人の解約', n: 1 },
  { key: 'pandemic', name: '感染症の流行', n: 1 },
  { key: 'lawsuit', name: 'オーナー訴訟', n: 1 },
  { key: 'leak', name: '漏水・設備故障', n: 2 },
  { key: 'arrears', name: '家賃の滞納', n: 2 },
  { key: 'noise', name: '入居者トラブル（騒音）', n: 1 },
  { key: 'competitor', name: '近くに競合物件', n: 1 },
]

/** チャンスカード */
export const CHANCES = [
  { key: 'rush', name: '3月の繁忙期', n: 2 },
  { key: 'foreign', name: '外国人材の受け入れ増', n: 2 },
  { key: 'factory', name: '新規の社宅需要', n: 1 },
  { key: 'pricing', name: 'プライシングの成功', n: 1 },
]

/** 山札を作る（意思決定は key='decision'）。並びはシャッフル前 */
export function makeDeck(P) {
  const deck = []
  // P.cardCounts で枚数を上書きできる（シミュレーションで頻度を調整するため）
  const nOf = (c) => P.cardCounts?.[c.key] ?? c.n
  for (let i = 0; i < P.deckDecision; i++) deck.push({ kind: 'decision', key: 'decision', name: '意思決定' })
  for (const r of RISKS) for (let i = 0; i < nOf(r); i++) deck.push({ kind: 'risk', key: r.key, name: r.name })
  for (const c of CHANCES) for (let i = 0; i < nOf(c); i++) deck.push({ kind: 'chance', key: c.key, name: c.name })
  return deck
}
