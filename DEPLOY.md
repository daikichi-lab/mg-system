# 本番デプロイ手順（app/）

本アプリは **Nodeサーバ＋SQLiteファイル** で動作します。**Nodeが動き、永続ディスクを持つホスト**が必要です
（Netlify/Vercel/GitHub Pages などの静的専用ホストは不可 → その場合は Postgres へ移行）。

前提: Node **22.5 以上**（推奨 24）。ビルドで `dist/` を生成し、`npm start`（=`node server/index.js`）が `dist` と API を配信します。

## 環境変数
| 変数 | 用途 | 例 |
|---|---|---|
| `PORT` | 待受ポート（多くのホストが自動設定） | `3001` |
| `MG_DB` | SQLite ファイルの**永続パス** | `/data/mg.db` |
| `MG_ADMIN_PW` | 講師ログインのパスワード（**必ず強力な値に**） | （秘密） |

---

## 方法A：Render（最短・推奨）
1. GitHub の `daikichi-lab/mg-system` を Render に接続 → **Blueprint** で `render.yaml` が読み込まれる。
2. デプロイ設定を確認（`rootDir: app` / build `npm ci && npm run build` / start `npm start` / 永続ディスク `/data` / healthcheck `/api/health`）。
3. **環境変数 `MG_ADMIN_PW`** をダッシュボードで強力なパスワードに設定（`sync:false` のため必須）。
4. デプロイ → `https://<app>.onrender.com/api/health` が `{"ok":true}` を返せば成功。
   - 参加者: `https://<app>.onrender.com/` ／ 講師: `.../admin`
5. ※永続ディスクは Render の有料プラン（starter 以上）が必要。無料枠だと再起動でDBが消えるため、無料で試すだけなら Postgres 移行を検討。

## 方法B：Docker（任意のホスト/VPS/Cloud Run※）
```bash
cd app
docker build -t mg-system .
docker run -d --name mg -p 3001:3001 \
  -e MG_ADMIN_PW='＜強力なパスワード＞' \
  -v mg-data:/data \
  mg-system
# 確認
curl -s http://localhost:3001/api/health
```
- DBはボリューム `mg-data`（コンテナ内 `/data`）に永続。バックアップはこのボリュームを対象に。
- ※Cloud Run 等の**ファイルシステムが揮発する環境では SQLite は不可** → Postgres 移行が必要。

## 方法C：VPS（Node直起動＋nginx＋TLS）
```bash
# サーバ上（Node 22.5+ 済み前提）
git clone https://github.com/daikichi-lab/mg-system && cd mg-system/app
npm ci && npm run build
sudo mkdir -p /var/lib/mg
MG_DB=/var/lib/mg/mg.db MG_ADMIN_PW='＜強力なPW＞' PORT=3001 node server/index.js
```
systemd 例（`/etc/systemd/system/mg.service`）:
```ini
[Service]
WorkingDirectory=/opt/mg-system/app
Environment=PORT=3001
Environment=MG_DB=/var/lib/mg/mg.db
Environment=MG_ADMIN_PW=＜強力なPW＞
ExecStart=/usr/bin/node server/index.js
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
```
nginx でリバースプロキシ＋Let's Encrypt で HTTPS 終端（`proxy_pass http://127.0.0.1:3001;`）。
アプリは `trust proxy` 済みなのでレート制限のIP判定も正しく動作。

---

## デプロイ後チェックリスト
- [ ] `MG_ADMIN_PW` をデモ `mg` から**強力な値に変更**した
- [ ] **HTTPS** で配信されている
- [ ] `/api/health` が 200 `{"ok":true}`
- [ ] `/admin` にログイン → **「ランダム生成」で組織コードを発行**し、参加URLを配布（短いコードは使わない）
- [ ] 参加者URLで1周（会社作成→記帳→決算→次期）動作確認
- [ ] DB（`MG_DB` / ボリューム）の**バックアップ方針**を決めた
- [ ] 研修後のデータ削除運用（管理画面のリセット/組織消去）を把握

## スケール/堅牢化が必要になったら
- **複数インスタンス・多人数** → SQLite は単一ノード向けのため **Postgres へ移行**（`app/server/db.js` のクエリ層差し替え）。
- **公開範囲を広げる** → 講師の実認証（パスワードハッシュ／Supabase Auth＋トークン期限）、必要なら参加者PIN、CSP。
（いずれも実装で対応可能です。）
