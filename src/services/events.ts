import type { AppBindings, BroadcastEvent } from '../types';
import type { AppConfig } from '../config';

/** EventHub の Durable Object スタブを取得する。 */
function getEventHubStub(env: AppBindings) {
  const id = env.EVENT_HUB.idFromName('global');
  return env.EVENT_HUB.get(id);
}

/**
 * SSE ブロードキャストを Durable Object に依頼する。
 * config.exposeParticipantId=false のときは reservedBy / participantId を落とす。
 */
export async function broadcast(
  env: AppBindings,
  config: AppConfig,
  event: BroadcastEvent,
): Promise<void> {
  const payload = sanitizeEvent(event, config.exposeParticipantId);
  const stub = getEventHubStub(env);
  await stub.fetch('https://event-hub.internal/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: payload.type, data: payload.data }),
  });
}

/** SSE ストリームを DO に委譲して返す。 */
export async function forwardSubscribe(env: AppBindings, request: Request): Promise<Response> {
  const stub = getEventHubStub(env);
  return stub.fetch('https://event-hub.internal/subscribe', {
    method: 'GET',
    headers: request.headers,
  });
}

/** 参加者 ID 単位の簡易レート制限 (DO の Map で管理)。 */
export async function rateCheck(
  env: AppBindings,
  key: string,
  windowMs: number,
  max: number,
): Promise<boolean> {
  try {
    const stub = getEventHubStub(env);
    const res = await stub.fetch('https://event-hub.internal/rate-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, windowMs, max }),
    });
    const body = (await res.json()) as { allowed: boolean };
    return body.allowed !== false;
  } catch {
    // DO 障害時はリクエストを通す (フェイルオープン)
    return true;
  }
}

function sanitizeEvent(event: BroadcastEvent, exposeParticipantId: boolean): BroadcastEvent {
  if (exposeParticipantId) return event;
  switch (event.type) {
    case 'seat.updated':
      return { ...event, data: { ...event.data, reservedBy: null } };
    case 'reservation.created':
    case 'reservation.deleted': {
      const { participantId: _dropped, ...rest } = event.data;
      return { ...event, data: rest } as BroadcastEvent;
    }
    default:
      return event;
  }
}
