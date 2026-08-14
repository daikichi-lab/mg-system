# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 作業ルール（最優先・例外なし）

1. **issue 番号がない作業はしない。** 依頼を受けたら、まず GitHub issue を作成する（`gh issue create`）。該当する既存 issue があればその番号を使う。issue を作らずにコードを触らない。
2. **ブランチは main から、issue 番号で作る。** 例：issue #12 なら `git switch -c 12-loan-rate origin/main`（`<issue番号>-<短い英字スラッグ>`）。
3. **作業後は PR まで作る。** `git push -u origin <branch>` → `gh pr create --base main`。PR 本文に `Closes #<issue番号>` を入れる。
4. **マージは必ず人間が行う。** `gh pr merge` は実行しない。push と PR 作成までで止め、レビュー依頼を出して終わる。
5. **本番へのデプロイも人間が行う。** 自動デプロイは無効（`render.yaml` の `autoDeploy: false`）。
   **main にマージしても本番は変わらない。** 反映は Render の Manual Deploy による手動操作。

### 作業順序

```
issue 作成 → main からブランチ作成（issue番号） → 実装 → lint + テスト → コミット → push → PR 作成
                                                        → （人間がマージ）→ （人間が Render で手動デプロイ）
```

- 1 PR = 1 ゴール。まとめて出さない。過去に一括開発して本番検証が不能になった経緯がある（issue #5）。
- issue・PR・コミットメッセージ・コード内コメント・ドキュメントはすべて**日本語**。
- 依頼やタスクは **GitHub issue で管理する**。`docs/` にチェックリスト形式の消化リストを作らない。
- GitHub 操作は daikichi アカウント（`fugashiojiri-daikichi`）で行う。リモートは `daikichi-lab/mg-system`（push 権限あり／admin なし）。

### `feat/auth-rework` の扱い

ローカルに未 push のブランチ `feat/auth-rework`（main より21コミット先行）がある。ルールセット化・管理画面拡張・認証刷新などが入っているが、
**一度に開発しすぎて本番検証ができなくなったため凍結**している。

- 新しい作業は**必ず main から**始める。このブランチを起点にしない・マージしない。
- **実装の参考として読むのは可**。同じものを再実装するときは、必要な部分だけを小さい PR に切り直して main へ入れる。

## 使用言語・スタック

| 層 | 言語・技術 |
|---|---|
| フロント | React 19 + Vite + TypeScript（strict）+ Tailwind v4 |
| 計算エンジン | TypeScript の純関数（`app/src/lib/calc.ts`） |
| サーバ | Node 24（ESM）+ Express。`.js` のまま（TS ではない） |
| DB | 二刀流：既定 `node:sqlite`／`DATABASE_URL` があれば PostgreSQL（`pg`） |
| Lint | oxlint（`app/.oxlintrc.json`） |
| テスト | `node --test`（`.ts` を Node の型ストリップで直接実行）＋ Playwright |

Node 24 前提（`node:sqlite` と TS 直接実行のため）。`app/` がアプリのルート。

## コマンド

```bash
cd app && npm install

npm run dev      # Vite(:5173) + API(:3001) 同時起動。/api は :3001 へプロキシ
npm run build    # tsc -b（strict）→ vite build → dist/
npm start        # Express が dist と API を :3001 で配信
npm run lint     # oxlint
```

参加者 `/`、講師 `/admin`。環境変数：`PORT`(3001) / `MG_DB`(SQLiteパス) / `DATABASE_URL` / `MG_ADMIN_PW`(既定 `mg`)。

### テスト

```bash
npm run test:calc   # golden-master：TSエンジンが mock と数値厳密一致するか
npm run test:game   # 台帳整合（幽霊販売クランプ・行削除/編集ガード・決算ブロック）
npm run test:db     # Postgres 方言の round-trip（pglite = WASM版Postgres）
npm run test:orgs   # 研修（組織）のマイグレーション・改名・研修URL変更
npm run test:pgssl  # 接続先ごとの TLS 判定（Render Internal URL / FQDN / sslmode）
npm run test:e2e    # Playwright（:3021・毎回 e2e.db を消してクリーン起動）
```

