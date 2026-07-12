import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import { forwardSubscribe } from '../services/events';

export const eventRoutes = new Hono<HonoEnv>();

/** GET /api/events: SSE 購読 (Durable Object にそのまま委譲) */
eventRoutes.get('/', async (c) => {
  return forwardSubscribe(c.env, c.req.raw);
});
