import type { AppConfig } from '../config';

export interface SeatSlot {
  id: string;
  row: string;
  number: number;
}

/** config から席レイアウトを生成する (行順 × 席順)。 */
export function buildSeatLayout(config: AppConfig): SeatSlot[] {
  const seats: SeatSlot[] = [];
  for (const row of config.rowLabels) {
    for (let n = 1; n <= config.seatsPerRow; n++) {
      seats.push({ id: `${row}-${n}`, row, number: n });
    }
  }
  return seats;
}
