import type {
  AppBindings,
  Seat,
  SeatRow,
  ReservationSource,
} from '../types';
import type { AppConfig } from '../config';
import { buildSeatLayout } from '../utils/layout';

/** D1 の行をアプリ用に整形する。 */
export function rowToSeat(row: SeatRow): Seat {
  return {
    id: row.id,
    row: row.row_label,
    number: row.seat_number,
    status: row.status,
    reservedBy: row.reserved_by,
    reservedAt: row.reserved_at,
    reservationSource: (row.reservation_source as ReservationSource | null) ?? null,
    updatedAt: row.updated_at,
  };
}

export async function listSeats(env: AppBindings): Promise<Seat[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, row_label, seat_number, status, reserved_by, reserved_at, reservation_source, updated_at
     FROM seats
     ORDER BY row_label ASC, seat_number ASC`,
  ).all<SeatRow>();
  return (results ?? []).map(rowToSeat);
}

export async function getSeat(env: AppBindings, seatId: string): Promise<Seat | null> {
  const row = await env.DB.prepare(
    `SELECT id, row_label, seat_number, status, reserved_by, reserved_at, reservation_source, updated_at
     FROM seats WHERE id = ?`,
  )
    .bind(seatId)
    .first<SeatRow>();
  return row ? rowToSeat(row) : null;
}

export async function findReservationByParticipant(
  env: AppBindings,
  participantId: string,
): Promise<Seat | null> {
  const row = await env.DB.prepare(
    `SELECT id, row_label, seat_number, status, reserved_by, reserved_at, reservation_source, updated_at
     FROM seats WHERE reserved_by = ? COLLATE NOCASE`,
  )
    .bind(participantId)
    .first<SeatRow>();
  return row ? rowToSeat(row) : null;
}

/**
 * 席テーブルを初期化する。
 * config に沿って全席を INSERT する。既存席は変更しない (INSERT OR IGNORE)。
 */
export async function initializeSeats(
  env: AppBindings,
  config: AppConfig,
): Promise<{ inserted: number; total: number }> {
  const layout = buildSeatLayout(config);
  const now = new Date().toISOString();
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO seats
       (id, row_label, seat_number, status, updated_at)
     VALUES (?, ?, ?, 'available', ?)`,
  );

  const batch = layout.map((slot) =>
    stmt.bind(slot.id, slot.row, slot.number, now),
  );
  const results = await env.DB.batch(batch);

  let inserted = 0;
  for (const r of results) {
    inserted += r.meta?.changes ?? 0;
  }
  return { inserted, total: layout.length };
}

export interface SeatSummary {
  total: number;
  available: number;
  reserved: number;
  disabled: number;
}

export function summarizeSeats(seats: Seat[]): SeatSummary {
  const summary: SeatSummary = {
    total: seats.length,
    available: 0,
    reserved: 0,
    disabled: 0,
  };
  for (const s of seats) {
    if (s.status === 'available') summary.available++;
    else if (s.status === 'reserved') summary.reserved++;
    else if (s.status === 'disabled') summary.disabled++;
  }
  return summary;
}

/** 予約者 ID を外部に見せて良いかで payload を整形する。 */
export function seatForPublic(seat: Seat, exposeParticipantId: boolean): Seat {
  if (exposeParticipantId) return seat;
  return { ...seat, reservedBy: null };
}
