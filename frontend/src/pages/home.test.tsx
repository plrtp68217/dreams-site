import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { ActivityItem } from "../api/types";
import { brief, renderApp, users } from "../test/utils";

const adminBrief = { id: 1, username: "admin", display_name: "Админ" };
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const activity: ActivityItem[] = [
  {
    id: 5, action: "task.comment", entity_type: "task", entity_key: "4", entity_label: "Спрайт",
    details: { text: "Лицо видно — размыть", from: "review", to: "in_progress", comment: 1 },
    created_at: minutesAgo(5), user: adminBrief,
  },
  {
    id: 4, action: "task.status", entity_type: "task", entity_key: "4", entity_label: "Спрайт",
    details: { from: "review", to: "in_progress", comment: 1 }, created_at: minutesAgo(5), user: adminBrief,
  },
  {
    id: 3, action: "section.edit", entity_type: "section", entity_key: "ff-visitors", entity_label: "Посетители",
    details: { fields: ["content"] }, created_at: minutesAgo(30), user: adminBrief,
  },
  {
    id: 2, action: "task.create", entity_type: "task", entity_key: "4", entity_label: "Спрайт",
    details: { to: "Редактор" }, created_at: minutesAgo(60 * 24 * 3), user: adminBrief,
  },
];

describe("HomePage news", () => {
  it("shows stories grouped by day, with task context", async () => {
    await renderApp("/", users.editor, () => {
      vi.mocked(api.activity).mockResolvedValue({ items: activity, total: 4 });
      vi.mocked(api.tasks).mockResolvedValue([
        brief({ id: 4, title: "Спрайт мужчины", status: "in_progress", assignee: { id: 2, username: "editor", display_name: "Редактор" } }),
      ]);
    });
    expect(screen.getByRole("heading", { level: 1, name: "Обзор проекта" })).toBeInTheDocument();
    const today = await screen.findByRole("region", { name: "Сегодня" });
    const cards = within(today).getAllByRole("listitem");
    expect(cards).toHaveLength(2); // the status change is told by its comment
    expect(cards[0]).toHaveTextContent("Обсуждение");
    expect(cards[0]).toHaveTextContent("На проверке → В работе");
    expect(within(cards[0]).getByRole("link", { name: "Лицо видно — размыть" })).toHaveAttribute("href", "/t/4#comments");
    expect(within(cards[0]).getByRole("link", { name: "#4 Спрайт мужчины" })).toHaveAttribute("href", "/t/4");
    expect(cards[1]).toHaveTextContent("Сценарий");
    expect(cards[1]).toHaveTextContent("1 правка · текст");
    const older = screen.getAllByRole("region").find((r) => r.querySelector(".news-task-new"))!;
    expect(older).toHaveTextContent("Новая задача");
    expect(older).toHaveTextContent("Исполнитель: Редактор");
    expect(older).toHaveTextContent("Семь посетителей › Мужчина: «Комбо без прошлого.»");
    expect(api.activity).toHaveBeenCalledWith(expect.objectContaining({ limit: 200, since: expect.any(String) }));
  });

  it("marks what is new since the last visit and summarizes it", async () => {
    localStorage.setItem("dreams-last-visit-2", minutesAgo(60));
    sessionStorage.clear();
    await renderApp("/", users.editor, () => vi.mocked(api.activity).mockResolvedValue({ items: activity, total: 4 }));
    expect(await screen.findByRole("status")).toHaveTextContent("С вашего прошлого визита: 1 комментарий, 1 правка сценария.");
    const today = screen.getByRole("region", { name: "Сегодня" });
    expect(within(today).getAllByText("новое")).toHaveLength(2);
    sessionStorage.clear();
  });

  it("filters stories", async () => {
    await renderApp("/", users.viewer, () => vi.mocked(api.activity).mockResolvedValue({ items: activity, total: 4 }));
    await screen.findByRole("region", { name: "Сегодня" });
    await userEvent.click(screen.getByRole("button", { name: "Сценарий" }));
    await waitFor(() => expect(document.querySelectorAll(".news-card")).toHaveLength(1));
    expect(document.querySelector(".news-card")).toHaveTextContent("Посетители");
    await userEvent.click(screen.getByRole("button", { name: "Обсуждения" }));
    expect(document.querySelector(".news-card")).toHaveTextContent("Лицо видно");
    expect(screen.getByText(/доступ на чтение/)).toBeInTheDocument();
  });

  it("shows my tasks and tasks waiting for my review", async () => {
    await renderApp("/", users.editor, () =>
      vi.mocked(api.tasks).mockResolvedValue([
        brief({ id: 1, title: "Моя", status: "in_progress", assignee: { id: 2, username: "editor", display_name: "Редактор" } }),
        brief({ id: 2, title: "Готовая моя", status: "done", assignee: { id: 2, username: "editor", display_name: "Редактор" } }),
        brief({ id: 3, title: "На проверку", status: "review", assignee: { id: 1, username: "admin", display_name: "Админ" } }),
        brief({ id: 4, title: "Чужая проверка", status: "review", reviewer: adminBrief }),
      ]),
    );
    const mine = await screen.findByTestId("my-tasks");
    await waitFor(() => expect(within(mine).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["#1 · Моя В работе"]));
    expect(within(screen.getByTestId("to-review")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByTestId("to-review")).toHaveTextContent("#3 · На проверку");
  });

  it("says when nothing happened", async () => {
    await renderApp("/", users.editor);
    expect(await screen.findByText("За последние 30 дней ничего не происходило.")).toBeInTheDocument();
  });
});