単体で1件だけ流す：

```bash
node --test --test-name-pattern '幽霊販売' test/game.test.ts
npx playwright test e2e/app.spec.ts -g '<テスト名>'
```

Playwright の Chromium は `$HOME/.cache/ms-playwright` 固定（`playwright.config.ts` と `test/gen-golden.mjs` にパスが直書き）。未取得なら
`PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright npx playwright install chromium`。

### 計算エンジンを変更したとき（★必ず両方直す）

```bash
node test/gen-golden.mjs   # mock/index.html をヘッドレス実行して golden.json を再生成
npm run test:calc
```

`mock/index.html` が計算の**原典**で、`gen-golden.mjs` はそれを実際にブラウザで走らせて期待値（`test/golden.json`）を作る。
したがってルールや計算を変えるときは **`app/src/lib/calc.ts` と `mock/index.html` の両方**を直し、golden.json を再生成する。片方だけ直すとテストが落ちる。

## アーキテクチャ

### 全体の形

`mock/`（単一HTMLのプロトタイプ・ビルド不要）と `app/`（本番実装）の2本立て。両者は golden-master テストで数値的に結ばれている。
`mock/index.html` が参加者アプリ、`mock/admin.html` が講師用。ビルド不要で `python3 -m http.server 8770 --directory mock` で動く。

### tx 再生エンジン（`app/src/lib/calc.ts`）

このリポジトリの計算はすべてここに集約されている。**記帳行（tx）を保存し、`recompute()` が毎回 `apply()` を再実行して盤面（在庫・什器評価額・売上数量）を組み直す**方式。
現金の出入りは各行の保存済み `amount` の合計（`colTotals()`）。

主な関数：`recompute()` / `doClosingPrep()`（期末処理）/ `settle()`（決算）/ `nextPeriod()`（期またぎ引き継ぎ）。

**この構造から来る制約**：`apply()` の中で単価を参照している項目（機械購入・特別サービス・景気上昇・商品開発成功など）は、
**定数を変えると過去の記帳行の盤面だけが遡って変化し、保存済み `amount` と食い違って B/S が壊れる**。
ゲーム定数を変更するときは、進行中データへの影響を必ず確認すること。

### ゲーム定数は calc.ts に直書き

`LOAN_RATE` / `RENT` / `DEP_PER_MACHINE` / `MACHINE_PRICE` / `MATERIAL_PRICES` / `MAT_CAP` / `PROD_CAP` などは `calc.ts` の定数（`calc.ts:141` 付近）。
研修回ごとに差し替える仕組みは main には無い（`feat/auth-rework` に実装があるが凍結中）。issue #5 の第2ゴールがここ。

### 動かしてはいけない前提

- **列（col）は11列固定**。`COLS = 11`、`IN_COLS = [0,1,2,3]` が入金列で残りが出金列。既存の割当は変えない。
- **第1期は借入関連なし**。借入・借入可能枠・金利・期末返済はすべて第2期以降。

### 表示層（`app/src/lib/figures*.ts`）

決算書のビジュアル（STRAC 面積図／P/L・CF ウォーターフォール／B/S 図）は、mock の描画関数を移植したもので、
**インラインスタイルで HTML 文字列を組み立てる**。Tailwind クラスは使わない（文字列内のクラス名は purge で消えるため）。

### サーバ（`app/server/`）

- `index.js` … Express の REST API ＋ `dist` 配信。API は11本。参加者系は無認証、`/api/admin/*` のみトークン必須。
- `db.js` … スキーマ＋クエリ層。SQL は `?` プレースホルダで書き、pg ドライバ側で `$1..` へ変換する。テーブルは `companies` / `entries` / `period_results` / `orgs`。
- **スキーマ変更は `migrate()` に足す。** スキーマ本体は `CREATE TABLE IF NOT EXISTS` なので、既存DB（本番）のテーブルには列が増えない。
  `ADDED_COLUMNS` に `[テーブル, [列名, 型]]` を書くと、不足している列だけ `ALTER TABLE … ADD COLUMN` される。**追加のみ**で、削除・型変更はしない。
  ドライバは `kind`（`'sqlite'` / `'pg'`）を持ち、列の確認は SQLite が `PRAGMA table_info`、Postgres が `information_schema.columns`。
