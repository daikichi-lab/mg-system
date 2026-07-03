import { test, expect, type Page } from '@playwright/test'

const ORG = 'E2E'

async function setField(page: Page, testid: string, val: string | number) {
  const el = page.getByTestId(testid)
  const tag = await el.evaluate((e) => e.tagName)
  if (tag === 'SELECT') await el.selectOption(String(val))
  else {
    await el.fill('')
    await el.fill(String(val))
  }
}

async function act(page: Page, key: string, fields: Record<string, string | number> = {}) {
  await page.getByTestId(`act-${key}`).click()
  await expect(page.getByTestId('modal-ok')).toBeVisible()
  for (const [name, val] of Object.entries(fields)) await setField(page, `field-${name}`, val)
  await page.getByTestId('modal-ok').click()
  await expect(page.getByTestId('modal-ok')).toBeHidden()
}

async function event(page: Page, key: string, fields: Record<string, string | number> = {}) {
  await page.getByTestId('event-select').selectOption(key)
  await page.getByTestId('event-go').click()
  await expect(page.getByTestId('modal-ok')).toBeVisible()
  for (const [name, val] of Object.entries(fields)) await setField(page, `field-${name}`, val)
  await page.getByTestId('modal-ok').click()
  await expect(page.getByTestId('modal-ok')).toBeHidden()
}

