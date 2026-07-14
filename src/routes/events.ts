import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import { loadConfig } from '../config';

export const eventRoutes = new Hono<HonoEnv>();

type ReservationEventRow = {
  id: number;
  event_type: string;
  seat_id: string;
  participant_id: string | null;
  source: string | null;
  created_at: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function latestEventId(c: import('hono').Context<HonoEnv>): Promise<number> {
  const row = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(id), 0) AS latest FROM reservation_events`,
  ).first<{ latest: number }>();
  return row?.latest ?? 0;
}

async function nextEvents(
  c: import('hono').Context<HonoEnv>,
  afterId: number,
): Promise<ReservationEventRow[]> {
  const result = await c.env.DB.prepare(
    `SELECT id, event_type, seat_id, participant_id, source, created_at
       FROM reservation_events
      WHERE id > ?
      ORDER BY id ASC
      LIMIT 25`,
  )
    .bind(afterId)
    .all<ReservationEventRow>();
  return result.results ?? [];
}

async function seatUpdatedPayload(
  c: import('hono').Context<HonoEnv>,
  row: ReservationEventRow,
) {
  const config = loadConfig(c.env);
  const status = row.event_type === 'reservation.created' ? 'reserved' : 'available';
  return {
    seatId: row.seat_id,
    status,
    reservedBy:
      status === 'reserved' && config.exposeParticipantId ? row.participant_id : null,
    source: row.source ?? 'unknown',
    reservedAt: status === 'reserved' ? row.created_at : null,
    updatedAt: row.created_at,
  };
}

function reservationPayload(c: import('hono').Context<HonoEnv>, row: ReservationEventRow) {
  const config = loadConfig(c.env);
  return {
    seatId: row.seat_id,
    participantId: config.exposeParticipantId ? row.participant_id : null,
    source: row.source ?? 'unknown',
    reservedAt: row.created_at,
  };
}

eventRoutes.get('/', async (c) => {
  const encoder = new TextEncoder();
  let lastId = await latestEventId(c);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(encodeSse('connection.ready', { ok: true })));

      while (true) {
        try {
          const rows = await nextEvents(c, lastId);
          for (const row of rows) {
            lastId = row.id;
            if (
              row.event_type === 'reservation.created' ||
              row.event_type === 'reservation.deleted'
            ) {
              controller.enqueue(
                encoder.encode(encodeSse('seat.updated', await seatUpdatedPayload(c, row))),
              );
              controller.enqueue(
                encoder.encode(encodeSse(row.event_type, reservationPayload(c, row))),
              );
            } else if (row.event_type === 'seats.reset') {
              controller.enqueue(
                encoder.encode(encodeSse('seats.reset', { resetAt: row.created_at })),
              );
            }
          }

          if (rows.length === 0) {
            controller.enqueue(encoder.encode(encodeSse('heartbeat', { at: new Date().toISOString() })));
          }
          await sleep(3000);
        } catch (err) {
          controller.error(err);
          break;
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
});
