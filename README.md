# mg-system — 戦略MG研修 Web入力・自動計算システム

戦略MG研修（製造業版入門編・ケーキ店経営）の紙様式を、Web入力＋自動計算・自動決算に置き換えるシステム。
本番実装は `app/`（React + Express + 実DB）。単一HTMLのプロトタイプ `mock/` は 2026-09 に削除し、`app/` に一本化した。

## リポジトリ構成
```
app/           … 本番実装（React+Vite+TS+Tailwind ＋ Express＋node:sqlite／PostgreSQL）
  → 起動・テストは app/README.md
docs/
  仕様書.md     … 仕様の唯一の情報源（詳細はこちら）
  calc-spec.md … 計算ロジック仕様（calc.ts の基準）
  eventcard/   … イベントカード16枚（画像）
  *.pdf, 会社盤.png … 元様式（ルール表／経営計画書／入門編MG決算書）
CLAUDE.md      … 開発ルール（issue → main からブランチ → 実装 → PR → 人間が確認・マージ・デプロイ）
DEPLOY.md      … 本番デプロイ手順（Render / Docker / VPS）
```

## 起動
```bash
cd app && npm install
npm run build && npm start        # http://localhost:3001/（参加者） /admin（講師・PW mg）
# 開発: npm run dev  ／ 検証: npm run test:calc, npm run test:e2e
```
計算は `app/src/lib/calc.ts` の純関数に集約し、`app/test/golden.json`（期待値スナップショット）との
**golden-master で数値一致を検証**。Playwright E2E で全ボタン／全処理を検証。
状態はDB保存で**リロード／再訪・別端末でも「組織コード＋会社名」で復元**、表示値はすべてDB由来。
詳細は **[app/README.md](app/README.md)**、本番デプロイ手順は **[DEPLOY.md](DEPLOY.md)**。

参加フロー: 会社情報で **会社名・社長名** を入力（組織コードは研修URLに含まれる）→ 開始 → 記帳 → 期末処理 → 決算 → 次の期へ。
同じ研修の会社は「組織」タブで比較でき、講師は管理画面で各社の状況・成績を確認できます。

## 主な機能
- ゲーム型フロー（会社情報／期首処理／記帳／期末処理／決算書／履歴／振り返り／組織）
- tx再生エンジン＋自動決算（**B/S一致**・棚卸差異0・四捨五入）、期またぎ引き継ぎ、増資・借入・金利・返済
- 記帳（ルールA/B・イベント16種・複数行・行編集・上限バリデーション・退職の期末半額給料）
- 決算書（STRAC⇄P/Lウォーターフォール・B/S図＋数値・CF・**A3 PDF出力**）
- 組織比較（チャート／項目別順位）・振り返り
- 講師管理画面（ログイン・研修（組織）の作成／URL発行・数値ルールのマスタ・閲覧・**成績一覧＋CSV**・リセット）

## 見送り中（任意・未要望）
MQ会計表／経営分析指標（自己資本比率・ROA 等）／5期通算サマリー・表彰／現金ショート・倒産処理。

→ 仕様・確定事項は **[docs/仕様書.md](docs/仕様書.md)** を参照。
