# Backend (Cloudflare Workers + Hono + D1)

イベント席予約 API 本体。

- Cloudflare Workers 上で動作
- ルーティングは Hono
- 状態管理は Cloudflare D1 (SQLite)
- リアルタイム更新は SSE + Durable Object

## 開発コマンド

```bash
bun install
bun run dev            # wrangler dev (Miniflare)
bun run typecheck      # tsc --noEmit
bun run test           # vitest run
bun run test:watch     # vitest --watch
bun run deploy         # wrangler deploy --minify
```

## 初回セットアップ

### 1. Cloudflare D1 を作成

```bash
bunx wrangler d1 create seat-reservation
```

出力される `database_id` を `wrangler.jsonc` の `d1_databases[0].database_id` に貼り付けます。

### 2. マイグレーションを流す

ローカル (Miniflare):

```bash
bun run d1:apply:local
```

本番 (Cloudflare):

```bash
bun run d1:apply:remote
```

### 3. Secret を登録 (本番のみ)

```bash
bunx wrangler secret put ADMIN_TOKEN
```

### 4. 席を初期化

```bash
# ローカル
curl -X POST http://localhost:8787/api/admin/initialize \
  -H "Authorization: Bearer dev-admin-token"

# 本番
curl -X POST https://<your-worker>.workers.dev/api/admin/initialize \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

これで 100 席 (10 行 × 10 席) が `available` として登録されます。

## 環境変数

`wrangler.jsonc` の `vars` セクションで設定します。

| 変数名 | デフォルト | 説明 |
| --- | --- | --- |
| `EVENT_NAME` | `WebMCP × Antigravity Hands-on` | 画面に表示するイベント名 |
| `ROW_LABELS` | `A,B,C,D,E,F,G,H,I,J` | 席の行ラベル (カンマ区切り) |
| `SEATS_PER_ROW` | `10` | 各行の席数 |
| `ALLOW_MULTIPLE_SEATS` | `false` | `true` にすると 1 参加者が複数席を予約可能 |
| `EXPOSE_PARTICIPANT_ID` | `false` | `true` にすると API レスポンス/SSE に予約者IDが含まれる |
| `ALLOWED_ORIGINS` | (ローカル用) | 許可 Origin をカンマ区切りで指定 |
| `ALLOW_NULL_ORIGIN` | `true` | `Origin: null` (ローカルファイル) を許可するか |
| `ADMIN_TOKEN` | `dev-admin-token` | 管理系 API の Bearer トークン。本番は Secret で上書き |

席数を変えたいときは `ROW_LABELS` と `SEATS_PER_ROW` を書き換えた上で `POST /api/admin/initialize` を再度実行してください (既存席は削除されません)。

## テスト

`test/api.test.ts` は Cloudflare Workers 実行環境 (Miniflare 経由) で API をエンドツーエンドで検証します。カバー範囲:

- ヘルスチェック
- 席一覧取得と summary
- 空席予約
- 予約済み席の拒否
- 使用禁止席の拒否
- 一人一席制約
- 参加者ID未指定 / 不正なseatId のリジェクト
- 20 並列で同一席を取り合い → 1 リクエストだけ成功
- 自分の予約解除 / 他人の予約解除拒否
- 管理者トークン不備の拒否
- リセット時に disabled 席が維持されること
- 管理者による強制解除

```bash
bun run test
```

## ディレクトリ構成

```
backend/
├── src/
│   ├── index.ts              # Hono ルート集約 + CORS + DO エクスポート
│   ├── config.ts             # 環境変数からアプリ設定を組み立てる
│   ├── types/index.ts        # Seat / Env / ReservationSource など
│   ├── utils/
│   │   ├── response.ts       # ok / fail / SSE 整形
│   │   ├── auth.ts           # requireAdmin (Bearer 認証)
│   │   ├── validate.ts       # 参加者ID / 席ID / source の検証
│   │   └── layout.ts         # 席レイアウト生成
│   ├── services/
│   │   ├── seats.ts          # D1 の席取得
│   │   ├── reservations.ts   # 原子的な予約更新
│   │   └── events.ts         # SSE broadcast (DO 経由)
│   ├── routes/
│   │   ├── health.ts
│   │   ├── seats.ts
│   │   ├── reservations.ts
│   │   ├── admin.ts
│   │   └── events.ts
│   └── durable/
│       └── EventHub.ts       # SSE ファンアウト用 Durable Object
├── migrations/
│   └── 0001_init.sql
├── test/
│   ├── api.test.ts
│   └── env.d.ts
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## トラブルシューティング

- **`bun run dev` で `d1_databases` エラー**: `wrangler.jsonc` の `database_id` が空のままです。`bunx wrangler d1 create seat-reservation` の出力を貼り付けてください。
- **本番で 401 が返る**: `ADMIN_TOKEN` が Secret として登録されていないか、送っているトークンが違います。
- **CORS エラー**: `ALLOWED_ORIGINS` にフロントの Origin を追加して再デプロイ。
- **SSE がつながらない**: 途中に SSE をブロックするプロキシがないか、`/api/events` へのリクエストが 200 で応答しているかを DevTools で確認。
