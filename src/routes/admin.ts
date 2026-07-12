import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import { ok, fail } from '../utils/response';
import { loadConfig } from '../config';
import { requireAdmin } from '../utils/auth';
import { validateSeatId } from '../utils/validate';
import {
  initializeSeats,
  getSeat,
  seatForPublic,
} from '../services/seats';
import {
  adminForceCancel,
  resetAllSeats,
  setSeatStatus,
} from '../services/reservations';

export const adminRoutes = new Hono<HonoEnv>();

// 全ルートで Bearer 認証 (1 か所に集約)
adminRoutes.use('*', async (c, next) => {
  const unauth = requireAdmin(c);
  if (unauth) return unauth;
  await next();
});

/** POST /api/admin/initialize: 席の初期化 */
adminRoutes.post('/initialize', async (c) => {
  const config = loadConfig(c.env);
  const result = await initializeSeats(c.env, config);
  return ok(c, {
    inserted: result.inserted,
    total: result.total,
  });
});

/** POST /api/admin/reset: 全席リセット */
adminRoutes.post('/reset', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 'INVALID_REQUEST', 'Request body must be JSON.', 400);
  }
  if (typeof body !== 'object' || body === null) {
    return fail(c, 'INVALID_REQUEST', 'Request body must be a JSON object.', 400);
  }
  const { confirm } = body as { confirm?: unknown };
  if (confirm !== 'RESET_ALL_SEATS') {
    return fail(
      c,
      'INVALID_REQUEST',
      'Missing or invalid confirm value. Expected "RESET_ALL_SEATS".',
      400,
    );
  }

  await resetAllSeats(c.env);
  const resetAt = new Date().toISOString();
  return ok(c, { resetAt });
});

/** DELETE /api/admin/seats/:seatId/reservation: 特定席の強制解除 */
adminRoutes.delete('/seats/:seatId/reservation', async (c) => {
  const config = loadConfig(c.env);
  const seatId = c.req.param('seatId');
  if (!validateSeatId(seatId, config.rowLabels, config.seatsPerRow)) {
    return fail(c, 'INVALID_SEAT_ID', 'Invalid seat id.', 400);
  }
  const result = await adminForceCancel(c.env, seatId);
  if (!result.ok) {
    return fail(c, result.code, result.message, 404);
  }
  return ok(c, { seat: seatForPublic(result.seat, config.exposeParticipantId) });
});

/** PATCH /api/admin/seats/:seatId: 席の使用禁止/復帰 */
adminRoutes.patch('/seats/:seatId', async (c) => {
  const config = loadConfig(c.env);
  const seatId = c.req.param('seatId');
  if (!validateSeatId(seatId, config.rowLabels, config.seatsPerRow)) {
    return fail(c, 'INVALID_SEAT_ID', 'Invalid seat id.', 400);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 'INVALID_REQUEST', 'Request body must be JSON.', 400);
  }
  if (typeof body !== 'object' || body === null) {
    return fail(c, 'INVALID_REQUEST', 'Request body must be a JSON object.', 400);
  }
  const { status } = body as { status?: unknown };
  if (status !== 'disabled' && status !== 'available') {
    return fail(
      c,
      'INVALID_REQUEST',
      'status must be "disabled" or "available".',
      400,
    );
  }
  const seatBefore = await getSeat(c.env, seatId);
  if (!seatBefore) {
    return fail(c, 'SEAT_NOT_FOUND', `Seat ${seatId} does not exist.`, 404);
  }
  const result = await setSeatStatus(c.env, seatId, status);
  if (!result.ok) {
    return fail(c, result.code, result.message, 400);
  }
  return ok(c, { seat: seatForPublic(result.seat, config.exposeParticipantId) });
});
