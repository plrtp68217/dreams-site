import { describe, expect, it } from "vitest";
import { actions, buildWeeks, isoDay, levelOf, levelRanges, monthLabels, monthTotals, thresholds, WEEKS } from "./calendar";

describe("thresholds and levels", () => {
  it("splits the team's non-zero days into quartiles", () => {
    const limits = thresholds([0, 1, 1, 2, 3, 5, 8, 13, 0]);
    expect(limits).toEqual([1, 3, 8]);
    expect([0, 1, 2, 3, 5, 6, 8, 9, 40].map((n) => levelOf(n, limits))).toEqual([0, 1, 2, 2, 3, 3, 3, 4, 4]);
    expect(levelRanges(limits)).toEqual(["0", "1", "2–3", "4–8", "9+"]);
  });

  it("stays strictly increasing with little data", () => {
    expect(thresholds([])).toEqual([1, 2, 3]);
    expect(thresholds([4])).toEqual([4, 5, 6]);
    expect(levelRanges([1, 2, 3])).toEqual(["0", "1", "2", "3", "4+"]);
  });
});

describe("buildWeeks", () => {
  // Tuesday, 13 Oct 2026
  const today = new Date(2026, 9, 13, 15, 30);

  it("covers a year of Monday-first weeks ending today", () => {
    const weeks = buildWeeks({ "2026-10-13": 3, "2026-10-12": 1 }, [1, 2, 3], today);
    expect(weeks).toHaveLength(WEEKS);
    expect(weeks[0][0].date).toBe("2025-10-13"); // a Monday
    expect(weeks.slice(0, -1).every((w) => w.length === 7)).toBe(true);
    const last = weeks[WEEKS - 1];
    expect(last.map((d) => [d.date, d.count, d.level])).toEqual([
      ["2026-10-12", 1, 1],
      ["2026-10-13", 3, 3],
    ]);
  });

  it("labels months and totals them for the table view", () => {
    const weeks = buildWeeks({ "2026-10-01": 2, "2026-10-13": 3, "2026-09-30": 7 }, [1, 2, 3], today);
    const labels = monthLabels(weeks);
    expect(labels.at(-1)).toEqual({ week: 51, label: "окт" });
    expect(labels.map((l) => l.label)).toContain("янв");
    const totals = monthTotals(weeks);
    expect(totals.at(-1)).toEqual({ month: "2026-10", count: 5 });
    expect(totals.at(-2)).toEqual({ month: "2026-09", count: 7 });
  });
});

describe("text helpers", () => {
  it("formats local days and Russian plurals", () => {
    expect(isoDay(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect([1, 2, 5, 11, 21, 22, 25, 112].map(actions)).toEqual([
      "1 действие",
      "2 действия",
      "5 действий",
      "11 действий",
      "21 действие",
      "22 действия",
      "25 действий",
      "112 действий",
    ]);
  });
});
