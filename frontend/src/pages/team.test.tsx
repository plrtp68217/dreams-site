import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import type { ActivityItem, TaskBrief } from "../api/types";
import { makeTask, renderApp, users } from "../test/utils";

function brief(code: string, status: TaskBrief["status"]): TaskBrief {
  const { content: _c, version: _v, updated_by: _u, ...rest } = makeTask({ code, status, title: `Задача ${code}` });
  return rest;
}

const activity: ActivityItem[] = [
  {
    id: 2,
    action: "task.status",
    entity_type: "task",
    entity_key: "FF-V01",
    entity_label: "Мужчина без лица",
    details: { from: "todo", to: "done" },
    created_at: new Date().toISOString(),
    user: { id: 2, username: "editor", display_name: "Редактор" },
  },
];

describe("TasksPage", () => {
  it("groups tasks into status columns", async () => {
    await renderApp("/tasks", users.viewer, () =>
      vi.mocked(api.tasks).mockResolvedValue([brief("A-1", "todo"), brief("A-2", "done"), brief("A-3", "done")]),
    );
    await userEvent.selectOptions(screen.getByLabelText("Тип"), "quest");
    const done = await screen.findByRole("region", { name: "Готово" });
    await waitFor(() => expect(within(done).getAllByRole("listitem")).toHaveLength(2));
    expect(within(screen.getByRole("region", { name: "Не начато" })).getByText("Задача A-1")).toBeInTheDocument();
    expect(api.tasks).toHaveBeenLastCalledWith({ kind: "quest", section: undefined, assignee_id: undefined });
    // viewers get read-only pills
    expect(within(done).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("moves a card when the team changes its status", async () => {
    vi.spyOn(api, "setTaskStatus").mockResolvedValue(makeTask({ code: "A-1", status: "in_progress" }));
    await renderApp("/tasks", users.editor, () => vi.mocked(api.tasks).mockResolvedValue([brief("A-1", "todo")]));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Статус A-1" }), "in_progress");
    const col = screen.getByRole("region", { name: "В работе" });
    await waitFor(() => expect(within(col).getByText("Задача A-1")).toBeInTheDocument());
    expect(api.setTaskStatus).toHaveBeenCalledWith("A-1", "in_progress");
  });

  it("can show a single status column from the URL", async () => {
    await renderApp("/tasks?status=review", users.viewer);
    expect(screen.getByRole("region", { name: "На проверке" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Готово" })).not.toBeInTheDocument();
  });
});

describe("ActivityPage", () => {
  it("shows team summary and a readable feed, filterable by member", async () => {
    vi.spyOn(api, "activitySummary").mockResolvedValue([
      { user: users.editor, total: 5, edits: 2, status_changes: 3, last_active: new Date().toISOString(), by_action: {} },
      { user: users.admin, total: 1, edits: 0, status_changes: 0, last_active: null, by_action: {} },
    ]);
    await renderApp("/activity", users.viewer, () => vi.mocked(api.activity).mockResolvedValue({ items: activity, total: 1 }));

    const card = await screen.findByRole("button", { name: /Редактор/ });
    expect(card).toHaveTextContent("2правок");
    expect(card).toHaveTextContent("3статусов");
    expect(screen.getByRole("button", { name: /Админ/ })).toHaveTextContent("нет активности");

    await userEvent.click(card);
    await waitFor(() => expect(api.activity).toHaveBeenLastCalledWith({ user_id: 2, limit: 30, offset: 0 }));
    const feed = await screen.findByRole("list", { name: "Лента активности" });
    expect(within(feed).getByRole("link")).toHaveTextContent(
      "сменил(а) статус FF-V01 «Мужчина без лица»: Не начато → Готово",
    );
    expect(card).toHaveAttribute("aria-pressed", "true");
  });

  it("loads more pages", async () => {
    vi.spyOn(api, "activitySummary").mockResolvedValue([]);
    await renderApp("/activity", users.viewer, () =>
      vi
        .mocked(api.activity)
        .mockResolvedValueOnce({ items: activity, total: 2 })
        .mockResolvedValueOnce({ items: [{ ...activity[0], id: 3, entity_key: "FF-V02" }], total: 2 }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Показать ещё (1)" }));
    expect(api.activity).toHaveBeenLastCalledWith({ user_id: undefined, limit: 30, offset: 1 });
    const feed = screen.getByRole("list", { name: "Лента активности" });
    await waitFor(() => expect(within(feed).getAllByRole("listitem")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: /Показать ещё/ })).not.toBeInTheDocument();
  });
});

describe("UsersPage", () => {
  const all = [users.admin, users.editor, users.viewer];

  it("changes roles and toggles access", async () => {
    await renderApp("/admin/users", users.admin, () => vi.mocked(api.users).mockResolvedValue(all));
    const update = vi.spyOn(api, "updateUser").mockImplementation(async (id, data) => ({ ...all.find((u) => u.id === id)!, ...data }));

    const row = await screen.findByTestId("user-viewer");
    await userEvent.selectOptions(within(row).getByRole("combobox", { name: "Роль viewer" }), "editor");
    expect(update).toHaveBeenCalledWith(3, { role: "editor" });
    await waitFor(() => expect(within(row).getByRole("combobox", { name: "Роль viewer" })).toHaveValue("editor"));

    await userEvent.click(within(row).getByRole("checkbox", { name: "Активен viewer" }));
    expect(update).toHaveBeenLastCalledWith(3, { is_active: false });
    expect(await within(row).findByText("Отключён")).toBeInTheDocument();
  });

  it("shows server-side refusals such as removing the last admin", async () => {
    await renderApp("/admin/users", users.admin, () => vi.mocked(api.users).mockResolvedValue(all));
    vi.spyOn(api, "updateUser").mockRejectedValue(new ApiError(400, "Нельзя убрать последнего администратора"));
    const row = await screen.findByTestId("user-admin");
    await userEvent.selectOptions(within(row).getByRole("combobox", { name: "Роль admin" }), "viewer");
    expect(await screen.findByRole("alert")).toHaveTextContent("Нельзя убрать последнего администратора");
  });

  it("creates users and resets passwords", async () => {
    await renderApp("/admin/users", users.admin);
    const created = { ...users.viewer, id: 9, username: "artist", display_name: "Художник", role: "editor" as const };
    const create = vi.spyOn(api, "createUser").mockResolvedValue(created);
    const reset = vi.spyOn(api, "resetPassword").mockResolvedValue(undefined);

    const form = screen.getByRole("form", { name: "Новый пользователь" });
    await userEvent.type(within(form).getByLabelText("Логин"), "artist");
    await userEvent.type(within(form).getByLabelText("Имя"), "Художник");
    await userEvent.type(within(form).getByLabelText("Пароль"), "secret1");
    await userEvent.click(within(form).getByRole("button", { name: "Создать" }));
    expect(create).toHaveBeenCalledWith({ username: "artist", password: "secret1", display_name: "Художник", role: "editor" });

    const row = await screen.findByTestId("user-artist");
    await userEvent.click(within(row).getByRole("button", { name: "Сбросить пароль" }));
    await userEvent.type(within(row).getByLabelText("Новый пароль для artist"), "newpass1");
    await userEvent.click(within(row).getByRole("button", { name: "OK" }));
    expect(reset).toHaveBeenCalledWith(9, "newpass1");
  });
});

describe("AccountPage", () => {
  it("changes the password", async () => {
    const change = vi.spyOn(api, "changePassword").mockResolvedValue(undefined);
    await renderApp("/account", users.viewer);
    await userEvent.type(screen.getByLabelText("Текущий пароль"), "old123");
    await userEvent.type(screen.getByLabelText("Новый пароль"), "new123");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(change).toHaveBeenCalledWith("old123", "new123");
    expect(await screen.findByRole("status")).toHaveTextContent("Пароль изменён");
  });
});
