import type { AppBindings, ReservationSource, Seat } from '../types';
import type { AppConfig } from '../config';
import { getSeat, findReservationByParticipant } from './seats';

export type ReserveResult =
  | { ok: true; reservation: { seatId: string; participantId: string; source: ReservationSource; reservedAt: string } }
  | { ok: false; code: ReserveErrorCode; message: string };

export type ReserveErrorCode =
  | 'SEAT_NOT_FOUND'
  | 'SEAT_DISABLED'
  | 'SEAT_ALREADY_RESERVED'
  | 'ALREADY_HAS_RESERVATION'
  | 'INTERNAL_ERROR';

/**
 * 席予約を原子的に行う。
 * D1 の条件付き UPDATE で「席が available」+「その参加者が別席を持っていない」を同時にチェックする。
 * UNIQUE INDEX (reserved_by) により、DB レベルでの二重予約も拒否される。
 */
export async function reserveSeat(
  env: AppBindings,
  config: AppConfig,
  params: {
    seatId: string;
    participantId: string;
    source: ReservationSource;
  },
): Promise<ReserveResult> {
  const now = new Date().toISOString();
  const { seatId, participantId, source } = params;

  try {
    let updateResult;
    if (config.allowMultipleSeats) {
      // 1 人 1 席制限を外した SQL
      updateResult = await env.DB.prepare(
        `UPDATE seats
            SET status='reserved',
                reserved_by=?1,
                reserved_at=?2,
                reservation_source=?3,
                updated_at=?2
          WHERE id=?4 AND status='available'`,
      )
        .bind(participantId, now, source, seatId)
        .run();
    } else {
      updateResult = await env.DB.prepare(
        `UPDATE seats
            SET status='reserved',
                reserved_by=?1,
                reserved_at=?2,
                reservation_source=?3,
                updated_at=?2
          WHERE id=?4
            AND status='available'
            AND NOT EXISTS (SELECT 1 FROM seats WHERE reserved_by=?1)`,
      )
        .bind(participantId, now, source, seatId)
        .run();
    }

    if ((updateResult.meta?.changes ?? 0) === 1) {
      // 履歴を記録 (失敗しても本体の応答は返す)
      await env.DB.prepare(
        `INSERT INTO reservation_events (event_type, seat_id, participant_id, source, created_at)
         VALUES ('reservation.created', ?, ?, ?, ?)`,
      )
        .bind(seatId, participantId, source, now)
        .run();
      return {
        ok: true,
        reservation: { seatId, participantId, source, reservedAt: now },
      };
    }

    // UPDATE が 0 行 → 失敗理由を特定するために状態を確認する
    return await diagnoseFailure(env, config, seatId, participantId);
  } catch (err) {
    // 例: UNIQUE constraint failure (同時 2 席取得を DB が拒否したケース) など
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE|constraint/i.test(msg)) {
      return await diagnoseFailure(env, config, seatId, participantId);
    }
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to reserve seat.',
    };
  }
}

async function diagnoseFailure(
  env: AppBindings,
  config: AppConfig,
  seatId: string,
  participantId: string,
): Promise<ReserveResult> {
  const seat = await getSeat(env, seatId);
  if (!seat) {
    return { ok: false, code: 'SEAT_NOT_FOUND', message: `Seat ${seatId} does not exist.` };
  }
  if (seat.status === 'disabled') {
    return { ok: false, code: 'SEAT_DISABLED', message: `Seat ${seatId} is disabled.` };
  }
  if (seat.status === 'reserved') {
    return {
      ok: false,
      code: 'SEAT_ALREADY_RESERVED',
      message: `Seat ${seatId} has already been reserved.`,
    };
  }
  if (!config.allowMultipleSeats) {
    const existing = await findReservationByParticipant(env, participantId);
    if (existing) {
      return {
        ok: false,
        code: 'ALREADY_HAS_RESERVATION',
        message: `Participant already has a reservation for ${existing.id}.`,
      };
    }
  }
  return { ok: false, code: 'INTERNAL_ERROR', message: 'Unknown reservation failure.' };
}

export type CancelResult =
  | { ok: true; seat: Seat }
  | { ok: false; code: 'RESERVATION_NOT_FOUND'; message: string };

/**
 * 自分の予約を解除する (reserved_by が一致する席のみ更新)。
 * 他人の予約は SQL レベルで触れない。
 */
