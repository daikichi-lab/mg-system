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