- **講師認証は暫定実装**：パスワードは `MG_ADMIN_PW`（既定 `mg`）の平文比較、トークンはインメモリ `Set`（無期限・再起動で消える）。
  公開運用の前に実認証・トークン期限・HTTPS が必要（`app/README.md`「セキュリティ」参照）。
- **参加者はログイン不要**（組織コード付きURLで参加）。同一組織内では会社名を知れば他社の状態を取得・上書きできる設計トレードオフを受容している。
  対面研修・信頼できる教室内ネットワーク前提。組織コードは管理画面の「ランダム生成」で高エントロピーなものを発行すること。

### フロント（`app/src/`）

`App.tsx` が `location.pathname` を見て画面を出し分ける（React Router は使っていない）。

| パス | 画面 |
|---|---|
| `/admin` | サイドメニュー（研修一覧／ルール一覧）＋ 研修一覧（`Admin.tsx` ＋ `SessionList.tsx`） |
| `/admin/session?org=<コード>` | 研修1件の管理画面。研修一覧から**別タブ**で開く（`AdminSession.tsx`） |
| それ以外 | 参加者（`Participant.tsx`） |

講師ログインは `adminAuth.tsx` に集約（`useAdminToken()` / `<AdminLogin>`）。トークンは sessionStorage。

**研修（組織）**：`orgs.code` が研修URLの元になる一意なコード（主キー）で、`orgs.name` が研修名。**研修名は重複可、コードは一意**。
コードを変更すると `orgs` と `companies` を同一トランザクションで移すため参加者データは失われないが、配布済みURLは無効になる。

- `state/useGame.ts` … 参加者の状態を保持し、記帳・決算のたびに DB へ同期。リロード・別端末でも「組織コード＋会社名」で復元。
- `lib/game.ts` … calc エンジンと API/UI の橋渡し（状態⇄API変換・記帳バリデーション・イベント）。
- `lib/api.ts` … REST クライアント。`ui/actions.ts` … 記帳モーダルのフォーム定義。

## ドキュメント

実装前に読む。仕様はコードではなくこちらが正。

| ファイル | 内容 |
|---|---|
| `docs/仕様書.md` | 仕様の唯一の情報源（研修ゲームの内容・確定事項） |
| `docs/calc-spec.md` | 計算ロジック仕様（TS移植の基準） |
| `app/README.md` | アプリの構成・API 一覧・セキュリティの現状と受容したトレードオフ |
| `DEPLOY.md` | 本番デプロイ手順（Render / Docker / VPS） |

`docs/` には他に元様式の PDF・`会社盤.png`・`eventcard/`（イベントカード16枚）がある。

## デプロイ

Render Blueprint（`render.yaml`・`rootDir: app`・ヘルスチェック `/api/health`）。

**自動デプロイは無効（`autoDeploy: false`）。main にマージしても本番は変わらない。**
反映するときは Render → `mg-system` → **Manual Deploy → Deploy latest commit**。研修の直前・最中は避ける。

- `plan: starter` を **free に戻さない**。無料プランは15分アイドルでスリープし、研修開始時に最初の参加者が数十秒待たされる。
- Render のファイルシステムは揮発性なので、本番は必ず `DATABASE_URL`（PostgreSQL）を設定する。SQLite だとデプロイのたびにデータが消える。
  接続先は Render Postgres の **Internal Database URL**（`dpg-xxxx-a` のような内部ホスト名）。
  `pgSsl()` は内部ホスト名では TLS を使わない（外部を経由せず、公的CAでは検証できないため）。判定は `npm run test:pgssl` で検証している。
- `render.yaml` に `databases:` を書かない（既存DBとは別に新規作成されてしまう）。DBはダッシュボードで作り、URLだけ環境変数で渡す。
