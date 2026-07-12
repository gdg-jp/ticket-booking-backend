import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HonoEnv } from './types';
import { loadConfig } from './config';
import { fail } from './utils/response';
import { healthRoutes } from './routes/health';
import { seatRoutes } from './routes/seats';
import { reservationRoutes } from './routes/reservations';
import { adminRoutes } from './routes/admin';
import { eventRoutes } from './routes/events';

export { EventHub } from './durable/EventHub';

const app = new Hono<HonoEnv>();

// CORS: 環境変数から許可 Origin を組み立てる。null Origin も別途許可可能。
app.use('/api/*', async (c, next) => {
  const config = loadConfig(c.env);
  const middleware = cors({
    origin: (origin) => {
      if (!origin) {
        // fetch から Origin ヘッダーがない場合 (curl 等) は許可
        return '*';
      }
      if (origin === 'null') {
        return config.allowNullOrigin ? 'null' : '';
      }
      if (config.allowedOrigins.includes(origin)) return origin;
      // 開発時 allowedOrigins が空なら fetch を止めない
      if (config.allowedOrigins.length === 0) return origin;
      return '';
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Participant-ID'],
    maxAge: 86400,
    credentials: false,
  });
  return middleware(c, next);
});

// ルート集約
const api = new Hono<HonoEnv>()
  .route('/health', healthRoutes)
  .route('/seats', seatRoutes)
  .route('/reservations', reservationRoutes)
  .route('/events', eventRoutes)
  .route('/admin', adminRoutes);

app.route('/api', api);

// 404 と 500 の共通ハンドラー
app.notFound((c) => fail(c, 'NOT_FOUND', 'Endpoint not found.', 404));

app.onError((err, c) => {
  console.error('Unhandled error', err);
  return fail(c, 'INTERNAL_ERROR', 'Something went wrong.', 500);
});

export default app;
