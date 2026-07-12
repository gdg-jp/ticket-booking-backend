import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import { ok, fail } from '../utils/response';
import { loadConfig } from '../config';
import { validateParticipantId, validateSeatId, normalizeSource } from '../utils/validate';
import { findReservationByParticipant, seatForPublic } from '../services/seats';
import {
  reserveSeat,
  cancelOwnReservation,
} from '../services/reservations';
import { broadcast, rateCheck } from '../services/events';

export const reservationRoutes = new Hono<HonoEnv>();

/** X-Participant-ID を検証してヘルパーに変換する。 */
function readParticipantId(c: import('hono').Context<HonoEnv>) {
  const id = c.req.header('X-Participant-ID');
  if (!validateParticipantId(id)) {
    return {
      ok: false as const,
      response: fail(
        c,
        'INVALID_PARTICIPANT_ID',
        'X-Participant-ID header is missing or invalid.',
        400,
      ),
    };
  }
  return { ok: true as const, participantId: id };
}

/** GET /api/reservations/me: 自分の予約 */
reservationRoutes.get('/me', async (c) => {
  const config = loadConfig(c.env);
  const parsed = readParticipantId(c);
  if (!parsed.ok) return parsed.response;

  const seat = await findReservationByParticipant(c.env, parsed.participantId);
  if (!seat) {
    return ok(c, { reservation: null });
  }
  return ok(c, {
    reservation: {
      seatId: seat.id,
      participantId: parsed.participantId,
      reservedAt: seat.reservedAt,
      source: seat.reservationSource,
    },
    seat: seatForPublic(seat, config.exposeParticipantId),
  });
});

/** POST /api/reservations: 席予約 */
reservationRoutes.post('/', async (c) => {
  const config = loadConfig(c.env);
  const parsed = readParticipantId(c);
  if (!parsed.ok) return parsed.response;

  // 簡易レート制限
  const allowed = await rateCheck(c.env, `reserve:${parsed.participantId}`, 5_000, 10);
  if (!allowed) {
    return fail(c, 'RATE_LIMITED', 'Too many requests. Please wait a moment.', 429);
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
  const { seatId, source } = body as { seatId?: unknown; source?: unknown };
  if (!validateSeatId(seatId, config.rowLabels, config.seatsPerRow)) {
    return fail(c, 'INVALID_SEAT_ID', 'Invalid seat id.', 400);
  }
  const normalizedSource = normalizeSource(source);

  const result = await reserveSeat(c.env, config, {
    seatId: seatId as string,
    participantId: parsed.participantId,
    source: normalizedSource,
  });

  if (!result.ok) {
    const status = statusForReserveError(result.code);
    return fail(c, result.code, result.message, status);
  }

  // SSE 通知
  c.executionCtx.waitUntil(
    Promise.all([
      broadcast(c.env, config, {
        type: 'seat.updated',
        data: {
          seatId: result.reservation.seatId,
          status: 'reserved',
          reservedBy: parsed.participantId,
          source: normalizedSource,
          updatedAt: result.reservation.reservedAt,
        },
      }),
      broadcast(c.env, config, {
        type: 'reservation.created',
        data: {
          seatId: result.reservation.seatId,
          participantId: parsed.participantId,
          source: normalizedSource,
          reservedAt: result.reservation.reservedAt,
        },
      }),
    ]),
  );

  return ok(c, { reservation: result.reservation }, 201);
});

/** DELETE /api/reservations/me: 自分の予約解除 */
reservationRoutes.delete('/me', async (c) => {
  const config = loadConfig(c.env);
  const parsed = readParticipantId(c);
  if (!parsed.ok) return parsed.response;

  const result = await cancelOwnReservation(c.env, parsed.participantId);
  if (!result.ok) {
    return fail(c, result.code, result.message, 404);
  }

  c.executionCtx.waitUntil(
    Promise.all([
      broadcast(c.env, config, {
        type: 'seat.updated',
        data: {
          seatId: result.seat.id,
          status: 'available',
          reservedBy: null,
          source: null,
          updatedAt: result.seat.updatedAt,
        },
      }),
      broadcast(c.env, config, {
        type: 'reservation.deleted',
        data: {
          seatId: result.seat.id,
          participantId: parsed.participantId,
          source: 'web',
        },
      }),
    ]),
  );

  return ok(c, { seat: seatForPublic(result.seat, config.exposeParticipantId) });
});

function statusForReserveError(code: string): 200 | 400 | 404 | 409 | 500 {
  switch (code) {
    case 'SEAT_NOT_FOUND':
      return 404;
    case 'SEAT_ALREADY_RESERVED':
    case 'SEAT_DISABLED':
    case 'ALREADY_HAS_RESERVATION':
      return 409;
    case 'INTERNAL_ERROR':
      return 500;
    default:
      return 400;
  }
}
