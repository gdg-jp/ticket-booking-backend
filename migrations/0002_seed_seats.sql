-- デフォルトの座席 (A-J 行 × 1-10 番) を登録する。
WITH
  rows(row_label) AS (
    VALUES ('A'), ('B'), ('C'), ('D'), ('E'), ('F'), ('G'), ('H'), ('I'), ('J')
  ),
  numbers(seat_number) AS (
    VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10)
  )
INSERT OR IGNORE INTO seats (id, row_label, seat_number, status, updated_at)
SELECT
  row_label || '-' || seat_number,
  row_label,
  seat_number,
  'available',
  CURRENT_TIMESTAMP
FROM rows CROSS JOIN numbers;
