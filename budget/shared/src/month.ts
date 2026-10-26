/** A month key is always `YYYY-MM`. */
export type MonthKey = string;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isMonthKey(value: string): boolean {
  return MONTH_RE.test(value);
}

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return d <= daysInMonth(`${y}-${String(m).padStart(2, '0')}`);
}

export function monthOfDate(isoDate: string): MonthKey {
  return isoDate.slice(0, 7);
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const mon = (index % 12) + 1;
  return `${year}-${String(mon).padStart(2, '0')}`;
}

export function compareMonths(a: MonthKey, b: MonthKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive list of month keys from `from` to `to`. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; compareMonths(m, to) <= 0; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function clampDayToMonth(month: MonthKey, day: number): number {
  return Math.min(Math.max(1, day), daysInMonth(month));
}

export function dateInMonth(month: MonthKey, day: number): string {
  return `${month}-${String(clampDayToMonth(month, day)).padStart(2, '0')}`;
}

/** Today's date in the Europe/Paris timezone as `YYYY-MM-DD`. */
export function todayInParis(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function currentMonth(now: Date = new Date()): MonthKey {
  return monthOfDate(todayInParis(now));
}

const MONTH_NAMES_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export function formatMonthFr(month: MonthKey): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_NAMES_FR[m - 1]} ${y}`;
}
