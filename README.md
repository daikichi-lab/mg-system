# mg-system — 戦略MG研修 Web入力・自動計算システム

戦略MG研修（製造業版入門編・ケーキ店経営）の紙様式を、Web入力＋自動計算・自動決算に置き換えるプロジェクト。
**モック（プロトタイプ）に加え、本番実装（`app/`：React + Express + 実DB）まで完成**。

## リポジトリ構成
```
app/           … 本番実装（React+Vite+TS+Tailwind ＋ Express＋node:sqlite 実DB／E2E済）
  → 起動・テストは app/README.md
mock/
  index.html   … 参加者アプリ（単一HTML・ビルド不要／プロトタイプ）
  admin.html   … 管理者ビュー（講師用／プロトタイプ）
docs/
  仕様書.md     … 仕様の唯一の情報源（詳細はこちら）
  calc-spec.md … 計算ロジック仕様（TS移植の基準）
  eventcard/   … イベントカード16枚（画像）
  *.pdf, 会社盤.png … 元様式（ルール表／経営計画書／入門編MG決算書）
```

## 本番アプリ（app/）— 推奨
```bash
cd app && npm install
npm run build && npm start        # http://localhost:3001/（参加者） /admin（講師・PW mg）
# 開発: npm run dev  ／ 検証: npm run test:calc, npm run test:e2e
```
React+Vite+TS+Tailwind ＋ Express＋**node:sqlite（実DB）**。計算は `app/src/lib/calc.ts` に純関数移植し
**実mockと数値一致（golden-master）**・**Playwright E2E で全ボタン/全処理を検証（全パス）**。
状態はDB保存で**リロード/再訪復元**、表示値はすべてDB由来。
詳細は **[app/README.md](app/README.md)**、本番デプロイ手順は **[DEPLOY.md](DEPLOY.md)**（Render / Docker / VPS）。

## 起動方法（モック／プロトタイプ）
ビルド不要。ローカルサーバ経由が確実です。
```bash
python3 -m http.server 8770 --directory mock
```
- 参加者: <http://localhost:8770/index.html>
- 管理者: <http://localhost:8770/admin.html> （デモ用パスワード `mg`）

参加フロー: 会社情報で **会社名・社長名・組織コード** を入力 → 開始 → 記帳 → 期末処理 → 決算 → 次の期へ。
同じ組織コードの会社は「組織」タブで比較でき、講師は管理者ビューで各社の状況・成績を確認できます。

## 主な機能（実装済み）
- ゲーム型フロー（会社情報／期首処理／記帳／期末処理／決算書／履歴／振り返り／組織）
- tx再生エンジン＋自動決算（**B/S一致**・棚卸差異0・四捨五入）、期またぎ引き継ぎ、増資・借入・金利・返済
- 記帳（ルールA/B・イベント16種・複数行・行編集・上限バリデーション・退職の期末半額給料）
- 決算書（STRAC⇄P/Lウォーターフォール・B/S図＋数値・CF・**A3 PDF出力**）
- 組織比較（チャート／項目別順位）・振り返り
- 管理者ビュー（講師ログイン・参加URL発行・閲覧・**成績一覧＋CSV**・リセット/組織消去）
- **リロード自動復元**（同一ブラウザ）

## 見送り中（任意・未要望）
MQ会計表／経営分析指標（自己資本比率・ROA 等）／5期通算サマリー・表彰／現金ショート・倒産処理。

## 本番実装（app/）で解消済み
本番アプリはサーバ（DB）保存のため、**別端末・リロード・ブラウザ削除でも「組織コード＋会社名」で復旧**します。
運用でDBを Postgres/Supabase に置換する場合も `app/server/db.js` のクエリ層差し替えのみで、計算・UI・APIは流用可。
→ 仕様・確定事項は **[docs/仕様書.md](docs/仕様書.md)**（§8 本番アーキテクチャ／§8.6 未決仕様／§9.3 実装状況）を参照。

## 制約（モック／プロトタイプのみ）
`mock/` は同一ブラウザの localStorage のみで共有（別端末不可）。本番アプリ（`app/`）はこの制約なし。
