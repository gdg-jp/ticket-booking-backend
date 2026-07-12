import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';

export type SeatStatus = 'available' | 'reserved' | 'disabled';

export type ReservationSource =
  | 'web'
  | 'webmcp'
  | 'antigravity'
  | 'admin'
  | 'unknown';

/** ユーザー向けに整形した席オブジェクト。 */
export interface Seat {
  id: string;
  row: string;
  number: number;
  status: SeatStatus;
  reservedBy: string | null;
  reservedAt: string | null;
  reservationSource: ReservationSource | null;
  updatedAt: string;
}

/** D1 のカラム表現。 */
export interface SeatRow {
  id: string;
  row_label: string;
  seat_number: number;
  status: SeatStatus;
  reserved_by: string | null;
  reserved_at: string | null;
  reservation_source: string | null;
  updated_at: string;
}

export interface ReservationEventRow {
  id: number;
  event_type: string;
  seat_id: string;
  participant_id: string | null;
  source: string | null;
  created_at: string;
}

export interface AppBindings {
  DB: D1Database;
  EVENT_HUB: DurableObjectNamespace;

  EVENT_NAME: string;
  ROW_LABELS: string;
  SEATS_PER_ROW: string;
  ALLOW_MULTIPLE_SEATS: string;
  EXPOSE_PARTICIPANT_ID: string;
  ALLOWED_ORIGINS: string;
  ALLOW_NULL_ORIGIN: string;
  ADMIN_TOKEN: string;
}

export interface AppVariables {
  participantId: string | null;
}

export type HonoEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};

/** SSE で流すイベントの共通型。 */
export type BroadcastEvent =
  | {
      type: 'seat.updated';
      data: {
        seatId: string;
        status: SeatStatus;
        reservedBy?: string | null;
        source: ReservationSource | null;
        updatedAt: string;
      };
    }
  | {
      type: 'reservation.created';
      data: {
        seatId: string;
        participantId?: string;
        source: ReservationSource;
        reservedAt: string;
      };
    }
  | {
      type: 'reservation.deleted';
      data: {
        seatId: string;
        participantId?: string;
        source: ReservationSource;
      };
    }
  | {
      type: 'seats.reset';
      data: { resetAt: string };
    };
