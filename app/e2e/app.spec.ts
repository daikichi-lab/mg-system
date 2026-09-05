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

// 記帳タブは ルールA / ルールB / イベントカード / 会社版 のサブタブ構造。
// ルールA/B はキーに応じたサブタブへ切り替えてからボタンを押す。
const A_KEYS = ['shiire', 'seizo', 'hanbai', 'kikai', 'saiyo', 'koukoku', 'kaihatsu']
const B_KEYS = ['hoken', 'kyoiku', 'haichi', 'kariire', 'hensai']

async function act(page: Page, key: string, fields: Record<string, string | number> = {}) {
  const sub = B_KEYS.includes(key) ? 'B' : 'A'
  await page.getByTestId(`sub-${sub}`).click()
  await page.getByTestId(`act-${key}`).click()
  await expect(page.getByTestId('modal-ok')).toBeVisible()
  for (const [name, val] of Object.entries(fields)) await setField(page, `field-${name}`, val)
  await page.getByTestId('modal-ok').click()
  await expect(page.getByTestId('modal-ok')).toBeHidden()
}

// イベントカードはプルダウン（イベントを選択→記帳）
async function event(page: Page, key: string, fields: Record<string, string | number> = {}) {
  await page.getByTestId('sub-X').click()
  await page.getByTestId('event-select').selectOption(key)
  await page.getByTestId('event-go').click()
  await expect(page.getByTestId('modal-ok')).toBeVisible()
  for (const [name, val] of Object.entries(fields)) await setField(page, `field-${name}`, val)
  await page.getByTestId('modal-ok').click()
  await expect(page.getByTestId('modal-ok')).toBeHidden()
}

// 期末処理→決算の2段階ボタン（play tab）。決算後は期末処理タブへ遷移する。
async function closeAndSettle(page: Page) {
  await page.getByTestId('closing').click() // 1段目：期末処理の記帳
  await page.getByTestId('confirm-ok').click() // 確認モーダル
  await expect(page.getByTestId('undo-closing')).toBeVisible()
  await page.getByTestId('closing').click() // 2段目：決算 → 期末処理タブへ
  await page.getByTestId('confirm-ok').click() // 確認モーダル
  await expect(page.getByTestId('to-statement')).toBeVisible()
  await page.getByTestId('to-statement').click() // 決算書へ
}

// 講師トークン。ログインはIP単位で15分に10回までなので、スペック全体で使い回す。
let adminToken = ''
async function getAdminToken(page: Page) {
  if (adminToken) return adminToken
  const login = await page.request.post('/api/admin/login', { data: { password: 'mg' } })
  adminToken = (await login.json()).token
  return adminToken
}

