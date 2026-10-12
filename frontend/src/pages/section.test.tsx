import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import { makeSection, makeTask, renderApp, users } from "../test/utils";

describe("SectionPage", () => {
  it("renders a section with sub-sections and embedded task cards", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    await renderApp("/s/ff", users.viewer);
    expect(await screen.findByRole("heading", { level: 2, name: "Сон 1: Фастфуд" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Семь посетителей" })).toBeInTheDocument();
    const card = document.getElementById("ff-v01")!;
    expect(within(card).getByText("Мужчина без лица")).toBeInTheDocument();
    expect(within(card).getByText("Комбо без прошлого.")).toBeInTheDocument();
  });

  it("is read-only for viewers", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    await renderApp("/s/ff", users.viewer);
    await screen.findByRole("heading", { level: 2 });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Править текст" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Править" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Расписано полностью").length).toBeGreaterThan(0);
    expect(screen.getByText("Не начато")).toBeInTheDocument();
    expect(screen.getByText("Без исполнителя")).toBeInTheDocument();
  });

  it("lets the team change task status and refreshes progress", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    const setStatus = vi.spyOn(api, "setTaskStatus").mockResolvedValue(makeTask({ status: "done" }));
    await renderApp("/s/ff", users.editor);
    const select = await screen.findByRole("combobox", { name: "Статус FF-V01" });
    const progressCalls = vi.mocked(api.progress).mock.calls.length;
    await userEvent.selectOptions(select, "done");
    expect(setStatus).toHaveBeenCalledWith("FF-V01", "done");
    await waitFor(() => expect(document.getElementById("ff-v01")).toHaveClass("is-done"));
    expect(vi.mocked(api.progress).mock.calls.length).toBeGreaterThan(progressCalls);
  });

  it("shows an inline error when a status change is rejected", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    vi.spyOn(api, "setTaskStatus").mockRejectedValue(new ApiError(403, "Недостаточно прав"));
    await renderApp("/s/ff", users.editor);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Статус FF-V01" }), "review");
    expect(await screen.findByRole("alert")).toHaveTextContent("Недостаточно прав");
  });

  it("assigns a team member", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    const assign = vi
      .spyOn(api, "setAssignee")
      .mockResolvedValue(makeTask({ assignee: { id: 2, username: "editor", display_name: "Редактор" } }));
    await renderApp("/s/ff", users.editor);
    const card = await waitFor(() => document.getElementById("ff-v01")!);
    await userEvent.selectOptions(within(card).getByRole("combobox", { name: "Исполнитель" }), "2");
    expect(assign).toHaveBeenCalledWith("FF-V01", 2);
  });

  it("changes the section status and reloads the navigation", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    const setStatus = vi.spyOn(api, "setSectionStatus").mockResolvedValue({ ...makeSection(), status: "part" });
    await renderApp("/s/ff", users.editor);
    const [top] = await screen.findAllByRole("combobox", { name: "Статус раздела" });
    const treeCalls = vi.mocked(api.sectionTree).mock.calls.length;
    await userEvent.selectOptions(top, "part");
    expect(setStatus).toHaveBeenCalledWith("ff", "part");
    await waitFor(() => expect(vi.mocked(api.sectionTree).mock.calls.length).toBeGreaterThan(treeCalls));
  });

  it("appends tasks that are not embedded in the text", async () => {
    const section = makeSection({ children: [], content: "<p>Пусто</p>", tasks: [makeTask({ code: "NEW-1", title: "Новая" })] });
    vi.spyOn(api, "section").mockResolvedValue(section);
    await renderApp("/s/ff", users.viewer);
    expect(await screen.findByText("Новая")).toBeInTheDocument();
  });

  it("links placeholders of tasks from other sections", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection({ children: [], content: '<div data-task="X-9"></div>' }));
    await renderApp("/s/ff", users.viewer);
    expect(await screen.findByRole("link", { name: "Задача X-9 →" })).toHaveAttribute("href", "/t/X-9");
  });

  it("redirects sub-sections to their parent page", async () => {
    const child = makeSection().children[0];
    vi.spyOn(api, "section").mockImplementation(async (slug) => (slug === "ff" ? makeSection() : child));
    await renderApp("/s/ff-visitors", users.viewer);
    expect(await screen.findByRole("heading", { level: 2, name: "Сон 1: Фастфуд" })).toBeInTheDocument();
  });

  it("shows load errors", async () => {
    vi.spyOn(api, "section").mockRejectedValue(new ApiError(404, "Раздел не найден"));
    await renderApp("/s/nope", users.viewer);
    expect(await screen.findByRole("alert")).toHaveTextContent("Раздел не найден");
  });

  it("lets admins delete a section after confirmation", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection({ children: [] }));
    const del = vi.spyOn(api, "deleteSection").mockResolvedValue(undefined);
    await renderApp("/s/ff", users.admin);
    await userEvent.click(await screen.findByRole("button", { name: "Удалить" }));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Да, удалить" }));
    expect(del).toHaveBeenCalledWith("ff");
    expect(await screen.findByRole("heading", { name: "Прогресс" })).toBeInTheDocument();
  });
});
