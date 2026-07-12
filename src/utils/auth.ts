import type { Context } from 'hono';
import { fail } from './response';
import { loadConfig } from '../config';
import type { HonoEnv } from '../types';

/**
 * 管理者 API の共通認証。
 * Bearer <ADMIN_TOKEN> ヘッダーを検証する。
 * 認証 OK なら null、失敗ならレスポンスを返す。
 */
export function requireAdmin(c: Context<HonoEnv>) {
  const auth = c.req.header('Authorization') ?? '';
  const expected = loadConfig(c.env).adminToken;

  if (!expected) {
    // 意図せず ADMIN_TOKEN が空の場合は全拒否 (デプロイミスの保険)
    return fail(c, 'UNAUTHORIZED', 'Admin token is not configured.', 401);
  }

  const prefix = 'Bearer ';
  if (!auth.startsWith(prefix)) {
    return fail(c, 'UNAUTHORIZED', 'Missing Authorization header.', 401);
  }

  const token = auth.slice(prefix.length);
  if (!constantTimeEqual(token, expected)) {
    return fail(c, 'UNAUTHORIZED', 'Invalid admin token.', 401);
  }

  return null;
}

/** タイミング攻撃を避けるための定数時間比較。 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
