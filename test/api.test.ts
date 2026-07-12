import { describe, it, expect, beforeEach } from 'vitest';
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import app from '../src/index';
import { loadConfig } from '../src/config';
import { initializeSeats } from '../src/services/seats';
import { setSeatStatus } from '../src/services/reservations';

// マイグレーションを実行してテーブルを準備する。
async function applyMigrations() {
  const migration = `
    DROP TABLE IF EXISTS seats;
    DROP TABLE IF EXISTS reservation_events;

    CREATE TABLE seats (
      id TEXT PRIMARY KEY,
      row_label TEXT NOT NULL,
      seat_number INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('available','reserved','disabled')),
      reserved_by TEXT,
      reserved_at TEXT,
      reservation_source TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_seats_reserved_by
      ON seats(reserved_by) WHERE reserved_by IS NOT NULL;
    CREATE INDEX idx_seats_status ON seats(status);

    CREATE TABLE reservation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      seat_id TEXT NOT NULL,
      participant_id TEXT,
      source TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_reservation_events_created_at
      ON reservation_events(created_at DESC);
  `;
  const statements = migration
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
}

async function runFetch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.fetch(request, env as unknown as Env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function apiRequest(
  path: string,
  init?: RequestInit & { participantId?: string; admin?: boolean },
): Request {
  const headers = new Headers(init?.headers);
  if (init?.participantId) headers.set('X-Participant-ID', init.participantId);
  if (init?.admin) headers.set('Authorization', 'Bearer ' + env.ADMIN_TOKEN);
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Request('https://api.test' + path, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body,
  });
}

async function jsonOf(res: Response): Promise<any> {
  return await res.json();
}

beforeEach(async () => {
  await applyMigrations();
  const config = loadConfig(env as unknown as Env);
  await initializeSeats(env as unknown as Env, config);
});

describe('health', () => {
  it('returns 200', async () => {
    const res = await runFetch(apiRequest('/api/health'));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
  });
});

describe('GET /api/seats', () => {
  it('returns all seats and summary', async () => {
    const res = await runFetch(apiRequest('/api/seats'));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.success).toBe(true);
    expect(body.data.seats.length).toBe(100);
    expect(body.data.summary.total).toBe(100);
    expect(body.data.summary.available).toBe(100);
  });

  it('rejects invalid seat id', async () => {
    const res = await runFetch(apiRequest('/api/seats/ZZ-999'));
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('INVALID_SEAT_ID');
  });
});

