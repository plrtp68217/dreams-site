import { describe, expect, it } from "vitest";
import type { ActivityItem } from "../api/types";
import { buildNews, dayTitle, groupByDay, matchesFilter, summarize, takeLastVisit } from "./news";

const anna = { id: 2, username: "anna", display_name: "Аня" };
const ivan = { id: 3, username: "ivan", display_name: "Иван" };
let nextId = 100;

function ev(action: string, over: Partial<ActivityItem> = {}): ActivityItem {
  const [type] = action.split(".");
  return {
    id: nextId--,
    action,
    entity_type: type === "user" ? "user" : type,
    entity_key: type === "section" ? "ff-visitors" : "5",
    entity_label: type === "section" ? "Посетители" : "Спрайт клоуна",
    details: {},
    created_at: "2026-10-13T12:00:00Z",
    user: anna,
    ...over,
  };
}

describe("buildNews", () => {
  it("folds repeated edits of one section by one person on one day", () => {
    const news = buildNews([
      ev("section.edit", { created_at: "2026-10-13T12:30:00Z", details: { fields: ["content"] } }),
      ev("section.edit", { created_at: "2026-10-13T12:10:00Z", details: { fields: ["title", "content"] } }),
      ev("section.edit", { created_at: "2026-10-13T11:00:00Z", user: ivan, details: { fields: ["content"] } }),
      ev("section.edit", { created_at: "2026-10-12T09:00:00Z", details: { fields: ["content"] } }),
    ]);
    expect(news.map((n) => [n.kind, n.user?.display_name, n.events.length, n.at])).toEqual([
      ["scenario", "Аня", 2, "2026-10-13T12:30:00Z"],
      ["scenario", "Иван", 1, "2026-10-13T11:00:00Z"],
      ["scenario", "Аня", 1, "2026-10-12T09:00:00Z"],
    ]);
    expect(news[0].fields).toEqual(["title", "content"]);
  });

  it("keeps where a series of status changes started and ended", () => {
    const [story] = buildNews([
      ev("task.status", { created_at: "2026-10-13T12:20:00Z", details: { from: "review", to: "done" } }),
      ev("task.status", { created_at: "2026-10-13T12:10:00Z", details: { from: "in_progress", to: "review" } }),
    ]);
    expect([story.kind, story.from, story.to, story.events.length]).toEqual(["task-status", "in_progress", "done", 2]);
  });

  it("tells a comment with its status change once, and skips noise", () => {
    const news = buildNews([
      ev("task.reviewer", { details: { from: null, to: "Аня" } }),
      ev("task.status", { details: { from: "review", to: "in_progress", comment: 9 } }),
      ev("task.comment", { details: { comment: 9, text: "Лицо видно", from: "review", to: "in_progress" } }),
      ev("user.register", { entity_label: "Иван" }),
      ev("media.upload"),
      ev("task.create", { details: { to: "Иван" } }),
      ev("user.role", { entity_label: "Иван", details: { from: "viewer", to: "editor" } }),
      ev("task.delete"),
    ]);
    expect(news.map((n) => n.kind)).toEqual(["task-update", "task-comment", "task-new", "team", "removed"]);
    const comment = news[1];
    expect([comment.text, comment.from, comment.to]).toEqual(["Лицо видно", "review", "in_progress"]);
    expect(news[2].text).toBe("Иван");
    expect(news[3].text).toBe("editor");
  });

  it("filters by what the reader cares about", () => {
    const news = buildNews([ev("task.create"), ev("task.comment", { details: { text: "x" } }), ev("section.edit")]);
    expect(news.filter((n) => matchesFilter(n, "tasks")).length).toBe(2);
    expect(news.filter((n) => matchesFilter(n, "comments")).map((n) => n.kind)).toEqual(["task-comment"]);
    expect(news.filter((n) => matchesFilter(n, "scenario")).map((n) => n.kind)).toEqual(["scenario"]);
    expect(news.filter((n) => matchesFilter(n, "all")).length).toBe(3);
  });
});

describe("summaries and days", () => {
  it("summarizes what is new in words", () => {
    const news = buildNews([
      ev("task.create"),
      ev("task.create", { entity_key: "6" }),
      ev("task.comment", { details: { text: "x" } }),
      ev("section.edit", { created_at: "2026-10-13T12:30:00Z" }),
      ev("section.edit", { created_at: "2026-10-13T12:20:00Z" }),
      ev("section.create", { entity_key: "new" }),
    ]);
    expect(summarize(news)).toEqual(["2 новые задачи", "1 комментарий", "3 правки сценария"]);
    expect(summarize([])).toEqual([]);
  });

  it("names days like people do", () => {
    const now = new Date(2026, 9, 13, 15, 0);
    expect(dayTitle(new Date(2026, 9, 13, 1, 0).toISOString(), now)).toBe("Сегодня");
    expect(dayTitle(new Date(2026, 9, 12, 23, 0).toISOString(), now)).toBe("Вчера");
    expect(dayTitle(new Date(2026, 9, 1, 12, 0).toISOString(), now)).toBe("1 октября");
    expect(dayTitle(new Date(2025, 11, 31, 12, 0).toISOString(), now)).toMatch(/31 декабря 2025/);
    const groups = groupByDay(
      buildNews([
        ev("task.create", { created_at: new Date(2026, 9, 13, 10).toISOString() }),
        ev("task.create", { entity_key: "6", created_at: new Date(2026, 9, 13, 9).toISOString() }),
        ev("task.create", { entity_key: "7", created_at: new Date(2026, 9, 12, 9).toISOString() }),
      ]),
      now,
    );
    expect(groups.map((g) => [g.day, g.items.length])).toEqual([
      ["Сегодня", 2],
      ["Вчера", 1],
    ]);
  });
});

describe("takeLastVisit", () => {
  it("remembers the previous visit and keeps the baseline for the session", () => {
    sessionStorage.clear();
    expect(takeLastVisit(1, new Date("2026-10-10T10:00:00Z"))).toBeNull(); // first ever visit
    sessionStorage.clear(); // a new browser session later
    expect(takeLastVisit(1, new Date("2026-10-13T10:00:00Z"))).toBe("2026-10-10T10:00:00.000Z");
    // reloading in the same session keeps the same baseline
    expect(takeLastVisit(1, new Date("2026-10-13T10:05:00Z"))).toBe("2026-10-10T10:00:00.000Z");
    expect(takeLastVisit(2)).toBeNull(); // per user
  });
});
