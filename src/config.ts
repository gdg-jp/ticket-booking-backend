import type { AppBindings } from './types';

export interface AppConfig {
  eventName: string;
  rowLabels: string[];
  seatsPerRow: number;
  allowMultipleSeats: boolean;
  exposeParticipantId: boolean;
  allowedOrigins: string[];
  allowNullOrigin: boolean;
  adminToken: string;
}

const boolFromString = (v: string | undefined, fallback: boolean): boolean => {
  if (v === undefined) return fallback;
  const s = v.trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return fallback;
};

const listFromString = (v: string | undefined): string[] => {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

const parseSeatsPerRow = (raw: string | undefined): number => {
  const n = Number(raw ?? '10');
  if (!Number.isInteger(n) || n < 1 || n > 100) return 10;
  return n;
};

const parseRowLabels = (raw: string | undefined): string[] => {
  const list = listFromString(raw);
  if (list.length === 0) return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  return list;
};

export function loadConfig(env: AppBindings): AppConfig {
  return {
    eventName: env.EVENT_NAME || 'Seat Reservation',
    rowLabels: parseRowLabels(env.ROW_LABELS),
    seatsPerRow: parseSeatsPerRow(env.SEATS_PER_ROW),
    allowMultipleSeats: boolFromString(env.ALLOW_MULTIPLE_SEATS, false),
    exposeParticipantId: boolFromString(env.EXPOSE_PARTICIPANT_ID, false),
    allowedOrigins: listFromString(env.ALLOWED_ORIGINS),
    allowNullOrigin: boolFromString(env.ALLOW_NULL_ORIGIN, false),
    adminToken: env.ADMIN_TOKEN || '',
  };
}
