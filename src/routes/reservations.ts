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

export const reservationRoutes = new Hono<HonoEnv>();

/** X-Participant-ID を検証する。 */
function readParticipantId(c: import('hono').Context<HonoEnv>, formValue?: unknown) {
  const id = c.req.header('X-Participant-ID') ?? formValue;
  if (!validateParticipantId(id)) {
    return {
      ok: false as const,
      response: fail(
        c,
        'INVALID_PARTICIPANT_ID',
        'Participant ID is missing or invalid.',
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

  let body: Record<string, unknown>;
  try {
    if (c.req.header('Content-Type')?.includes('application/json')) {
      body = await c.req.json<Record<string, unknown>>();
    } else {
      const form = await c.req.formData();
      body = Object.fromEntries(form.entries());
    }
  } catch {
    return fail(c, 'INVALID_REQUEST', 'Request body must be JSON or form data.', 400);
  }
  if (typeof body !== 'object' || body === null) {
    return fail(c, 'INVALID_REQUEST', 'Request body must be an object.', 400);
  }
  const parsed = readParticipantId(c, body.participantId);
  if (!parsed.ok) return parsed.response;

  const { seatId, source } = body;
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
