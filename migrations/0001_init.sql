-- 席テーブル
CREATE TABLE seats (
  id TEXT PRIMARY KEY,
  row_label TEXT NOT NULL,
  seat_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'reserved', 'disabled')),
  reserved_by TEXT,
  reserved_at TEXT,
  reservation_source TEXT,
  updated_at TEXT NOT NULL
);

-- 1 参加者 1 席制約を DB レベルで担保 (NULL は複数許容される)
CREATE UNIQUE INDEX idx_seats_reserved_by
  ON seats(reserved_by)
  WHERE reserved_by IS NOT NULL;

CREATE INDEX idx_seats_status ON seats(status);

-- 予約イベント履歴 (会場スクリーンの最近の履歴表示に使用)
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
