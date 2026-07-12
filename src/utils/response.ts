import type { Context } from 'hono';
import type { StatusCode, ContentfulStatusCode } from 'hono/utils/http-status';

/** 成功レスポンスの共通形式。 */
export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ success: true, data }, status);
}

/** 失敗レスポンスの共通形式。エラーコードとメッセージは分離する。 */
export function fail(
  c: Context,
  code: string,
  message: string,
  status: ContentfulStatusCode = 400,
) {
  return c.json(
    {
      success: false,
      error: { code, message },
    },
    status,
  );
}

/** SSE data フィールドを生成する薄いユーティリティ。 */
export function sseFormat(event: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

// re-export type
export type { StatusCode };
