import { useEffect, useMemo, useRef, useState } from "react";
import {
  actions,
  buildWeeks,
  formatDay,
  levelRanges,
  monthLabels,
  monthTotals,
  type DayCell,
} from "../lib/calendar";

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 26; // weekday labels
const TOP = 16; // month labels
const WEEKDAYS: Array<[number, string]> = [
  [0, "Пн"],
  [2, "Ср"],
  [4, "Пт"],
];

interface Props {
  name: string;
  days: Record<string, number>;
  limits: [number, number, number];
  today?: Date;
}

/** A year of daily activity as a grid of squares, one column per week (like GitHub contributions). */
export function ContributionGraph({ name, days, limits, today }: Props) {
  const weeks = useMemo(() => buildWeeks(days, limits, today ?? new Date()), [days, limits, today]);
  const total = weeks.flat().reduce((s, d) => s + d.count, 0);
  const busiest = weeks.flat().reduce<DayCell | null>((b, d) => (d.count > (b?.count ?? 0) ? d : b), null);
  const [hover, setHover] = useState<{ cell: DayCell; x: number; y: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // the latest weeks matter most: on narrow screens start scrolled to the end
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks]);

  const width = LEFT + weeks.length * STEP;
  const height = TOP + 7 * STEP;
  const summary =
    `${name}: ${actions(total)} за год` +
    (busiest ? `, самый активный день — ${formatDay(busiest.date)} (${actions(busiest.count)})` : "");

  return (
    <figure className="contrib" onMouseLeave={() => setHover(null)}>
      <div className="contrib-scroll" ref={scroller}>
        <svg width={width} height={height} role="img" aria-label={summary}>
          {monthLabels(weeks).map(({ week, label }) => (
            <text key={week} className="contrib-label" x={LEFT + week * STEP} y={10}>
              {label}
            </text>
          ))}
          {WEEKDAYS.map(([row, label]) => (
            <text key={row} className="contrib-label" x={0} y={TOP + row * STEP + CELL - 2}>
              {label}
            </text>
          ))}
          {weeks.map((week, w) =>
            week.map((cell, i) => {
              // weeks start on Monday, so the index is the weekday row
              const x = LEFT + w * STEP;
              const y = TOP + i * STEP;
              const active = hover?.cell.date === cell.date;
              return (
                <g
                  key={cell.date}
                  data-date={cell.date}
                  data-level={cell.level}
                  onMouseEnter={() => setHover({ cell, x: x + CELL / 2, y })}
                >
                  {/* hit target larger than the square */}
                  <rect x={x - GAP / 2} y={y - GAP / 2} width={STEP} height={STEP} fill="transparent" />
                  <rect
                    className={`contrib-cell l${cell.level}${active ? " active" : ""}`}
                    x={x}
                    y={y}
                    width={CELL}
                    height={CELL}
                    rx={2}
                  />
                </g>
              );
            }),
          )}
        </svg>
      </div>
      {hover && (
          <div
            className="contrib-tip"
            role="tooltip"
            style={{ left: hover.x - (scroller.current?.scrollLeft ?? 0), top: hover.y }}
          >
            <b>{hover.cell.count ? actions(hover.cell.count) : "Нет действий"}</b>
            <span>{formatDay(hover.cell.date)}</span>
          </div>
      )}
      <figcaption className="contrib-caption">
        <span>{actions(total)} за год</span>
        <details className="contrib-table">
          <summary>Таблицей</summary>
          <table>
            <caption className="visually-hidden">{name}: действия по месяцам</caption>
            <thead>
              <tr>
                <th scope="col">Месяц</th>
                <th scope="col">Действий</th>
              </tr>
            </thead>
            <tbody>
              {monthTotals(weeks).map(({ month, count }) => (
                <tr key={month}>
                  <td>{new Date(month + "-01T00:00:00").toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </figcaption>
    </figure>
  );
}

/** «Меньше ▢▢▢▢▢ Больше», with the count each colour stands for. */
export function ContributionLegend({ limits }: { limits: [number, number, number] }) {
  const ranges = levelRanges(limits);
  return (
    <div className="contrib-legend" aria-label="Шкала: число действий за день">
      <span>Меньше</span>
      {ranges.map((range, level) => (
        <span key={level} className="contrib-legend-item" title={`${range} в день`}>
          <svg width={CELL} height={CELL} aria-hidden="true">
            <rect className={`contrib-cell l${level}`} width={CELL} height={CELL} rx={2} />
          </svg>
          <span className="visually-hidden">{range}</span>
        </span>
      ))}
      <span>Больше</span>
    </div>
  );
}
