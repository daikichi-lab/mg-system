# 戦略MG 研修システム（本番実装）

`mock/` のプロトタイプを本番構成で実装したフルスタックアプリ。

- **フロント**: React 19 + Vite + TypeScript + Tailwind v4
- **バックエンド**: Node(Express) + **node:sqlite（実SQLite・ファイル永続）** の REST API
- **計算エンジン**: `src/lib/calc.ts`（純関数）。mock と**数値が厳密一致**（golden-master 検証済み）
- **参加者はログイン不要**（組織コード付きURLで参加）／**講師のみログイン**（デモPW `mg`）
- 状態はサーバ（DB）保存 → **リロード・再訪でも復元**。表示値はすべて DB 由来。

## セットアップ
```bash
npm install
# Playwright のブラウザ（E2E 用。キャッシュ済みなら不要）
PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright npx playwright install chromium
```

## 起動
### 開発モード（HMR）
```bash
npm run dev
```
- 参加者: http://localhost:5173/
- 管理者: http://localhost:5173/admin
- `/api/*` は Vite が API サーバ(:3001)へプロキシ。

### 本番モード（ビルド＋単一ポート配信）
```bash
npm run build   # tsc（strict）＋ vite build → dist/
npm start       # Express が dist と API を :3001 で配信
```
- 参加者: http://localhost:3001/ ／ 管理者: http://localhost:3001/admin
- 環境変数: `PORT`（既定3001）, `MG_DB`（SQLite ファイルパス）, `MG_ADMIN_PW`（既定 `mg`）

## テスト
```bash
npm run test:calc   # 計算エンジンの golden-master（実mockと数値一致）7シナリオ
npm run test:e2e    # Playwright E2E（実DBでlocalhost起動→全ボタン/全処理を検証）
```
E2E は `node server/index.js` を自動起動し、実ブラウザで
「会社作成→全ルールA/B・全16イベント→期末処理→決算(貸借一致)→次期→履歴/組織→リロード復元」
「管理者ログイン→成績一覧(DB値)→CSV→リセット」を検証（3スペック・全パス）。

## セキュリティ
**対策済み**
- **SQLインジェクション**: 全クエリが prepared statement＋バインド変数（`?`）。SQLへの文字列連結は皆無（静的SQLのみ）。
- **XSS**: React の自動エスケープのみ。`dangerouslySetInnerHTML`／`innerHTML` 不使用。
- **情報漏洩**: 500 応答は汎用メッセージのみ（詳細はサーバログ）。`x-powered-by` 無効、`X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy` 設定。CORS 未許可＝同一オリジンのみ。組織比較 API は各期の集計値のみ返す（記帳明細は返さない）。
- **管理者認証**: トークンは `crypto.randomBytes`（256bit）。ログインは IP 単位でレート制限（15分10回）。状態保存は件数・サイズ上限あり。

**受容している設計トレードオフ（要注意）**
- 参加者は**ログイン不要**（`会社名のみ`＝§8.6 のユーザ決定・対面研修前提）。このため**同一組織内では会社名を知れば他社の状態を取得/上書きできる**（参加者間の分離なし）。
  - 信頼できる教室内ネットワークでの利用を想定。
  - **部外者による組織URLの推測**は、管理画面の「ランダム生成」で**高エントロピーな組織コード**（`MG-` ＋ 12桁・約60bit）を発行することで防げる（capability URL）。短い組織コードは避ける。
  - **公開インターネットに晒す場合**は、参加者PIN または講師発行の会社トークンによる保護を追加すること（§8.6 で見送った選択肢）。
- 講師ログインは現状デモPW（`mg`）＋インメモリトークン（無期限）。**本番運用では**実認証（パスワードハッシュ／Supabase Auth 等）＋トークン期限＋HTTPS(リバースプロキシ)＋CSP を追加推奨。

## 構成
```
server/
  db.js       … node:sqlite スキーマ＋クエリ（companies / entries / period_results）
  index.js    … Express API ＋ dist 配信
src/
  lib/calc.ts … 計算エンジン（ACTIONS/recompute/settle/nextPeriod/派生値）
  lib/game.ts … 状態⇄API変換・記帳バリデーション・イベント
  lib/api.ts  … REST クライアント
  state/useGame.ts … 参加者の状態管理＋DB同期＋リロード復元
  ui/Participant.tsx … 参加者UI（会社情報/期首/記帳/期末/決算書/履歴/組織＋記帳モーダル）
  ui/Admin.tsx … 管理者UI（ログイン/成績一覧/CSV/リセット）
test/
  calc.test.ts / scenarios.mjs / gen-golden.mjs / golden.json … 数値一致検証
e2e/
  app.spec.ts / global-setup.ts … E2E
```

## API（要点）
| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/company/join` | 参加（org+会社名で作成/取得） |
| GET | `/api/company?org=&name=` | 状態取得（リロード復元） |
| PUT | `/api/company/:id/state` | 状態保存（記帳/決算のたび） |
| GET | `/api/org/:code` | 組織比較（参加者/管理者） |
| POST | `/api/admin/login` | 講師ログイン→トークン |
| GET | `/api/admin/orgs` | 組織一覧（要認証） |
| DELETE | `/api/admin/company/:id` / `/api/admin/org/:code` | リセット/全消去（要認証） |
