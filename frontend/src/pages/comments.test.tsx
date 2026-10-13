import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { TaskComment } from "../api/types";
import { needsReason } from "../components/TaskComments";
import { describeActivity } from "../lib/labels";
import { brief, makeTask, renderApp, users } from "../test/utils";

const editorBrief = { id: 2, username: "editor", display_name: "Редактор" };
const adminBrief = { id: 1, username: "admin", display_name: "Админ" };

function comment(over: Partial<TaskComment> = {}): TaskComment {
  return {
    id: 7,
    text: "Лицо **видно**",
    html: "<p>Лицо <strong>видно</strong></p>",
    status_from: "review",
    status_to: "in_progress",
    created_at: "2026-10-12T10:00:00Z",
    author: adminBrief,
    ...over,
  };
}

describe("needsReason", () => {
  it("asks for a comment only when work goes back from review", () => {
    expect(needsReason("review", "in_progress")).toBe(true);
    expect(needsReason("review", "todo")).toBe(true);
    expect(needsReason("review", "done")).toBe(false);
    expect(needsReason("in_progress", "review")).toBe(false);
  });
});

describe("task discussion", () => {
  it("shows comments with the status change they explain and the reviewer", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask({ reviewer: adminBrief, comments_count: 1 }));
    await renderApp("/t/1", users.viewer, () => vi.mocked(api.taskComments).mockResolvedValue([comment()]));
    const thread = await screen.findByRole("region", { name: "Обсуждение" });
    const item = await within(thread).findByRole("listitem");
    expect(item).toHaveTextContent("Админ");
    expect(item).toHaveTextContent("проверяющий");
    expect(item).toHaveTextContent("На проверке → В работе");
    expect(within(item).getByText("видно").tagName).toBe("STRONG");
    expect(screen.getByText("Проверяющий: Админ")).toBeInTheDocument();
    // viewers read but do not write or delete
    expect(screen.queryByRole("form", { name: "Новый комментарий" })).not.toBeInTheDocument();
    expect(within(item).queryByRole("button", { name: "Удалить" })).not.toBeInTheDocument();
  });

  it("posts a comment with a status change and «I am the reviewer»", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask({ status: "in_progress" }));
    const add = vi.spyOn(api, "addComment").mockResolvedValue({
      comment: comment({ author: editorBrief, status_from: "in_progress", status_to: "review", text: "Готово", html: "<p>Готово</p>" }),
      task: makeTask({ status: "review", reviewer: editorBrief, comments_count: 1 }),
    });
    await renderApp("/t/1", users.editor);
    const form = await screen.findByRole("form", { name: "Новый комментарий" });
    await userEvent.type(within(form).getByLabelText("Комментарий (Markdown)"), "Готово");
    await userEvent.selectOptions(within(form).getByLabelText("Статус"), "review");
    await userEvent.click(within(form).getByLabelText("Я проверяющий"));
    await userEvent.click(within(form).getByRole("button", { name: "Отправить" }));
    expect(add).toHaveBeenCalledWith(1, { text: "Готово", status: "review", set_reviewer: true });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Статус задачи" })).toHaveValue("review"));
    expect(screen.getByRole("combobox", { name: "Проверяющий" })).toHaveValue("2");
    expect(within(form).getByLabelText("Комментарий (Markdown)")).toHaveValue("");
  });

  it("deletes own comments", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask({ comments_count: 1 }));
    const del = vi.spyOn(api, "deleteComment").mockResolvedValue(undefined);
    await renderApp("/t/1", users.editor, () =>
      vi.mocked(api.taskComments).mockResolvedValue([comment({ author: editorBrief, status_from: null, status_to: null })]),
    );
    const thread = await screen.findByRole("region", { name: "Обсуждение" });
    await userEvent.click(await within(thread).findByRole("button", { name: "Удалить" }));
    expect(del).toHaveBeenCalledWith(1, 7);
    await waitFor(() => expect(within(thread).queryByRole("listitem")).not.toBeInTheDocument());
  });

  it("asks why when sending a task back from review on its page", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask({ status: "review" }));
    const setStatus = vi.spyOn(api, "setTaskStatus");
    const add = vi.spyOn(api, "addComment").mockResolvedValue({
      comment: comment(),
      task: makeTask({ status: "in_progress", reviewer: adminBrief, comments_count: 1 }),
    });
    await renderApp("/t/1", users.admin);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Статус задачи" }), "in_progress");
    expect(setStatus).not.toHaveBeenCalled();
    const form = screen.getByRole("form", { name: "Вернуть с проверки" });
    expect(within(form).getByRole("button", { name: "Вернуть с комментарием" })).toBeDisabled();
    expect(within(form).getByLabelText("Я проверяющий")).toBeChecked();
    await userEvent.type(within(form).getByRole("textbox"), "Лицо видно");
    await userEvent.click(within(form).getByRole("button", { name: "Вернуть с комментарием" }));
    expect(add).toHaveBeenCalledWith(1, { text: "Лицо видно", status: "in_progress", set_reviewer: true });
    await waitFor(() => expect(screen.queryByRole("form", { name: "Вернуть с проверки" })).not.toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Статус задачи" })).toHaveValue("in_progress");
  });

  it("asks why on the board too, and shows reviewer and comment count on cards", async () => {
    const add = vi.spyOn(api, "addComment").mockResolvedValue({
      comment: comment(),
      task: makeTask({ id: 4, status: "in_progress", reviewer: adminBrief, comments_count: 2 }),
    });
    await renderApp("/tasks", users.admin, () =>
      vi.mocked(api.tasks).mockResolvedValue([brief({ id: 4, status: "review", title: "Спрайт", comments_count: 1 })]),
    );
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Статус #4" }), "todo");
    const form = screen.getByRole("form", { name: "Вернуть с проверки" });
    await userEvent.click(within(form).getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("form", { name: "Вернуть с проверки" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Статус #4" })).toHaveValue("review");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Статус #4" }), "in_progress");
    const again = screen.getByRole("form", { name: "Вернуть с проверки" });
    await userEvent.type(within(again).getByRole("textbox"), "Переделать");
    await userEvent.click(within(again).getByRole("button", { name: "Вернуть с комментарием" }));
    expect(add).toHaveBeenCalledWith(4, { text: "Переделать", status: "in_progress", set_reviewer: true });
    const col = screen.getByRole("region", { name: "В работе" });
    const card = await within(col).findByRole("listitem");
    expect(card).toHaveTextContent("Проверяет: Админ");
    expect(within(card).getByRole("link", { name: "💬 2" })).toHaveAttribute("href", "/t/4#comments");
  });
});

describe("activity texts", () => {
  const base = {
    id: 1,
    entity_type: "task",
    entity_key: "3",
    entity_label: "Спрайт",
    created_at: "2026-10-12T10:00:00Z",
    user: null,
  };
  it("describes comments and reviewers", () => {
    expect(describeActivity({ ...base, action: "task.comment", details: { text: "x", from: "review", to: "in_progress" } })).toBe(
      "прокомментировал(а) #3 «Спрайт»: На проверке → В работе",
    );
    expect(describeActivity({ ...base, action: "task.comment", details: { text: "x" } })).toBe("прокомментировал(а) #3 «Спрайт»");
    expect(describeActivity({ ...base, action: "task.reviewer", details: { to: "Аня" } })).toBe("Аня — проверяющий #3 «Спрайт»");
    expect(describeActivity({ ...base, action: "task.reviewer", details: { to: null } })).toBe(
      "снял(а) проверяющего с #3 «Спрайт»",
    );
  });
});
