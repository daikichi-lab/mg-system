// スマホ判定（Tailwind の sm=640px と揃える）。
// 図表はインラインスタイルのHTML文字列で生成するためCSSメディアクエリが使えず、
// 生成時に isM() で幅別に描き分ける。ブレークポイントをまたいだ再描画は
// Participant 側で mqMobile の change を購読して行う。
export const mqMobile: MediaQueryList | null =
  typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia('(max-width: 639px)') : null

export const isM = (): boolean => !!mqMobile && mqMobile.matches
