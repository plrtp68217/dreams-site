import { fireEvent, screen, waitFor } from "@testing-library/react";
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
    fireEvent.change(textarea(), { target: { value: '<p>Новый текст</p><div data-task="FF-V01"></div>' } });
    const preview = screen.getByTestId("preview");
    expect(preview).toHaveTextContent("Новый текст");
    expect(preview).toHaveTextContent("Здесь будет карточка задачи FF-V01");

    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(update).toHaveBeenCalledWith("ff", {
      version: 3,
      title: "Сон 1: Фастфуд",
      content: '<p>Новый текст</p><div data-task="FF-V01"></div>',
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

describe("tasks editing", () => {
  it("edits a task, including its kind and section", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask());
    const update = vi.spyOn(api, "updateTask").mockResolvedValue(makeTask({ version: 2, section_slug: "items" }));
    vi.spyOn(api, "section").mockResolvedValue(makeSection({ slug: "items", title: "Предметы", children: [] }));
    await renderApp("/t/FF-V01/edit", users.editor);
    await screen.findByRole("toolbar");
    expect(screen.queryByRole("button", { name: "Задача" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Заголовок"), { target: { value: "Мужчина без лица (v2)" } });
    await userEvent.selectOptions(screen.getByLabelText("Тип"), "art");
    await userEvent.selectOptions(screen.getByLabelText("Раздел сценария"), "items");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(update).toHaveBeenCalledWith("FF-V01", expect.objectContaining({
      version: 1,
      title: "Мужчина без лица (v2)",
      kind: "art",
      section_slug: "items",
    }));
  });

  it("creates a task with an assignee", async () => {
    const create = vi.spyOn(api, "createTask").mockResolvedValue(makeTask({ code: "AC-V01" }));
    vi.spyOn(api, "task").mockResolvedValue(makeTask({ code: "AC-V01" }));
    await renderApp("/new/task?section=ff-visitors", users.editor);
    await userEvent.type(screen.getByLabelText("Код"), "ac-v01");
    await userEvent.type(screen.getByLabelText("Название"), "Особист");
    await userEvent.selectOptions(screen.getByLabelText("Исполнитель"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Создать и перейти к тексту" }));
    expect(create).toHaveBeenCalledWith({
      code: "AC-V01",
      title: "Особист",
      kind: "quest",
      section_slug: "ff-visitors",
      assignee_id: 2,
      content: "<p></p>",
    });
  });

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

  it("lets admins delete tasks", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask());
    const del = vi.spyOn(api, "deleteTask").mockResolvedValue(undefined);
    await renderApp("/t/FF-V01/edit", users.admin);
    await userEvent.click(await screen.findByRole("button", { name: "Удалить задачу" }));
    await userEvent.click(screen.getByRole("button", { name: "Да, удалить" }));
    expect(del).toHaveBeenCalledWith("FF-V01");
  });

  it("shows a single task page", async () => {
    vi.spyOn(api, "task").mockResolvedValue(makeTask());
    await renderApp("/t/FF-V01", users.viewer);
    expect(await screen.findByRole("link", { name: "← Открыть в сценарии" })).toHaveAttribute("href", "/s/ff#ff-v01");
  });
});
