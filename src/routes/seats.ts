import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import { ok, fail } from '../utils/response';
import { loadConfig } from '../config';
import {
  listSeats,
  getSeat,
  summarizeSeats,
  seatForPublic,
} from '../services/seats';
import { validateSeatId } from '../utils/validate';

export const seatRoutes = new Hono<HonoEnv>();

/** GET /api/seats: 全席一覧 + summary + updatedAt */
seatRoutes.get('/', async (c) => {
  const config = loadConfig(c.env);
  const seats = await listSeats(c.env);
  const summary = summarizeSeats(seats);

  const latest = seats.reduce((latest, s) => {
    return s.updatedAt > latest ? s.updatedAt : latest;
  }, '1970-01-01T00:00:00.000Z');

  return ok(c, {
    seats: seats.map((s) => seatForPublic(s, config.exposeParticipantId)),
    summary,
    layout: {
      rowLabels: config.rowLabels,
      seatsPerRow: config.seatsPerRow,
    },
    eventName: config.eventName,
    updatedAt: latest,
  });
});

/** GET /api/seats/:seatId: 特定席の情報 */
seatRoutes.get('/:seatId', async (c) => {
  const config = loadConfig(c.env);
  const seatId = c.req.param('seatId');
  if (!validateSeatId(seatId, config.rowLabels, config.seatsPerRow)) {
    return fail(c, 'INVALID_SEAT_ID', 'Invalid seat id.', 400);
  }
  const seat = await getSeat(c.env, seatId);
  if (!seat) {
    return fail(c, 'SEAT_NOT_FOUND', `Seat ${seatId} does not exist.`, 404);
  }
  return ok(c, { seat: seatForPublic(seat, config.exposeParticipantId) });
});
