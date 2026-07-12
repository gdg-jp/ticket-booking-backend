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

// re-export type
export type { StatusCode };
