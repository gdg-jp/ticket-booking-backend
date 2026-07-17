# 席予約 API

WebMCP ハンズオンの席予約画面で使う Cloudflare Workers + Hono + D1 の API です。
予約 API は JSON と標準 HTML フォームの両方を受け付けます。

## 開発

```bash
bun install
bun run d1:apply:local
bun run dev
```

API は `http://localhost:8787` で起動します。

```bash
bun run typecheck
bun run test
```

## 予約 API

JavaScript から呼ぶ場合は、参加者 ID を `X-Participant-ID` ヘッダーで渡します。

```bash
curl -X POST http://localhost:8787/api/reservations \
  -H 'Content-Type: application/json' \
  -H 'X-Participant-ID: team-01' \
  -d '{"seatId":"A-1","source":"web"}'
```

HTML フォームから呼ぶ場合は、参加者 ID をフォームフィールドで渡せます。

```html
<form action="http://localhost:8787/api/reservations" method="post">
  <input name="participantId" required>
  <input name="seatId" required>
  <input type="hidden" name="source" value="webmcp">
  <button type="submit">予約する</button>
</form>
```

その他の主なエンドポイント:

- `GET /api/seats`: 席一覧とサマリー
- `GET /api/reservations/me`: 自分の予約
- `DELETE /api/reservations/me`: 自分の予約解除
- `/api/admin/*`: 席の初期化や管理操作

## 初回セットアップ

```bash
npx -y wrangler d1 create webmcp
npx -y wrangler d1 migrations apply webmcp --remote
npx -y wrangler secret put ADMIN_TOKEN
```

作成した D1 の `database_id` を `wrangler.jsonc` に設定してください。
マイグレーションを適用すると、A-J 行 × 1-10 番の 100 席も自動的に登録されます。

## デプロイ

`api.webmcp.gdgs.jp` へデプロイします。

```bash
npx -y wrangler deploy --minify
```

GitHub Actions からデプロイする場合は、リポジトリの Actions secrets に
`CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録してください。

## 構成

```text
src/
├── index.ts
├── config.ts
├── routes/
│   ├── seats.ts
│   ├── reservations.ts
│   └── admin.ts
├── services/
│   ├── seats.ts
│   └── reservations.ts
└── utils/
    ├── auth.ts
    ├── response.ts
    └── validate.ts
```

D1 の条件付き更新と一意インデックスにより、同じ席の同時予約と一人による複数席の
予約を防ぎます。画面は変更後に一覧を再取得するため、SSE や Durable Objects は使用しません。
