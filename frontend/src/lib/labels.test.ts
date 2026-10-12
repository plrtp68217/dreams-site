import { describe, expect, it } from "vitest";
import type { ActivityItem } from "../api/types";
import { activityLink, describeActivity, formatDate, relativeTime } from "./labels";
import { findTopSlug, flattenTree } from "./ScenarioContext";
import { tree } from "../test/utils";

function item(over: Partial<ActivityItem>): ActivityItem {
  return {
    id: 1,
    action: "task.status",
    entity_type: "task",
    entity_key: "FF-V01",
    entity_label: "Мужчина без лица",
    details: {},
    created_at: "2026-10-12T10:00:00Z",
    user: null,
    ...over,
  };
}

describe("describeActivity", () => {
  it("describes status changes with localized labels", () => {
    expect(describeActivity(item({ details: { from: "todo", to: "done" } }))).toBe(
      "сменил(а) статус FF-V01 «Мужчина без лица»: Не начато → Готово",
    );
    expect(
      describeActivity(item({ action: "section.status", entity_type: "section", entity_key: "ff", entity_label: "Сон 1", details: { from: "part", to: "done" } })),
    ).toBe("сменил(а) статус «Сон 1»: Есть концепт → Расписано полностью");
  });

  it("describes edits, roles, assignees and more", () => {
    expect(describeActivity(item({ action: "task.edit", details: { fields: ["title", "content"] } }))).toBe(
      "отредактировал(а) FF-V01 «Мужчина без лица» (заголовок, текст)",
    );
    expect(describeActivity(item({ action: "task.assignee", details: { to: "Аня" } }))).toContain("назначил(а)");
    expect(describeActivity(item({ action: "task.assignee", details: { to: null } }))).toContain("снял(а) исполнителя");
    expect(
      describeActivity(item({ action: "user.role", entity_type: "user", entity_label: "Аня", details: { from: "viewer", to: "editor" } })),
    ).toBe("выдал(а) роль «Команда» пользователю Аня");
    expect(describeActivity(item({ action: "user.active", entity_type: "user", entity_label: "Аня", details: { to: false } }))).toContain("отключил(а)");
    expect(describeActivity(item({ action: "task.restore", details: { version: 2 } }))).toContain("версию 2");
    expect(describeActivity(item({ action: "user.register", entity_type: "user" }))).toBe("зарегистрировался(-ась)");
    expect(describeActivity(item({ action: "weird.thing" }))).toContain("weird.thing");
  });

  it("links to the affected entity unless it was deleted", () => {
    expect(activityLink(item({}))).toBe("/t/FF-V01");
    expect(activityLink(item({ entity_type: "section", entity_key: "ff" }))).toBe("/s/ff");
    expect(activityLink(item({ action: "task.delete" }))).toBeNull();
    expect(activityLink(item({ entity_type: "user" }))).toBeNull();
  });
});

describe("dates", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  it("formats relative time", () => {
    expect(relativeTime(null)).toBe("нет активности");
    expect(relativeTime("2026-10-12T11:59:30Z", now)).toBe("только что");
    expect(relativeTime("2026-10-12T11:30:00Z", now)).toBe("30 мин назад");
    expect(relativeTime("2026-10-12T07:00:00Z", now)).toBe("5 ч назад");
    expect(relativeTime("2026-10-10T12:00:00Z", now)).toBe("2 дн назад");
    expect(relativeTime("2026-09-01T12:00:00Z", now)).toBe(formatDate("2026-09-01T12:00:00Z"));
  });
  it("handles bad input", () => {
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("garbage")).toBe("—");
  });
});

describe("tree helpers", () => {
  it("finds the top-level page for nested sections", () => {
    expect(findTopSlug(tree, "ff-visitors")).toBe("ff");
    expect(findTopSlug(tree, "overview")).toBe("overview");
    expect(findTopSlug(tree, "missing")).toBeNull();
  });
  it("flattens with depth", () => {
    expect(flattenTree(tree).map((n) => [n.slug, n.depth])).toEqual([
      ["overview", 0],
      ["ff", 0],
      ["ff-visitors", 1],
      ["items", 0],
    ]);
  });
});
