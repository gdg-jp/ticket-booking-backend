import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import { ok } from '../utils/response';

export const healthRoutes = new Hono<HonoEnv>();

healthRoutes.get('/', (c) => ok(c, { status: 'ok' }));
