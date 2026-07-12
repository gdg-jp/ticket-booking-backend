import type { DurableObjectState } from '@cloudflare/workers-types';
import type { AppBindings } from '../types';
import { sseFormat } from '../utils/response';

/**
 * SSE のファンアウト用 Durable Object。
 * - GET /subscribe  : SSE ストリームを返す
 * - POST /broadcast : 受け取ったイベントを接続中の全 SSE クライアントに配信
 *
 * Cloudflare Workers は request-scoped isolate のため、複数 API 呼び出しから
 * 同じ SSE クライアントへ配信するには「共有される 1 つの実体」が必要。
 * これを Durable Object 1 インスタンスで担う。
 */
export class EventHub implements DurableObject {
  private state: DurableObjectState;
  private writers = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  private encoder = new TextEncoder();
  private heartbeatTimer: number | null = null;
  private rateLimit: Map<string, number[]> = new Map();

  constructor(state: DurableObjectState, _env: AppBindings) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/subscribe') {
      return this.handleSubscribe();
    }

    if (request.method === 'POST' && url.pathname === '/broadcast') {
      const body = (await request.json()) as { event: string; data: unknown };
      this.broadcast(body.event, body.data);
      return new Response('ok', { status: 202 });
    }

    if (request.method === 'POST' && url.pathname === '/rate-check') {
      const body = (await request.json()) as {
        key: string;
        windowMs: number;
        max: number;
      };
      const allowed = this.rateCheck(body.key, body.windowMs, body.max);
      return new Response(JSON.stringify({ allowed }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('not found', { status: 404 });
  }

  /** SSE 接続開始。 */
  private handleSubscribe(): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    this.writers.add(writer);

    // 接続直後にウェルカムイベントを送る
    this.safeWrite(writer, sseFormat('connection.ready', { at: new Date().toISOString() }));

    // ハートビートタイマーを起動 (25 秒毎)
    this.ensureHeartbeat();

    // 接続が閉じられたときに writer を掃除する
    writer.closed
      .catch(() => {
        /* connection dropped */
      })
      .finally(() => {
        this.writers.delete(writer);
      });

    return new Response(readable, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
        connection: 'keep-alive',
      },
    });
  }

  /** 全接続クライアントにイベントを配信する。 */
  private broadcast(eventName: string, data: unknown): void {
    const payload = sseFormat(eventName, data);
    for (const writer of this.writers) {
      this.safeWrite(writer, payload);
    }
  }

  private safeWrite(writer: WritableStreamDefaultWriter<Uint8Array>, text: string): void {
    writer.write(this.encoder.encode(text)).catch(() => {
      // 書き込み失敗 → クライアントが切断済み。writer を除去。
      this.writers.delete(writer);
      try {
        writer.close();
      } catch {
        /* ignore */
      }
    });
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer !== null) return;
    // 25 秒ごとに heartbeat。書き込みがない SSE をプロキシが切断するのを防ぐ。
    this.heartbeatTimer = setInterval(() => {
      if (this.writers.size === 0) {
        clearInterval(this.heartbeatTimer!);
        this.heartbeatTimer = null;
        return;
      }
      this.broadcast('heartbeat', { at: new Date().toISOString() });
    }, 25_000) as unknown as number;
  }

  /** 参加者 ID 単位の簡易レート制限。窓時間内のカウント < max なら true。 */
  private rateCheck(key: string, windowMs: number, max: number): boolean {
    const now = Date.now();
    const timestamps = this.rateLimit.get(key) ?? [];
    const filtered = timestamps.filter((t) => now - t < windowMs);
    if (filtered.length >= max) {
      this.rateLimit.set(key, filtered);
      return false;
    }
    filtered.push(now);
    this.rateLimit.set(key, filtered);

    // Map が肥大化しないよう、時々古い key を掃除する
    if (this.rateLimit.size > 1000) {
      for (const [k, ts] of this.rateLimit) {
        const recent = ts.filter((t) => now - t < windowMs);
        if (recent.length === 0) this.rateLimit.delete(k);
        else this.rateLimit.set(k, recent);
      }
    }

    return true;
  }
}

// DurableObject の最低限のインターフェース
interface DurableObject {
  fetch(request: Request): Promise<Response>;
}
