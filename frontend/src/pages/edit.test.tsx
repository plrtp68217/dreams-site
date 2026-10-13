import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import { insertAt } from "../components/EditorForm";
import { makeSection, makeTask, renderApp, users } from "../test/utils";

const textarea = () => screen.getByLabelText("Текст (HTML)") as HTMLTextAreaElement;

describe("insertAt", () => {
  it("replaces the selection and returns the new cursor", () => {
    expect(insertAt("abcdef", 2, 4, "XY")).toEqual({ value: "abXYef", cursor: 4 });
  });
});

describe("SectionEditPage", () => {
  it("edits text with live preview and saves with the current version", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    const update = vi.spyOn(api, "updateSection").mockResolvedValue(makeSection({ version: 4 }));
    await renderApp("/s/ff/edit", users.editor);
    await screen.findByRole("heading", { name: "Правка: Сон 1: Фастфуд" });

    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    fireEvent.change(textarea(), { target: { value: "<p>Новый текст</p>" } });
    const preview = screen.getByTestId("preview");
    expect(preview).toHaveTextContent("Новый текст");

    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(update).toHaveBeenCalledWith("ff", {
      version: 3,
      title: "Сон 1: Фастфуд",
      content: "<p>Новый текст</p>",
    });
    expect(await screen.findByRole("heading", { level: 2, name: "Сон 1: Фастфуд" })).toBeInTheDocument();
  });

  it("inserts snippets from the toolbar", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection({ content: "" }));
    await renderApp("/s/ff/edit", users.editor);
    await screen.findByRole("toolbar");
    await userEvent.click(screen.getByRole("button", { name: "Реплика" }));
    expect(textarea().value).toContain('class="line"');
    expect(screen.getByTestId("preview")).toHaveTextContent("Текст реплики");
    // no proposals and no embedded tasks any more
    expect(screen.queryByRole("button", { name: "Предложение" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Задача" })).not.toBeInTheDocument();
  });

  it("uploads an image and inserts it", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection({ content: "" }));
    const upload = vi.spyOn(api, "upload").mockResolvedValue({ url: "/media/upload-1.png" });
    await renderApp("/s/ff/edit", users.editor);
    await screen.findByRole("toolbar");
    const file = new File(["x"], "клоун.png", { type: "image/png" });
    await userEvent.upload(screen.getByTestId("image-input"), file);
    expect(upload).toHaveBeenCalledWith(file);
    await waitFor(() => expect(textarea().value).toContain('src="/media/upload-1.png" alt="клоун"'));
  });

  it("handles edit conflicts by offering to overwrite", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    const update = vi
      .spyOn(api, "updateSection")
      .mockRejectedValueOnce(new ApiError(409, "Запись уже изменил другой участник", { message: "x", current_version: 5 }))
      .mockResolvedValueOnce(makeSection({ version: 6 }));
    await renderApp("/s/ff/edit", users.editor);
    await screen.findByRole("toolbar");
    fireEvent.change(textarea(), { target: { value: "<p>мой вариант</p>" } });
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Запись уже изменил другой участник");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить поверх чужой правки" }));
    expect(update).toHaveBeenLastCalledWith("ff", expect.objectContaining({ version: 5, content: "<p>мой вариант</p>" }));
  });

  it("shows section history and restores a version", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    vi.spyOn(api, "sectionRevisions").mockResolvedValue([
      { id: 11, version: 2, title: "Старое", content: "<p>старый текст</p>", created_at: "2026-10-01T10:00:00Z", author: null },
    ]);
    const restore = vi.spyOn(api, "restoreSection").mockResolvedValue(makeSection());
    await renderApp("/s/ff/history", users.editor);
    await userEvent.click(await screen.findByRole("button", { name: "Посмотреть" }));
    expect(screen.getByText("старый текст")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Восстановить" }));
    expect(restore).toHaveBeenCalledWith("ff", 11);
  });

  it("does not offer restore to viewers", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    vi.spyOn(api, "sectionRevisions").mockResolvedValue([
      { id: 11, version: 2, title: "Старое", content: "<p>x</p>", created_at: "2026-10-01T10:00:00Z", author: null },
    ]);
    await renderApp("/s/ff/history", users.viewer);
    await screen.findByRole("button", { name: "Посмотреть" });
    expect(screen.queryByRole("button", { name: "Восстановить" })).not.toBeInTheDocument();
  });
});

