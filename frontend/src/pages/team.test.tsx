import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import type { ActivityItem, TaskBrief } from "../api/types";
import { brief, makeSection, makeTask, renderApp, users } from "../test/utils";

const activity: ActivityItem[] = [
  {
    id: 2,
    action: "task.status",
    entity_type: "task",
    entity_key: "1",
    entity_label: "Мужчина без лица",
    details: { from: "todo", to: "done" },
    created_at: new Date().toISOString(),
    user: { id: 2, username: "editor", display_name: "Редактор" },
  },
];

const card = (id: number, status: TaskBrief["status"], over: Partial<TaskBrief> = {}) =>
  brief({ id, status, title: `Задача ${id}`, ...over });

describe("TasksPage", () => {
  it("starts empty and invites the team to create the first task", async () => {
    await renderApp("/tasks", users.editor);
    expect(await screen.findByText("Задач пока нет. Создайте первую кнопкой «+ Новая задача».")).toBeInTheDocument();
  });

  it("does not let viewers create tasks", async () => {
    await renderApp("/tasks?new=1", users.viewer);
    expect(await screen.findByText("Задач пока нет.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Новая задача" })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Новая задача" })).not.toBeInTheDocument();
  });

  it("creates a task with a description and an assignee", async () => {
    const created = makeTask({ id: 5, title: "Озвучить клоуна", assignee: { id: 2, username: "editor", display_name: "Редактор" } });
    const create = vi.spyOn(api, "createTask").mockResolvedValue(created);
    await renderApp("/tasks", users.editor);
    await userEvent.click(await screen.findByRole("button", { name: "+ Новая задача" }));
    const form = screen.getByRole("form", { name: "Новая задача" });
    expect(within(form).getByRole("button", { name: "Создать задачу" })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText("Название"), "Озвучить клоуна");
    await userEvent.type(within(form).getByLabelText("Описание (Markdown)"), "Смех издалека, 3 варианта");
    await userEvent.selectOptions(within(form).getByLabelText("Тип"), "sound");
    await userEvent.selectOptions(within(form).getByLabelText("Исполнитель"), "2");
    await userEvent.click(within(form).getByRole("button", { name: "Создать задачу" }));
    expect(create).toHaveBeenCalledWith({
      title: "Озвучить клоуна",
      content: "Смех издалека, 3 варианта",
      kind: "sound",
      assignee_id: 2,
      section_slug: null,
      anchor: null,
      anchor_label: "",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Задача #5 «Озвучить клоуна» создана и назначена на Редактор.");
    expect(screen.queryByRole("form", { name: "Новая задача" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Не начато" })).getByText("Озвучить клоуна")).toBeInTheDocument();
  });

  it("prefills the place when opened from a line in the scenario", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection().children[0]);
    const create = vi.spyOn(api, "createTask").mockResolvedValue(makeTask({ id: 2 }));
    await renderApp("/tasks?new=1&at=ff-visitors&anchor=FF-V01-01", users.editor);
    const form = await screen.findByRole("form", { name: "Новая задача" });
    await waitFor(() => expect(within(form).getByLabelText("Раздел")).toHaveValue("ff-visitors"));
    const place = within(form).getByLabelText("Место в разделе");
    await waitFor(() => expect(place).toHaveDisplayValue(/Мужчина: «Комбо без прошлого.»/));
    // the prefill does not filter the board
    expect(api.tasks).toHaveBeenLastCalledWith({ kind: undefined, section: undefined, assignee_id: undefined });
    await userEvent.type(within(form).getByLabelText("Название"), "Размыть лицо");
    await userEvent.click(within(form).getByRole("button", { name: "Создать задачу" }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        section_slug: "ff-visitors",
        anchor: "FF-V01-01",
        anchor_label: "Мужчина: «Комбо без прошлого.»",
      }),
    );
  });

  it("lists places of the chosen section and resets the place when the section changes", async () => {
    vi.spyOn(api, "section").mockImplementation(async (slug) =>
      slug === "ff-visitors" ? makeSection().children[0] : makeSection({ slug, content: "<p>без мест</p>", children: [] }),
    );
    await renderApp("/tasks?new=1", users.editor);
    const form = await screen.findByRole("form", { name: "Новая задача" });
    expect(within(form).queryByLabelText("Место в разделе")).not.toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText("Раздел"), "ff-visitors");
    const place = within(form).getByLabelText("Место в разделе");
    await waitFor(() => expect(within(place).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Весь раздел",
      "Карточка «Мужчина без лица»",
      "\u00a0\u00a0\u00a0Мужчина: «Комбо без прошлого.»",
      "Записка: «Ты уже была здесь»",
    ]));
    await userEvent.selectOptions(place, "p-note");
    await userEvent.selectOptions(within(form).getByLabelText("Раздел"), "overview");
    await waitFor(() => expect(within(form).getByLabelText("Место в разделе")).toHaveValue(""));
    await userEvent.click(within(form).getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("form", { name: "Новая задача" })).not.toBeInTheDocument();
  });

  it("groups tasks into status columns and filters them", async () => {
    await renderApp("/tasks", users.viewer, () =>
      vi.mocked(api.tasks).mockResolvedValue([card(1, "todo"), card(2, "done"), card(3, "done")]),
    );
    await userEvent.selectOptions(screen.getByLabelText("Тип"), "art");
    const done = await screen.findByRole("region", { name: "Готово" });
    await waitFor(() => expect(within(done).getAllByRole("listitem")).toHaveLength(2));
    const todo = within(screen.getByRole("region", { name: "Не начато" })).getByRole("listitem");
    expect(within(todo).getByText("#1")).toBeInTheDocument();
    expect(within(todo).getByRole("link", { name: "Задача 1" })).toHaveAttribute("href", "/t/1");
    expect(within(todo).getByRole("link", { name: /Семь посетителей › Мужчина/ })).toHaveAttribute("href", "/s/ff#FF-V01-01");
    expect(api.tasks).toHaveBeenLastCalledWith({ kind: "art", section: undefined, assignee_id: undefined });
    // viewers get read-only pills
    expect(within(done).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("moves a card when the team changes its status and assigns from the board", async () => {
    vi.spyOn(api, "setTaskStatus").mockResolvedValue(makeTask({ status: "in_progress" }));
    vi.spyOn(api, "setAssignee").mockResolvedValue(makeTask({ assignee: { id: 2, username: "editor", display_name: "Редактор" } }));
    await renderApp("/tasks", users.editor, () => vi.mocked(api.tasks).mockResolvedValue([card(1, "todo")]));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Статус #1" }), "in_progress");
    const col = screen.getByRole("region", { name: "В работе" });
    await waitFor(() => expect(within(col).getByText("Задача 1")).toBeInTheDocument());
    expect(api.setTaskStatus).toHaveBeenCalledWith(1, "in_progress");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Исполнитель #1" }), "2");
    expect(api.setAssignee).toHaveBeenCalledWith(1, 2);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Исполнитель #1" })).toHaveValue("2"));
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
      "сменил(а) статус #1 «Мужчина без лица»: Не начато → Готово",
    );
    expect(card).toHaveAttribute("aria-pressed", "true");
  });

  it("loads more pages", async () => {
    vi.spyOn(api, "activitySummary").mockResolvedValue([]);
    await renderApp("/activity", users.viewer, () =>
      vi
        .mocked(api.activity)
        .mockResolvedValueOnce({ items: activity, total: 2 })
        .mockResolvedValueOnce({ items: [{ ...activity[0], id: 3, entity_key: "2" }], total: 2 }),
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
