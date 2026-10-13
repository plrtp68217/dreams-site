import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import { brief, makeSection, renderApp, users } from "../test/utils";

function sectionWithTasks() {
  const section = makeSection();
  section.children[0].tasks = [
    brief({ id: 3, title: "Спрайт мужчины", status: "in_progress", assignee: { id: 2, username: "editor", display_name: "Редактор" } }),
    brief({ id: 4, title: "Озвучка записки", anchor: "p-note", anchor_label: "Записка: «Ты уже была здесь»" }),
  ];
  return section;
}

describe("SectionPage", () => {
  it("renders a section with sub-sections and the former task cards as part of the text", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    await renderApp("/s/ff", users.viewer);
    expect(await screen.findByRole("heading", { level: 2, name: "Сон 1: Фастфуд" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Семь посетителей" })).toBeInTheDocument();
    const card = document.getElementById("ff-v01")!;
    expect(within(card).getByText("Мужчина без лица")).toBeInTheDocument();
    expect(within(card).getByText("Комбо без прошлого.")).toBeInTheDocument();
  });

  it("is read-only for viewers", async () => {
    vi.spyOn(api, "section").mockResolvedValue(sectionWithTasks());
    await renderApp("/s/ff", users.viewer);
    await screen.findByRole("heading", { level: 2 });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Править текст" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "+ задача" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Расписано полностью").length).toBeGreaterThan(0);
    // existing tasks are still visible
    expect(screen.getAllByRole("link", { name: "#3" })[0]).toHaveAttribute("href", "/t/3");
  });

  it("lets the team create a task right from a line of dialogue", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    await renderApp("/s/ff", users.editor);
    await screen.findByRole("heading", { level: 2 });
    const line = document.querySelector('[data-id="FF-V01-01"]') as HTMLElement;
    expect(within(line).getByRole("link", { name: "+ задача" })).toHaveAttribute(
      "href",
      "/tasks?new=1&at=ff-visitors&anchor=FF-V01-01",
    );
    expect(screen.getAllByRole("link", { name: "+ Задача" })[0]).toHaveAttribute("href", "/tasks?new=1&at=ff");
  });

  it("marks places that have tasks and lists the section's tasks", async () => {
    vi.spyOn(api, "section").mockResolvedValue(sectionWithTasks());
    await renderApp("/s/ff", users.viewer);
    const list = await screen.findByRole("complementary", { name: "Задачи: Семь посетителей" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByRole("link", { name: "#3 Спрайт мужчины" })).toHaveAttribute("href", "/t/3");
    expect(within(items[0]).getByText("В работе")).toBeInTheDocument();
    expect(within(items[0]).getByText("Редактор")).toBeInTheDocument();
    expect(within(items[1]).getByRole("link", { name: /Записка: «Ты уже была здесь»/ })).toHaveAttribute(
      "href",
      "/s/ff#p-note",
    );
    const note = document.querySelector('[data-id="p-note"]') as HTMLElement;
    expect(within(note).getByRole("link", { name: "#4" })).toBeInTheDocument();
  });

  it("scrolls to and highlights the place a task points at", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    await renderApp("/s/ff#FF-V01-01", users.viewer);
    await screen.findByRole("heading", { level: 2 });
    await waitFor(() => expect(document.querySelector('[data-id="FF-V01-01"]')).toHaveClass("flash"));
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

  it("shows an inline error when a status change is rejected", async () => {
    vi.spyOn(api, "section").mockResolvedValue(makeSection());
    vi.spyOn(api, "setSectionStatus").mockRejectedValue(new ApiError(403, "Недостаточно прав"));
    await renderApp("/s/ff", users.editor);
    const [top] = await screen.findAllByRole("combobox", { name: "Статус раздела" });
    await userEvent.selectOptions(top, "part");
    expect(await screen.findByRole("alert")).toHaveTextContent("Недостаточно прав");
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