export async function cancelOwnReservation(
  env: AppBindings,
  participantId: string,
): Promise<CancelResult> {
  const now = new Date().toISOString();
  const existing = await findReservationByParticipant(env, participantId);
  if (!existing) {
    return {
      ok: false,
      code: 'RESERVATION_NOT_FOUND',
      message: 'You have no active reservation.',
    };
  }

  const result = await env.DB.prepare(
    `UPDATE seats
        SET status='available',
            reserved_by=NULL,
            reserved_at=NULL,
            reservation_source=NULL,
            updated_at=?1
      WHERE reserved_by=?2`,
  )
    .bind(now, participantId)
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    return {
      ok: false,
      code: 'RESERVATION_NOT_FOUND',
      message: 'Reservation was already released.',
    };
  }

  await env.DB.prepare(
    `INSERT INTO reservation_events (event_type, seat_id, participant_id, source, created_at)
     VALUES ('reservation.deleted', ?, ?, ?, ?)`,
  )
    .bind(existing.id, participantId, existing.reservationSource ?? 'unknown', now)
    .run();

  const updated = await env.DB.prepare(
    `SELECT id, row_label, seat_number, status, reserved_by, reserved_at, reservation_source, updated_at
     FROM seats WHERE id = ?`,
  )
    .bind(existing.id)
    .first();

  return {
    ok: true,
    seat: {
      id: (updated as { id: string }).id,
      row: (updated as { row_label: string }).row_label,
      number: (updated as { seat_number: number }).seat_number,
      status: 'available',
      reservedBy: null,
      reservedAt: null,
      reservationSource: null,
      updatedAt: now,
    },
  };
}

/** 管理系: 特定席の予約を強制解除する。 */
export async function adminForceCancel(
  env: AppBindings,
  seatId: string,
): Promise<{ ok: true; seat: Seat } | { ok: false; code: string; message: string }> {
  const seat = await getSeat(env, seatId);
  if (!seat) {
    return { ok: false, code: 'SEAT_NOT_FOUND', message: `Seat ${seatId} does not exist.` };
  }
  if (seat.status !== 'reserved') {
    return { ok: false, code: 'RESERVATION_NOT_FOUND', message: 'Seat has no active reservation.' };
  }
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE seats
        SET status='available',
            reserved_by=NULL,
            reserved_at=NULL,
            reservation_source=NULL,
            updated_at=?1
      WHERE id=?2`,
  )
    .bind(now, seatId)
    .run();
  await env.DB.prepare(
    `INSERT INTO reservation_events (event_type, seat_id, participant_id, source, created_at)
     VALUES ('reservation.deleted', ?, ?, 'admin', ?)`,
  )
    .bind(seatId, seat.reservedBy, now)
    .run();
  return {
    ok: true,
    seat: {
      ...seat,
      status: 'available',
      reservedBy: null,
      reservedAt: null,
      reservationSource: null,
      updatedAt: now,
    },
  };
}

/** 全席リセット: disabled 席以外を available に戻す。 */
export async function resetAllSeats(env: AppBindings): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE seats
        SET status='available',
            reserved_by=NULL,
            reserved_at=NULL,
            reservation_source=NULL,
            updated_at=?1
      WHERE status != 'disabled'`,
  )
    .bind(now)
    .run();
  await env.DB.prepare(
    `INSERT INTO reservation_events (event_type, seat_id, source, created_at)
     VALUES ('seats.reset', '*', 'admin', ?)`,
  )
    .bind(now)
    .run();
}

/** 席の disabled 切替。予約中の席を disable する場合は先に予約解除する。 */
export async function setSeatStatus(
  env: AppBindings,
  seatId: string,
  status: 'disabled' | 'available',
): Promise<{ ok: true; seat: Seat } | { ok: false; code: string; message: string }> {
  const seat = await getSeat(env, seatId);
  if (!seat) {
    return { ok: false, code: 'SEAT_NOT_FOUND', message: `Seat ${seatId} does not exist.` };
  }
  const now = new Date().toISOString();

  if (status === 'disabled') {
    await env.DB.prepare(
      `UPDATE seats
          SET status='disabled',
              reserved_by=NULL,
              reserved_at=NULL,
              reservation_source=NULL,
              updated_at=?1
        WHERE id=?2`,
    )
      .bind(now, seatId)
      .run();
    if (seat.status === 'reserved') {
      await env.DB.prepare(
        `INSERT INTO reservation_events (event_type, seat_id, participant_id, source, created_at)
         VALUES ('reservation.deleted', ?, ?, 'admin', ?)`,
      )
        .bind(seatId, seat.reservedBy, now)
        .run();
    }
  } else {
    await env.DB.prepare(
      `UPDATE seats
          SET status='available',
              updated_at=?1
        WHERE id=?2 AND status='disabled'`,
    )
      .bind(now, seatId)
      .run();
  }

  const updated = await getSeat(env, seatId);
  return { ok: true, seat: updated ?? seat };
}