describe('POST /api/reservations', () => {
  it('reserves an available seat', async () => {
    const res = await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        participantId: 'team-01',
        body: JSON.stringify({ seatId: 'A-1', source: 'web' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.success).toBe(true);
    expect(body.data.reservation.seatId).toBe('A-1');
  });

  it('accepts a native HTML form submission', async () => {
    const form = new URLSearchParams({
      participantId: 'team-form',
      seatId: 'A-2',
      source: 'webmcp',
    });
    const res = await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }),
    );
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.data.reservation).toMatchObject({
      participantId: 'team-form',
      seatId: 'A-2',
      source: 'webmcp',
    });
  });

  it('rejects a form submission with an invalid participant id', async () => {
    const form = new URLSearchParams({ participantId: 'invalid id', seatId: 'A-2' });
    const res = await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('INVALID_PARTICIPANT_ID');
  });

  it('rejects when the seat is already reserved', async () => {
    await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        participantId: 'team-01',
        body: JSON.stringify({ seatId: 'A-1', source: 'web' }),
      }),
    );
    const res = await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        participantId: 'team-02',
        body: JSON.stringify({ seatId: 'A-1', source: 'web' }),
      }),
    );
    expect(res.status).toBe(409);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('SEAT_ALREADY_RESERVED');
  });

  it('rejects reservation of a disabled seat', async () => {
    const config = loadConfig(env as unknown as Env);
    await setSeatStatus(env as unknown as Env, 'A-2', 'disabled');
    void config;
    const res = await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        participantId: 'team-01',
        body: JSON.stringify({ seatId: 'A-2', source: 'web' }),
      }),
    );
    expect(res.status).toBe(409);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('SEAT_DISABLED');
  });

  it('rejects second reservation from the same participant', async () => {
    await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        participantId: 'team-01',
        body: JSON.stringify({ seatId: 'A-1', source: 'web' }),
      }),
    );
    const res = await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        participantId: 'team-01',
        body: JSON.stringify({ seatId: 'A-2', source: 'web' }),
      }),
    );
    expect(res.status).toBe(409);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('ALREADY_HAS_RESERVATION');
  });

  it('rejects missing participant id', async () => {
    const res = await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        body: JSON.stringify({ seatId: 'A-1', source: 'web' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('INVALID_PARTICIPANT_ID');
  });

  it('rejects invalid seat id', async () => {
    const res = await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        participantId: 'team-01',
        body: JSON.stringify({ seatId: 'not-a-seat', source: 'web' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('INVALID_SEAT_ID');
  });

  it('only allows a single winner when many participants race for the same seat', async () => {
    const requests: Promise<Response>[] = [];
    for (let i = 0; i < 20; i++) {
      const pid = 'racer-' + i;
      requests.push(
        runFetch(
          apiRequest('/api/reservations', {
            method: 'POST',
            participantId: pid,
            body: JSON.stringify({ seatId: 'B-1', source: 'web' }),
          }),
        ),
      );
    }
    const results = await Promise.all(requests);
    const successes = results.filter((r) => r.status === 201);
    expect(successes.length).toBe(1);
    const failed = results.filter((r) => r.status === 409);
    expect(failed.length).toBe(19);
  });
});

describe('DELETE /api/reservations/me', () => {
  it('cancels own reservation', async () => {
    await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        participantId: 'team-01',
        body: JSON.stringify({ seatId: 'A-1', source: 'web' }),
      }),
    );
    const res = await runFetch(
      apiRequest('/api/reservations/me', {
        method: 'DELETE',
        participantId: 'team-01',
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.success).toBe(true);
    expect(body.data.seat.status).toBe('available');
  });

  it("cannot cancel someone else's reservation", async () => {
    await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        participantId: 'team-01',
        body: JSON.stringify({ seatId: 'A-1', source: 'web' }),
      }),
    );
    const res = await runFetch(
      apiRequest('/api/reservations/me', {
        method: 'DELETE',
        participantId: 'team-99',
      }),
    );
    expect(res.status).toBe(404);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('RESERVATION_NOT_FOUND');
  });
});

describe('admin auth', () => {
  it('rejects admin endpoints without a token', async () => {
    const res = await runFetch(
      apiRequest('/api/admin/reset', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'RESET_ALL_SEATS' }),
      }),
    );
    expect(res.status).toBe(401);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects wrong token', async () => {
    const res = await runFetch(
      new Request('https://api.test/api/admin/reset', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer wrong',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ confirm: 'RESET_ALL_SEATS' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('requires confirm value on reset', async () => {
    const res = await runFetch(
      apiRequest('/api/admin/reset', {
        method: 'POST',
        admin: true,
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });
});

describe('admin reset', () => {
  it('resets non-disabled seats but keeps disabled ones disabled', async () => {
    // 予約と disabled 設定を作る
    await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        participantId: 'team-01',
        body: JSON.stringify({ seatId: 'A-1', source: 'web' }),
      }),
    );
    await runFetch(
      apiRequest('/api/admin/seats/A-2', {
        method: 'PATCH',
        admin: true,
        body: JSON.stringify({ status: 'disabled' }),
      }),
    );

    const resetRes = await runFetch(
      apiRequest('/api/admin/reset', {
        method: 'POST',
        admin: true,
        body: JSON.stringify({ confirm: 'RESET_ALL_SEATS' }),
      }),
    );
    expect(resetRes.status).toBe(200);

    const listRes = await runFetch(apiRequest('/api/seats'));
    const body = await jsonOf(listRes);
    const a1 = body.data.seats.find((s: { id: string }) => s.id === 'A-1');
    const a2 = body.data.seats.find((s: { id: string }) => s.id === 'A-2');
    expect(a1.status).toBe('available');
    expect(a2.status).toBe('disabled');
  });
});

describe('admin force cancel', () => {
  it('forces a specific reservation to release', async () => {
    await runFetch(
      apiRequest('/api/reservations', {
        method: 'POST',
        participantId: 'team-01',
        body: JSON.stringify({ seatId: 'A-1', source: 'web' }),
      }),
    );
    const res = await runFetch(
      apiRequest('/api/admin/seats/A-1/reservation', {
        method: 'DELETE',
        admin: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data.seat.status).toBe('available');
  });
});

// Test env type shim
type Env = typeof env;