// 講師が研修を作成（＝組織コードを登録）＝参加者がそのURLで開始できるようにする
async function registerOrg(page: Page, code: string, name = '') {
  const token = await getAdminToken(page)
  const res = await page.request.post('/api/admin/org', {
    data: { code, name },
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) throw new Error(`研修の作成に失敗: ${res.status()} ${await res.text()}`)
}

test.describe.serial('戦略MG 本番アプリ E2E', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    ;(page as any)._mgErrors = errors
  })

  test('未登録の組織コードURLは404（開始できない）', async ({ page }) => {
    await page.goto('/?org=NO-SUCH-ORG-zzz')
    await expect(page.getByTestId('org-error')).toBeVisible()
    await page.goto('/')
    await expect(page.getByTestId('org-error')).toBeVisible()
  })

  test('経営計画書：第3期からタブが出て、計画を入力すると必要個数が出てリロード後も残る', async ({ page }) => {
    await registerOrg(page, 'E2EPLAN')
    await page.goto('/?org=E2EPLAN')
    await page.getByTestId('c-name').fill('E2E計画社')
    await page.getByTestId('c-pres').fill('計画太郎')
    await page.getByTestId('start').click()
    await expect(page.getByTestId('hd-name')).toHaveText('E2E計画社')
    // 既定ルール（planFromPeriod=3）：第1期・第2期はタブ自体が出ない
    await expect(page.getByTestId('tab-play')).toBeVisible()
    await expect(page.getByTestId('tab-plan')).toHaveCount(0)

    // 第1期：水害テストデータ → 決算 → 次の期へ
    await page.getByTestId('tab-play').click()
    await page.getByTestId('seed-flood').click()
    await closeAndSettle(page)
    await page.getByTestId('next-period').click()
    await expect(page.getByTestId('hd-period')).toHaveText('第2期')
    await expect(page.getByTestId('tab-plan')).toHaveCount(0)

    // 第2期：記帳なしで決算 → 次の期へ
    await page.getByTestId('tab-play').click()
    await closeAndSettle(page)
    await page.getByTestId('next-period').click()
    await expect(page.getByTestId('hd-period')).toHaveText('第3期')

    // 第3期：経営計画書タブが出る。期首の盤面（製造1・販売1・機械1、第3期の給料 31）から F ＝ 31＋31＋10＋25 ＝ 97
    await page.getByTestId('tab-plan').click()
    await expect(page.getByTestId('plan')).toBeVisible()
    await expect(page.getByTestId('plan-F')).toHaveText('97')
    await setField(page, 'plan-g', 100)
    await setField(page, 'plan-p', 32)
    await setField(page, 'plan-v', 12)
    // MQ ＝ 100＋97 ＝ 197、M ＝ 20、Q ＝ ⌈197÷20⌉ ＝ 10、PQ ＝ 320、VQ ＝ 120
    await expect(page.getByTestId('plan-MQ')).toHaveText('197')
    await expect(page.getByTestId('plan-M')).toHaveText('20')
    await expect(page.getByTestId('plan-Q')).toContainText('10')
    await expect(page.getByTestId('plan-PQ')).toHaveText('320')
    await expect(page.getByTestId('plan-VQ')).toHaveText('120')
    // アクションプラン：1行目に出金を入れると残高が減る
    await setField(page, 'plan-act-text-0', '仕入 5個')
    await setField(page, 'plan-act-amt-0', -60)

    // 入力が落ち着いてから保存される → リロードしても残っている（DB 経由）
    await page.waitForTimeout(1500)
    await page.reload()
    await expect(page.getByTestId('hd-period')).toHaveText('第3期')
    await page.getByTestId('tab-plan').click()
    await expect(page.getByTestId('plan-g')).toHaveValue('100')
    await expect(page.getByTestId('plan-act-text-0')).toHaveValue('仕入 5個')
    await expect(page.getByTestId('plan-act-amt-0')).toHaveValue('-60')
    await expect(page.getByTestId('plan-Q')).toContainText('10')
  })

  test('参加者：会社作成→全アクション→決算→次期→履歴/組織→リロード復元', async ({ page }) => {
    await registerOrg(page, ORG)
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

    // 盤面（会社盤）が反映されている：製造能力/販売能力の数値・製品0で店舗は空
    await page.getByTestId('sub-company').click()
    await expect(page.getByTestId('board-fig')).toBeVisible()
    await expect(page.getByTestId('bd-mfgcap')).toHaveText('6') // 製造ｽﾀｯﾌ2×機械1×教育3
    await expect(page.getByTestId('bd-salescap')).toHaveText('4') // 販売ｽﾀｯﾌ1×2＋広告
    await expect(page.getByTestId('board-fig')).toContainText('空') // 販売後・店舗は空

    // バリデーション：販売能力超過はモーダル内にエラー表示（複数可）
    await page.getByTestId('sub-A').click()
    await page.getByTestId('act-hanbai').click()
    await setField(page, 'field-qty-0', 99)
    await page.getByTestId('modal-ok').click()
    await expect(page.getByTestId('modal-errors')).toBeVisible()
    await page.getByRole('button', { name: 'やめる' }).click()
    await expect(page.getByTestId('modal-ok')).toBeHidden()

    // 記帳の削除ボタン（1件消して戻す確認だけ）: claim 行を消す代わりにここでは存在確認
    await expect(page.getByTestId('ledger')).toBeVisible()

    // --- 期末処理（2段階）→ 決算 → 決算書 ---
    await closeAndSettle(page)

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
    // CF数値（営業/投資/財務）・法人税計算・補助勘定が表示される
    await expect(page.getByTestId('cf-op')).toBeVisible()
    await expect(page.getByTestId('cf-inv')).toBeVisible()
    await expect(page.getByTestId('cf-fin')).toBeVisible()
    await expect(page.getByTestId('cf-net')).toBeVisible()
    await expect(page.getByTestId('tx-tax')).toBeVisible() // ⑤ 法人税等
    await expect(page.getByTestId('tx-ret1')).toBeVisible() // ⑦ 次期繰越利益剰余金
    // 資産合計＝負債純資産計
    const assets1 = await page.getByTestId('bs-assets').textContent()
    const liabeq1 = await page.getByTestId('bs-liabeq').textContent()
    expect(assets1).toBe(liabeq1)

    // --- 次の期へ（期首処理タブへ自動遷移）---
    await page.getByTestId('next-period').click()
    await expect(page.getByTestId('hd-period')).toHaveText('第2期')
    await expect(page.getByTestId('opening')).toBeVisible() // 期首処理タブに移動している

    // --- 第2期：借入を含む ---
    await page.getByTestId('tab-play').click()
    await act(page, 'kariire', { a: 50 }) // 第2期は借入可
    await expect(page.getByTestId('ledger')).toContainText('借入') // 借入行が記帳された
    await act(page, 'koukoku', { n: 1 })
    await act(page, 'shiire', { 'qty-0': 6, 'unit-0': 13 })
    await act(page, 'seizo', { qty: 4 })
    await act(page, 'hanbai', { 'qty-0': 4, 'unit-0': 50 })
    await closeAndSettle(page)
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

    // --- リロード復元（DBから・バナー無しで自動引き継ぎ）---
    await page.reload()
    await expect(page.getByTestId('hd-name')).toHaveText('E2E製菓')
    await expect(page.getByTestId('hd-period')).toHaveText('第2期')

    // pageerror が無いこと
    expect((page as any)._mgErrors).toEqual([])
  })

  test('全アクション＆全イベントの記帳（残りのボタンを網羅・pageエラー無し）', async ({ page }) => {
    await registerOrg(page, 'E2E2')
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

    // 期末処理（1段目）→記帳に戻る→期末処理→決算（2段目）
    await page.getByTestId('closing').click() // 1段目：期末処理の記帳
    await page.getByTestId('confirm-ok').click() // 確認モーダル
    await expect(page.getByTestId('undo-closing')).toBeVisible()
    await page.getByTestId('undo-closing').click() // 記帳に戻る（play tabのまま）
    await page.getByTestId('sub-A').click()
    await expect(page.getByTestId('act-shiire')).toBeVisible() // 記帳に戻った
    await closeAndSettle(page)
    await expect(page.getByTestId('bs-check')).toContainText('貸借一致')

    expect((page as any)._mgErrors).toEqual([])
  })

  test('第1期の水害テストデータ投入ボタン（mockと同一データ→決算まで通る）', async ({ page }) => {
    await registerOrg(page, 'E2E3')
    await page.goto(`/?org=E2E3`)
    await page.getByTestId('c-name').fill('水害製菓')
    await page.getByTestId('c-pres').fill('水害太郎')
    await page.getByTestId('start').click()
    await page.getByTestId('tab-play').click()

    // 第1期のみ表示される水害シードボタン
    await expect(page.getByTestId('seed-flood')).toBeVisible()
    await page.getByTestId('seed-flood').click()

    // 記帳が投入され、上部カード（今期の売上）が反映される
    await expect(page.getByTestId('ledger').locator('tbody tr').first()).toBeVisible()
    await expect(page.getByTestId('stat-sales')).not.toHaveText('0')

    // 決算まで通る（2段階→貸借一致）
    await closeAndSettle(page)
    await expect(page.getByTestId('bs-check')).toContainText('貸借一致')

    // リロードしても決算内容（期末処理・決算書）が保持される（st.result 復元の回帰防止）
    await page.reload()
    await expect(page.getByTestId('hd-name')).toHaveText('水害製菓')
    await page.getByTestId('tab-closing').click()
    await expect(page.getByTestId('closing-run')).toHaveCount(0) // 「決算を実行する」に戻らない
    await expect(page.getByTestId('to-statement')).toBeVisible() // 期末処理の内容が読める
    await page.getByTestId('tab-statement').click()
    await expect(page.getByTestId('statement')).toBeVisible()
    await expect(page.getByTestId('bs-check')).toContainText('貸借一致')
    await expect(page.getByTestId('next-period')).toBeVisible() // 次の期へも進める

    expect((page as any)._mgErrors).toEqual([])
  })

  test('記帳の編集・削除：アクション行は数量編集、期末(給料/家賃)は金額のみ編集で削除不可', async ({ page }) => {
    await registerOrg(page, 'E2E4')
    await page.goto(`/?org=E2E4`)
    await page.getByTestId('c-name').fill('編集製菓')
    await page.getByTestId('c-pres').fill('編集太郎')
    await page.getByTestId('start').click()
    await page.getByTestId('tab-play').click()

    await act(page, 'kikai', { n: 1 })
    await act(page, 'saiyo', { mfg: 2, sales: 1 })
    await act(page, 'shiire', { 'qty-0': 6, 'unit-0': 13 })

    // 仕入れ行を ✎ 編集：数量 6→8（金額 78→104・材料も 6→8 に反映）
    const shiireRow = page.getByTestId('ledger').locator('tbody tr', { hasText: '仕入れ' })
    await shiireRow.getByTestId(/^edit-/).click()
    await expect(page.getByTestId('field-qty-0')).toHaveValue('6')
    await setField(page, 'field-qty-0', 8)
    await page.getByTestId('modal-ok').click()
    await expect(page.getByTestId('modal-ok')).toBeHidden()
    await expect(shiireRow).toContainText('104')
    await expect(page.getByTestId('stat-raw')).toHaveText('8')

    // 期末処理（1段目）で給料/家賃を計上
    await page.getByTestId('closing').click()
    await page.getByTestId('confirm-ok').click() // 確認モーダル

    // 家賃(期末)：✎ 編集はあるが ✕ 削除は無い → 金額を 25→30 に変更
    const rentRow = page.getByTestId('ledger').locator('tbody tr', { hasText: '家賃(期末)' })
    await expect(rentRow.getByTestId(/^del-/)).toHaveCount(0)
    await rentRow.getByTestId(/^edit-/).click()
    await expect(page.getByTestId('amount-input')).toHaveValue('25')
    await page.getByTestId('amount-input').fill('30')
    await page.getByTestId('amount-ok').click()
    await expect(page.getByTestId('amount-ok')).toBeHidden()
    await expect(rentRow).toContainText('30')

    // 給料(期末)も削除不可
    const salaryRow = page.getByTestId('ledger').locator('tbody tr', { hasText: '給料(期末)' })
    await expect(salaryRow.getByTestId(/^del-/)).toHaveCount(0)

    expect((page as any)._mgErrors).toEqual([])
  })

  test('決算の取り消し：決算後に記帳へ戻って修正→再決算（リロード復元も含む）', async ({ page }) => {
    await registerOrg(page, 'E2E5')
    await page.goto(`/?org=E2E5`)
    await page.getByTestId('c-name').fill('取消製菓')
    await page.getByTestId('c-pres').fill('取消太郎')
    await page.getByTestId('start').click()
    await page.getByTestId('tab-play').click()

    await act(page, 'kikai', { n: 1 })
    await act(page, 'saiyo', { mfg: 2, sales: 1 })
    await act(page, 'shiire', { 'qty-0': 6, 'unit-0': 13 })
    await act(page, 'seizo', { qty: 4 })
    await act(page, 'hanbai', { 'qty-0': 2, 'unit-0': 50 })
    await closeAndSettle(page)
    await expect(page.getByTestId('statement')).toBeVisible()

    // 決算書から「記帳を修正する」→ 確認モーダル → 記帳タブに戻る（期末自動行も消える）
    await page.getByTestId('unsettle').click()
    await expect(page.getByTestId('confirm-title')).toContainText('決算を取り消しますか')
    await page.getByTestId('confirm-ok').click()
    await expect(page.getByTestId('closing')).toBeVisible() // 記帳タブ・未決算状態
    await expect(page.getByTestId('ledger').locator('tbody tr', { hasText: '給料(期末)' })).toHaveCount(0)

    // リロードしても未決算のまま復元される（成績もDBから消えている）
    await page.reload()
    await page.getByTestId('tab-play').click()
    await expect(page.getByTestId('closing')).toBeVisible()
    await page.getByTestId('tab-history').click()
    await expect(page.getByTestId('history')).toHaveCount(0)

    // 修正（追加販売）して再決算 → 売上が増えた決算書に置き換わる
    await page.getByTestId('tab-play').click()
    await act(page, 'hanbai', { 'qty-0': 2, 'unit-0': 40 })
    await expect(page.getByTestId('stat-sales')).toHaveText('180')
    await closeAndSettle(page)
    await expect(page.getByTestId('statement')).toBeVisible()
    await expect(page.getByTestId('bs-check')).toContainText('貸借一致')
    await page.getByTestId('tab-history').click()
    await expect(page.getByTestId('history').locator('tbody tr')).toHaveCount(1)
    await expect(page.getByTestId('history')).toContainText('180')

    expect((page as any)._mgErrors).toEqual([])
  })

  test('管理者：編集モードで参加者の数値を修正→参加者側に反映される', async ({ page }) => {
    // 参加者を作成して記帳（資本金300＋機械購入）
    await registerOrg(page, 'E2E6')
    await page.goto(`/?org=E2E6`)
    await page.getByTestId('c-name').fill('修正製菓')
    await page.getByTestId('c-pres').fill('修正太郎')
    await page.getByTestId('start').click()
    await page.getByTestId('tab-play').click()
    await act(page, 'kikai', { n: 1 })

    // 管理者ビュー → 参加者を選択 → 編集モードに切替
    await page.goto('/admin/session?org=E2E6')
    await page.getByTestId('admin-pw').fill('mg')
    await page.getByTestId('admin-login').click()
    await page.locator('text=修正製菓').first().click()
    await page.getByTestId('frame-edit').click()

    const frame = page.frameLocator('[data-testid="spectator-frame"]')
    await expect(frame.getByTestId('instructor-banner')).toBeVisible()

    // iframe 内で資本金 300→400 に修正（キーレス行の金額編集）
    await frame.getByTestId('tab-play').click()
    const capRow = frame.getByTestId('ledger').locator('tbody tr', { hasText: '資本金' })
    await capRow.getByTestId(/^edit-/).click()
    await expect(frame.getByTestId('amount-input')).toHaveValue('300')
    await frame.getByTestId('amount-input').fill('400')
    await frame.getByTestId('amount-ok').click()
    await expect(capRow).toContainText('400')

    // 閲覧専用モードでは編集ボタンが出ない
    await page.getByTestId('frame-view').click()
    const vframe = page.frameLocator('[data-testid="spectator-frame"]')
    await vframe.getByTestId('tab-play').click()
    await expect(vframe.getByTestId('ledger')).toBeVisible()
    await expect(vframe.getByTestId('ledger').locator('tbody tr', { hasText: '資本金' }).getByTestId(/^edit-/)).toHaveCount(0)

    // 参加者側で開き直すと修正が反映されている
    await page.goto(`/?org=E2E6`)
    await page.getByTestId('tab-play').click()
    await expect(page.getByTestId('ledger').locator('tbody tr', { hasText: '資本金' })).toContainText('400')
    await expect(page.getByTestId('stat-cash')).toHaveText('300') // 400 − 機械100

    expect((page as any)._mgErrors).toEqual([])
  })

  test('管理者：ログイン→成績一覧(DB値)→CSV→リセット', async ({ page }) => {
    await page.goto('/admin')
    await page.getByTestId('admin-pw').fill('mg')
    await page.getByTestId('admin-login').click()

    // 研修を開始（モーダルで研修名を入れて作成 → 研修URLが表示される）
    await page.getByTestId('start-session').click()
    await page.getByTestId('new-name').fill('E2E 新規研修')
    await expect(page.getByTestId('new-code')).toHaveValue(/^MG-[a-z2-9]{12}$/)
    await page.getByTestId('create-session').click()
    await expect(page.getByTestId('created-url')).toHaveValue(/\/\?org=MG-/)
    await page.getByTestId('created-close').click()
    await expect(page.getByTestId('session-table')).toContainText('E2E 新規研修')

    // 対象の研修の管理画面へ → 成績一覧タブ（DBの実値）
    await page.goto(`/admin/session?org=${ORG}`)
    await page.getByTestId('mv-rank').click()
    await expect(page.getByTestId('admin-rank')).toBeVisible()
    await expect(page.getByTestId('admin-rank')).toContainText('E2E製菓')
    await expect(page.getByTestId('admin-rank')).toContainText('第1期')
    await expect(page.getByTestId('admin-rank')).toContainText('第2期')

    // 表形式：指標クリックでソート（▼降順 → ▲昇順 → 解除）
    await page.getByTestId('sort-PQ').click()
    await expect(page.getByTestId('sort-PQ')).toContainText('▼')
    await page.getByTestId('sort-PQ').click()
    await expect(page.getByTestId('sort-PQ')).toContainText('▲')
    await page.getByTestId('sort-PQ').click()
    await expect(page.getByTestId('sort-PQ')).not.toContainText('▲')

    // 期フィルタ：第1期のみに絞ると第2期の列が消える
    await page.getByTestId('rank-period').selectOption('1')
    await expect(page.getByTestId('admin-rank')).not.toContainText('第2期')
    await page.getByTestId('rank-period').selectOption('0')
    await expect(page.getByTestId('admin-rank')).toContainText('第2期')

    // グラフ形式に切替 → チャート表示 → 表形式に戻す
    await page.getByTestId('rank-charts').click()
    await expect(page.getByTestId('admin-charts')).toBeVisible()
    await expect(page.getByTestId('admin-charts')).toContainText('売上 PQ の推移')
    await page.getByTestId('rank-table').click()
    await expect(page.getByTestId('admin-rank')).toBeVisible()

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

  test('管理者：組織自体を削除（参加者がいても登録＋データが消え、URLも無効化）', async ({ page }) => {
    await registerOrg(page, 'E2EDEL')
    // 参加者を1社つくって決算まで（＝会社データがある状態で組織削除する）
    await page.goto('/?org=E2EDEL')
    await page.getByTestId('c-name').fill('削除対象製菓')
    await page.getByTestId('c-pres').fill('削除太郎')
    await page.getByTestId('start').click()
    await page.getByTestId('tab-play').click()
    await page.getByTestId('seed-flood').click()
    await closeAndSettle(page)

    // その研修の管理画面で参加者が見えていることを確認
    await page.goto('/admin/session?org=E2EDEL')
    await page.getByTestId('admin-pw').fill('mg')
    await page.getByTestId('admin-login').click()
    await expect(page.getByText('削除対象製菓')).toBeVisible()

    // 研修一覧から削除
    await page.goto('/admin')
    await expect(page.getByTestId('session-row-E2EDEL')).toBeVisible()
    await page.getByTestId('remove-E2EDEL').click()
    await expect(page.getByTestId('session-row-E2EDEL')).toHaveCount(0)

    // 参加用URLも無効化：404（参加できない）
    await page.goto('/?org=E2EDEL')
    await expect(page.getByTestId('org-error')).toBeVisible()

    expect((page as any)._mgErrors).toEqual([])
  })
  test('管理者：研修一覧から研修名・研修URLを変更する', async ({ page }) => {
    await registerOrg(page, 'E2EEDIT')
    // 参加者を1社つくる（URL変更でデータが引き継がれることを確認するため）
    await page.goto('/?org=E2EEDIT')
    await page.getByTestId('c-name').fill('引越製菓')
    await page.getByTestId('c-pres').fill('引越太郎')
    await page.getByTestId('start').click()

    await page.goto('/admin')
    await page.getByTestId('admin-pw').fill('mg')
    await page.getByTestId('admin-login').click()

    // 編集モーダルで研修名と研修URLを変更（URL変更時は警告が出る）
    await page.getByTestId('edit-E2EEDIT').click()
    await page.getByTestId('edit-name').fill('名前つき研修')
    // 再生成ボタンで新しいコードが入ることを確認してから、検証しやすい値に置き換える
    await page.getByTestId('edit-gen-code').click()
    await expect(page.getByTestId('edit-code')).toHaveValue(/^MG-[a-z2-9]{12}$/)
    await page.getByTestId('edit-code').fill('E2EEDIT2')
    await expect(page.getByTestId('edit-warn')).toBeVisible()
    await page.getByTestId('save-session').click()

    // 一覧が新しい研修名・新しいコードに置き換わる
    await expect(page.getByTestId('session-table')).toContainText('名前つき研修')
    await expect(page.getByTestId('session-row-E2EEDIT2')).toBeVisible()
    await expect(page.getByTestId('session-row-E2EEDIT')).toHaveCount(0)

    // 旧URLでは参加できない
    await page.goto('/?org=E2EEDIT')
    await expect(page.getByTestId('org-error')).toBeVisible()

    // 新URLの管理画面に参加者データが引き継がれている
    await page.goto('/admin/session?org=E2EEDIT2')
    await expect(page.getByTestId('session-name')).toHaveText('名前つき研修')
    await expect(page.getByText('引越製菓')).toBeVisible()

    expect((page as any)._mgErrors).toEqual([])
  })
  test('管理者：ルールの作成→確認→編集→複製→削除（URLで画面が決まる）', async ({ page }) => {
    await page.goto('/admin/rules')
    await page.getByTestId('admin-pw').fill('mg')
    await page.getByTestId('admin-login').click()

    // 一覧には既定ルールが並んでいる。既定は削除できない
    await expect(page.getByTestId('ruleset-table')).toContainText('入門編 標準')
    await expect(page.getByTestId(/^del-/).first()).toBeDisabled()

    // 作成
    await page.getByTestId('new-ruleset').click()
    await expect(page).toHaveURL(/\/admin\/rules\/new$/)
    await page.getByTestId('rule-name-input').fill('E2E 上級編')
    await page.getByTestId('rule-desc-input').fill('金利と家賃を上げた設定')
    await page.getByTestId('f-loanRate').fill('8')
    await page.getByTestId('f-rent').fill('40')
    await page.getByTestId('f-salary-0').fill('30')
    // 仕入単価はタグ：1つ外して1つ足す
    await page.getByTestId('price-del-16').click()
    await page.getByTestId('price-new').fill('9')
    await page.getByTestId('price-add').click()
    await page.getByTestId('rule-save').click()

    // 確認画面へ遷移し、入れた値が出る
    await expect(page).toHaveURL(/\/admin\/rules\/\d+$/)
    await expect(page.getByTestId('rule-name')).toContainText('E2E 上級編')
    const view = page.getByTestId('rule-view')
    await expect(view).toContainText('8%')
    await expect(view).toContainText('40')
    await expect(view).toContainText('9')
    await expect(view).not.toContainText('16')

    // URL を直接開いても同じ画面（リロード耐性）
    const viewUrl = page.url()
    await page.goto(viewUrl)
    await expect(page.getByTestId('rule-name')).toContainText('E2E 上級編')

    // 編集：家賃を変えて保存 → 確認画面に反映
    await page.getByTestId('rule-edit').click()
    await expect(page).toHaveURL(/\/admin\/rules\/\d+\/edit$/)
    await page.getByTestId('f-rent').fill('45')
    await page.getByTestId('rule-save').click()
    await expect(page).toHaveURL(viewUrl)
    await expect(page.getByTestId('rule-view')).toContainText('45')

    // 複製 → 編集画面が開き、名前が「… のコピー」になっている
    await page.getByTestId('rule-duplicate').click()
    await expect(page).toHaveURL(/\/admin\/rules\/\d+\/edit$/)
    await expect(page.getByTestId('rule-name-input')).toHaveValue('E2E 上級編 のコピー')

    // 一覧に2件出て、コピーを削除できる
    await page.getByTestId('menu-rules').click()
    await expect(page.getByTestId('ruleset-table')).toContainText('E2E 上級編 のコピー')
    const rows = page.locator('[data-testid^="ruleset-row-"]')
    const before = await rows.count()
    await page.locator('[data-testid^="del-"]:not([disabled])').first().click()
    await expect(rows).toHaveCount(before - 1)

    expect((page as any)._mgErrors).toEqual([])
  })

  test('管理者：既定ルールは編集できず、複製に誘導される', async ({ page }) => {
    await page.goto('/admin/rules')
    await page.getByTestId('admin-pw').fill('mg')
    await page.getByTestId('admin-login').click()

    await page.locator('[data-testid^="ruleset-row-"]', { hasText: '入門編 標準' }).click()
    await expect(page.getByTestId('rule-name')).toContainText('入門編 標準')
    // 編集ボタンは出ず、複製への誘導が出る
    await expect(page.getByTestId('rule-edit')).toHaveCount(0)
    await expect(page.getByTestId('rule-duplicate')).toBeVisible()
    // 既定の数値が既定値のまま出ている（家賃25・金利5%・機械100）
    const view = page.getByTestId('rule-view')
    await expect(view).toContainText('25')
    await expect(view).toContainText('5%')
    await expect(view).toContainText('100')

    expect((page as any)._mgErrors).toEqual([])
  })

  test('研修にルールを適用：選んだ数値が参加者の計算に効き、開催中は変更できない', async ({ page }) => {
    // --- 1. ルールを作る（機械価格 100 → 120）---
    await page.goto('/admin/rules')
    await page.getByTestId('admin-pw').fill('mg')
    await page.getByTestId('admin-login').click()
    await page.getByTestId('new-ruleset').click()
    await page.getByTestId('rule-name-input').fill('E2E 機械高騰')
    await page.getByTestId('f-machinePrice').fill('120')
    await page.getByTestId('rule-save').click()
    await expect(page).toHaveURL(/\/admin\/rules\/\d+$/)

    // --- 2. そのルールを選んで研修を開始する ---
    const code = 'E2E-RULES'
    await page.goto('/admin')
    await page.getByTestId('start-session').click()
    await page.getByTestId('new-name').fill('ルール適用の研修')
    await page.getByTestId('new-code').fill(code)
    await page.getByTestId('new-org-ruleset').selectOption({ label: 'E2E 機械高騰' })
    // 取り違え防止の要約に、選んだ機械価格が出る
    await expect(page.getByTestId('new-org-ruleset-summary')).toContainText('機械 120')
    await page.getByTestId('create-session').click()
    await page.getByTestId('created-close').click()

    // 一覧にルール名とステータスが出る
    await expect(page.getByTestId(`ruleset-${code}`)).toHaveText('E2E 機械高騰')
    await expect(page.getByTestId(`status-${code}`)).toHaveValue('preparing')

    // --- 3. 参加者：機械購入が 120 で記帳される（既定なら 100）---
    await page.goto(`/?org=${code}`)
    await page.getByTestId('c-name').fill('ルール製菓')
    await page.getByTestId('c-pres').fill('適用太郎')
    await page.getByTestId('start').click()
    await page.getByTestId('tab-play').click()
    // 記帳ボタンのヒントもルールに追従する（表示だけ既定値のままだと取り違える・issue #23）
    await page.getByTestId('sub-A').click()
    await expect(page.getByTestId('act-kikai')).toContainText('−120')
    await act(page, 'kikai', { n: 1 })
    await expect(page.getByTestId('ledger')).toContainText('120')
    await expect(page.getByTestId('hd-cash')).toHaveText('180') // 資本金300 − 機械120

    // リロードしても、その研修のルールで盤面が組み直される
    await page.reload()
    await expect(page.getByTestId('hd-cash')).toHaveText('180')

    // --- 4. 進行中にするとルールは変更できない ---
    await page.goto('/admin')
    await page.getByTestId(`status-${code}`).selectOption('running')
    await expect(page.getByTestId(`status-${code}`)).toHaveValue('running')
    await page.getByTestId(`edit-${code}`).click()
    await expect(page.getByTestId('edit-org-ruleset-locked')).toContainText('E2E 機械高騰')
    await expect(page.getByTestId('edit-org-ruleset')).toHaveCount(0)

    expect((page as any)._mgErrors).toEqual([])
  })

})