describe("task pages", () => {
  it("shows a task with its description and the place in the scenario", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask());
    await renderApp("/t/1", users.viewer);
    expect(await screen.findByRole("heading", { level: 2, name: "#1 Спрайт мужчины без лица" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Семь посетителей › Мужчина: «Комбо без прошлого.»" })).toHaveAttribute(
      "href",
      "/s/ff#FF-V01-01",
    );
    expect(screen.getByText(/Размыть лицо\.\s+Четыре ракурса\./)).toHaveClass("task-desc");
    expect(screen.getByText("Не начато")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Править" })).not.toBeInTheDocument();
  });

  it("changes status and assignee on the task page", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask());
    const setStatus = vi.spyOn(api, "setTaskStatus").mockResolvedValue(makeTask({ status: "review" }));
    const assign = vi
      .spyOn(api, "setAssignee")
      .mockResolvedValue(makeTask({ assignee: { id: 2, username: "editor", display_name: "Редактор" } }));
    await renderApp("/t/1", users.editor);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Статус задачи" }), "review");
    expect(setStatus).toHaveBeenCalledWith(1, "review");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Исполнитель" }), "2");
    expect(assign).toHaveBeenCalledWith(1, 2);
  });

  it("rejects addresses that are not task numbers", async () => {
    await renderApp("/t/FF-V01", users.viewer);
    expect(await screen.findByRole("alert")).toHaveTextContent("Задача не найдена");
  });

  it("edits a task: text, kind, assignee and the place in the scenario", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask({ section_slug: null, anchor: null, anchor_label: "", page: null }));
    vi.spyOn(api, "section").mockResolvedValue(makeSection().children[0]);
    const update = vi.spyOn(api, "updateTask").mockResolvedValue(makeTask({ version: 2 }));
    const assign = vi.spyOn(api, "setAssignee").mockResolvedValue(makeTask({ version: 2 }));
    await renderApp("/t/1/edit", users.editor);
    const form = await screen.findByRole("form", { name: "Правка задачи" });
    fireEvent.change(within(form).getByLabelText("Название"), { target: { value: "Спрайт (v2)" } });
    fireEvent.change(within(form).getByLabelText("Описание"), { target: { value: "Только вариант A" } });
    await userEvent.selectOptions(within(form).getByLabelText("Тип"), "design");
    await userEvent.selectOptions(within(form).getByLabelText("Исполнитель"), "2");
    await userEvent.selectOptions(within(form).getByLabelText("Раздел"), "ff-visitors");
    const place = within(form).getByLabelText("Место в разделе");
    await waitFor(() => expect(place).toBeEnabled());
    await userEvent.selectOptions(place, "FF-V01-01");
    await userEvent.click(within(form).getByRole("button", { name: "Сохранить" }));
    expect(update).toHaveBeenCalledWith(1, {
      version: 1,
      title: "Спрайт (v2)",
      content: "Только вариант A",
      kind: "design",
      section_slug: "ff-visitors",
      anchor: "FF-V01-01",
      anchor_label: "Мужчина: «Комбо без прошлого.»",
    });
    expect(assign).toHaveBeenCalledWith(1, 2);
    expect(await screen.findByRole("heading", { level: 2, name: /#1/ })).toBeInTheDocument();
  });

  it("keeps a place that is no longer in the text and can clear it", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask({ anchor: "gone", anchor_label: "Удалённая реплика" }));
    vi.spyOn(api, "section").mockResolvedValue(makeSection().children[0]);
    const update = vi.spyOn(api, "updateTask").mockResolvedValue(makeTask({ version: 2 }));
    await renderApp("/t/1/edit", users.editor);
    const place = await screen.findByLabelText("Место в разделе");
    await waitFor(() => expect(place).toHaveDisplayValue("Удалённая реплика (нет в тексте)"));
    await userEvent.selectOptions(screen.getByLabelText("Раздел"), "");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ section_slug: null, anchor: null, anchor_label: "" }));
  });

  it("handles edit conflicts on tasks", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask());
    vi.spyOn(api, "section").mockResolvedValue(makeSection().children[0]);
    const update = vi
      .spyOn(api, "updateTask")
      .mockRejectedValueOnce(new ApiError(409, "Запись уже изменил другой участник", { message: "x", current_version: 4 }))
      .mockResolvedValueOnce(makeTask({ version: 5 }));
    await renderApp("/t/1/edit", users.editor);
    fireEvent.change(await screen.findByLabelText("Название"), { target: { value: "моё" } });
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Запись уже изменил другой участник");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить поверх чужой правки" }));
    expect(update).toHaveBeenLastCalledWith(1, expect.objectContaining({ version: 4, title: "моё" }));
  });

  it("shows task history as plain text", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask());
    vi.spyOn(api, "taskRevisions").mockResolvedValue([
      { id: 7, version: 1, title: "Старое", content: "<b>не HTML</b>", created_at: "2026-10-01T10:00:00Z", author: null },
    ]);
    const restore = vi.spyOn(api, "restoreTask").mockResolvedValue(makeTask());
    await renderApp("/t/1/history", users.editor);
    await userEvent.click(await screen.findByRole("button", { name: "Посмотреть" }));
    expect(screen.getByText("<b>не HTML</b>")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Восстановить" }));
    expect(restore).toHaveBeenCalledWith(1, 7);
  });

  it("lets admins delete tasks", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask());
    const del = vi.spyOn(api, "deleteTask").mockResolvedValue(undefined);
    await renderApp("/t/1", users.admin);
    await userEvent.click(await screen.findByRole("button", { name: "Удалить задачу" }));
    await userEvent.click(screen.getByRole("button", { name: "Да, удалить" }));
    expect(del).toHaveBeenCalledWith(1);
    expect(await screen.findByRole("heading", { name: "Доска задач" })).toBeInTheDocument();
  });
});

describe("new sections", () => {
  it("validates new section slugs before calling the API", async () => {
    const create = vi.spyOn(api, "createSection");
    await renderApp("/new/section?parent=ff", users.editor);
    await userEvent.type(screen.getByLabelText("Название"), "Плац");
    await userEvent.type(screen.getByLabelText(/Адрес/), "плац");
    await userEvent.click(screen.getByRole("button", { name: "Создать и перейти к тексту" }));
    expect(screen.getByRole("alert")).toHaveTextContent("латинские строчные");
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a sub-section", async () => {
    const create = vi.spyOn(api, "createSection").mockResolvedValue(makeSection({ slug: "ff-plac" }));
    vi.spyOn(api, "section").mockResolvedValue(makeSection({ slug: "ff-plac" }));
    await renderApp("/new/section?parent=ff", users.editor);
    await userEvent.type(screen.getByLabelText("Название"), "Плац");
    await userEvent.type(screen.getByLabelText(/Адрес/), "ff-plac");
    await userEvent.click(screen.getByRole("button", { name: "Создать и перейти к тексту" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ slug: "ff-plac", title: "Плац", parent_slug: "ff" }));
  });
});