test.describe.serial('戦略MG 本番アプリ E2E', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    ;(page as any)._mgErrors = errors
  })

  test('参加者：会社作成→全アクション→決算→次期→履歴/組織→リロード復元', async ({ page }) => {
    await page.goto(`/?org=${ORG}`)

    // --- 会社情報：開始 ---
    await expect(page.getByTestId('c-org')).toHaveValue(ORG)
    await page.getByTestId('c-name').fill('E2E製菓')
    await page.getByTestId('c-pres').fill('検証太郎')
    await page.getByTestId('start').click()
    await expect(page.getByTestId('hd-name')).toHaveText('E2E製菓')

    // --- 記帳タブへ ---
    await page.getByTestId('tab-play').click()
    await expect(page.getByTestId('act-shiire')).toBeVisible()

    // ルールA / B / イベントの全種別を記帳
    await act(page, 'kikai', { n: 1 })
    await act(page, 'saiyo', { mfg: 2, sales: 1 })
    await act(page, 'kyoiku') // ルールB（固定1枚）
    await act(page, 'koukoku', { n: 1 })
    await act(page, 'shiire', { 'qty-0': 6, 'unit-0': 13 })
    await act(page, 'seizo', { qty: 4 })
    await act(page, 'hanbai', { 'qty-0': 4, 'unit-0': 50 })
    await act(page, 'hoken') // ルールB（ルールAを挟んだので可）
    await event(page, 'kansen') // 手番のみ（効果なし）
    await event(page, 'claim') // 費用トラブル

    // 盤面の状態が反映されている
    await expect(page.getByTestId('sp-mfg')).toHaveText('2')
    await expect(page.getByTestId('sp-machines')).toHaveText('1')
    await expect(page.getByTestId('sp-prod')).toHaveText('0') // 販売で製品0

    // バリデーション：販売能力超過はエラー
    await page.getByTestId('act-hanbai').click()
    await setField(page, 'field-qty-0', 99)
    await page.getByTestId('modal-ok').click()
    await expect(page.getByTestId('error')).toBeVisible()
    await page.getByRole('button', { name: 'やめる' }).click()
    await page.getByTestId('error').getByText('閉じる').click()

    // 記帳の削除ボタン（1件消して戻す確認だけ）: claim 行を消す代わりにここでは存在確認
    await expect(page.getByTestId('ledger')).toBeVisible()

    // --- 期末処理 → 決算 ---
    await page.getByTestId('closing').click() // 期末処理タブへ遷移
    await expect(page.getByTestId('settle')).toBeVisible()
    await page.getByTestId('settle').click()

    // --- 決算書：貸借一致 ---
    await expect(page.getByTestId('statement')).toBeVisible()
    await expect(page.getByTestId('bs-check')).toContainText('貸借一致')
    // 決算書の図解（STRAC 面積図 ⇄ P/L ウォーターフォール・B/S図・CF図）
    await expect(page.getByTestId('strac-fig')).toBeVisible()
    await page.getByTestId('pl-wf').click()
    await expect(page.getByTestId('strac-fig')).toBeVisible()
    await page.getByTestId('pl-strac').click()
    await expect(page.getByTestId('bs-fig')).toBeVisible()
    await expect(page.getByTestId('cf-fig')).toBeVisible()
    // 資産合計＝負債純資産計
    const assets1 = await page.getByTestId('bs-assets').textContent()
    const liabeq1 = await page.getByTestId('bs-liabeq').textContent()
    expect(assets1).toBe(liabeq1)

    // --- 次の期へ ---
    await page.getByTestId('next-period').click()
    await expect(page.getByTestId('hd-period')).toHaveText('第2期')

    // --- 第2期：借入を含む ---
    await page.getByTestId('tab-play').click()
    await act(page, 'kariire', { a: 50 }) // 第2期は借入可
    await expect(page.getByTestId('sp-loan')).toHaveText('50')
    await act(page, 'koukoku', { n: 1 })
    await act(page, 'shiire', { 'qty-0': 6, 'unit-0': 13 })
    await act(page, 'seizo', { qty: 4 })
    await act(page, 'hanbai', { 'qty-0': 4, 'unit-0': 50 })
    await page.getByTestId('closing').click()
    await page.getByTestId('settle').click()
    await expect(page.getByTestId('bs-check')).toContainText('貸借一致')

    // --- 履歴：2期分 ---
    await page.getByTestId('tab-history').click()
    await expect(page.getByTestId('detail-1')).toBeVisible()
    await expect(page.getByTestId('detail-2')).toBeVisible()
    // 過去期の決算書を閲覧
    await page.getByTestId('detail-1').click()
    await expect(page.getByTestId('statement')).toContainText('第1期の決算書を表示中')
    await page.getByTestId('stmt-back').click()

    // --- 組織タブ：チャート⇄数値（順位）・DBから取得 ---
    await page.getByTestId('tab-org').click()
    await expect(page.getByTestId('org-count')).toContainText('社')
    await expect(page.getByTestId('org-charts')).toBeVisible()
    await page.getByTestId('ov-table').click()
    await expect(page.getByTestId('org-cards')).toContainText('E2E製菓')

    // --- 振り返りタブ（推移・気づき） ---
    await page.getByTestId('tab-review').click()
    await expect(page.getByTestId('review')).toBeVisible()

    // --- 期末処理タブ：決算済みは勘定の図解を表示 ---
    await page.getByTestId('tab-closing').click()
    await expect(page.getByTestId('to-statement')).toBeVisible()

    // --- リロード復元（DBから）---
    await page.reload()
    await expect(page.getByTestId('resume-banner')).toBeVisible()
    await expect(page.getByTestId('hd-period')).toHaveText('第2期')

    // pageerror が無いこと
    expect((page as any)._mgErrors).toEqual([])
  })

  test('全アクション＆全イベントの記帳（残りのボタンを網羅・pageエラー無し）', async ({ page }) => {
    await page.goto(`/?org=E2E2`)
    await page.getByTestId('c-name').fill('網羅製菓')
    await page.getByTestId('c-pres').fill('全部太郎')
    await page.getByTestId('start').click()
    await page.getByTestId('tab-play').click()

    // 盤面づくり
    await act(page, 'kikai', { n: 2 })
    await act(page, 'saiyo', { mfg: 3, sales: 2 })
    await act(page, 'kaihatsu') // 商品開発（n固定・成功）
    await act(page, 'koukoku', { n: 2 })
    await act(page, 'shiire', { 'qty-0': 10, 'unit-0': 13 })
    await act(page, 'seizo', { qty: 6 })
    await act(page, 'haichi', { n: 1, dir: 'mfg->sales' }) // ルールB：配置転換
    await act(page, 'hanbai', { 'qty-0': 2, 'unit-0': 50 })

    // 全イベント（販売機会→仕入機会→在庫被害→退職→費用→手番のみ）
    await event(page, 'kaihatsu_win', { qty: 2 })
    await event(page, 'dokusen', { qty: 2, unit: 45 })
    await event(page, 'tokubai', { qty: 3 })
    await event(page, 'keiki', { qty: 2 })
    await act(page, 'hoken') // ルールB（イベントを挟んだので可）
    await event(page, 'ibutsu') // custom（保険で補償）
    await event(page, 'suigai') // custom（残材料破棄）
    await event(page, 'taishoku_sales')
    await event(page, 'kitchen')
    await event(page, 'rousai')
    await event(page, 'kaihatsu_fail')
    await event(page, 'kansen')
    await event(page, 'chiiki')
    await event(page, 'fuhyo')
    await event(page, 'gyaku')

    // 記帳の削除ボタン
    const before = await page.getByTestId('ledger').locator('tbody tr').count()
    await page.getByTestId(/^del-/).last().click()
    await expect(page.getByTestId('ledger').locator('tbody tr')).toHaveCount(before - 1)

    // 期末処理→記帳に戻る→期末処理→決算
    await page.getByTestId('closing').click()
    await page.getByTestId('undo-closing').click()
    await expect(page.getByTestId('act-shiire')).toBeVisible() // 記帳に戻った
    await page.getByTestId('closing').click()
    await page.getByTestId('settle').click()
    await expect(page.getByTestId('bs-check')).toContainText('貸借一致')

    expect((page as any)._mgErrors).toEqual([])
  })

  test('管理者：ログイン→成績一覧(DB値)→CSV→リセット', async ({ page }) => {
    await page.goto('/admin')
    await page.getByTestId('admin-pw').fill('mg')
    await page.getByTestId('admin-login').click()

    // ランダム組織コード生成（推測不可な参加URL）
    await page.getByTestId('gen-code').click()
    await expect(page.getByTestId('new-code')).toHaveValue(/^MG-[a-z2-9]{12}$/)
    await expect(page.getByTestId('new-url')).toContainText('/?org=MG-')

    // 組織 E2E を選択して成績一覧（DBの実値）
    await expect(page.getByTestId('admin-org')).toBeVisible()
    await page.getByTestId('admin-org').selectOption(ORG)
    await expect(page.getByTestId('admin-rank')).toBeVisible()
    await expect(page.getByTestId('admin-rank')).toContainText('E2E製菓')
    await expect(page.getByTestId('admin-rank')).toContainText('第1期')
    await expect(page.getByTestId('admin-rank')).toContainText('第2期')

    // CSV ダウンロード
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('csv-download').click(),
    ])
    expect(download.suggestedFilename()).toContain('MG成績_E2E')

    // 参加者リセット（行が消える）
    await page.getByTestId(/^admin-reset-/).first().click()
    await expect(page.getByTestId('admin-rank')).toHaveCount(0)

    expect((page as any)._mgErrors).toEqual([])
  })
})
