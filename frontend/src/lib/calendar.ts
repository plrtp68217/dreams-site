/** Contribution-graph math: a year of weeks (Monday first), levels 0–4 like GitHub. */

export type Level = 0 | 1 | 2 | 3 | 4;

export interface DayCell {
  date: string;
  count: number;
  level: Level;
}

export const WEEKS = 53;

/** Local calendar day as YYYY-MM-DD (the server counts days in the viewer's time zone). */
export function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday-based weekday: 0 = Mon … 6 = Sun. */
export function weekday(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/**
 * Upper bounds of levels 1–3 from all non-zero daily counts of the team (quartiles), so the same colour means
 * the same amount of work for everyone. Always strictly increasing.
 */
export function thresholds(counts: number[]): [number, number, number] {
  const values = counts.filter((c) => c > 0).sort((a, b) => a - b);
  const q = (p: number) => (values.length ? values[Math.min(values.length - 1, Math.floor(p * values.length))] : 0);
  const t1 = Math.max(1, q(0.25));
  const t2 = Math.max(t1 + 1, q(0.5));
  const t3 = Math.max(t2 + 1, q(0.75));
  return [t1, t2, t3];
}

export function levelOf(count: number, [t1, t2, t3]: [number, number, number]): Level {
  if (count <= 0) return 0;
  if (count <= t1) return 1;
  if (count <= t2) return 2;
  if (count <= t3) return 3;
  return 4;
}

/** Ranges shown in the legend: «0», «1–2», …, «9+». */
export function levelRanges([t1, t2, t3]: [number, number, number]): string[] {
  const range = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);
  return ["0", range(1, t1), range(t1 + 1, t2), range(t2 + 1, t3), `${t3 + 1}+`];
}

/** Columns of weeks ending with the week of `today`; days after today are left out. */
export function buildWeeks(days: Record<string, number>, limits: [number, number, number], today: Date): DayCell[][] {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - weekday(end) - (WEEKS - 1) * 7);
  const weeks: DayCell[][] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (weekday(d) === 0) weeks.push([]);
    const date = isoDay(d);
    const count = days[date] ?? 0;
    weeks[weeks.length - 1].push({ date, count, level: levelOf(count, limits) });
  }
  return weeks;
}

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** Month name over the first week that starts in that month (skipping a cramped label at the very start). */
export function monthLabels(weeks: DayCell[][]): Array<{ week: number; label: string }> {
  const out: Array<{ week: number; label: string }> = [];
  weeks.forEach((week, i) => {
    const month = Number(week[0].date.slice(5, 7)) - 1;
    const prev = i ? Number(weeks[i - 1][0].date.slice(5, 7)) - 1 : -1;
    if (month !== prev) out.push({ week: i, label: MONTHS[month] });
  });
  // the first label is dropped if the next one follows too closely to fit
  if (out.length > 1 && out[1].week - out[0].week < 3) out.shift();
  return out;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const actions = (n: number) => `${n} ${plural(n, "действие", "действия", "действий")}`;

const dayFmt = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

export function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return dayFmt.format(new Date(y, m - 1, d));
}

/** Totals per month (oldest first) — the table view of the graph. */
export function monthTotals(weeks: DayCell[][]): Array<{ month: string; count: number }> {
  const totals = new Map<string, number>();
  for (const day of weeks.flat()) totals.set(day.date.slice(0, 7), (totals.get(day.date.slice(0, 7)) ?? 0) + day.count);
  return [...totals].map(([month, count]) => ({ month, count }));
}
