import type { ReservationSource } from '../types';

const PARTICIPANT_ID_RE = /^[A-Za-z0-9_-]+$/;
const PARTICIPANT_ID_MAX = 64;

const VALID_SOURCES: ReservationSource[] = [
  'web',
  'webmcp',
  'antigravity',
  'admin',
  'unknown',
];

/**
 * 参加者 ID のバリデーション。
 * 英数字・ハイフン・アンダースコアのみ、1〜64 文字。
 */
export function validateParticipantId(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (v.length === 0) return false;
  if (v.length > PARTICIPANT_ID_MAX) return false;
  return PARTICIPANT_ID_RE.test(v);
}

/**
 * 席 ID の形式チェック (行と席番号の範囲で厳密にチェック)。
 * `A-5` のように "<行ラベル>-<席番号>" の形式であることを確認する。
 */
export function validateSeatId(
  v: unknown,
  rowLabels: string[],
  seatsPerRow: number,
): v is string {
  if (typeof v !== 'string') return false;
  const idx = v.indexOf('-');
  if (idx <= 0 || idx === v.length - 1) return false;
  const row = v.slice(0, idx);
  const numStr = v.slice(idx + 1);
  if (!rowLabels.includes(row)) return false;
  if (!/^\d+$/.test(numStr)) return false;
  const num = Number(numStr);
  if (!Number.isInteger(num)) return false;
  if (num < 1 || num > seatsPerRow) return false;
  return true;
}

/** ソースの正規化。未知の値は 'unknown' に丸める。 */
export function normalizeSource(v: unknown): ReservationSource {
  if (typeof v !== 'string') return 'unknown';
  return (VALID_SOURCES as string[]).includes(v)
    ? (v as ReservationSource)
    : 'unknown';
}
