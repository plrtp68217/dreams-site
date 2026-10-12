import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { api, tokenStore } from "../api/client";
import type { Progress, Section, SectionNode, Task, User } from "../api/types";
import { AppRoutes } from "../App";
import { AuthProvider } from "../auth/AuthContext";
import { LightboxProvider } from "../components/Lightbox";

export const users: Record<"admin" | "editor" | "viewer", User> = {
  admin: { id: 1, username: "admin", display_name: "Админ", role: "admin", is_active: true, created_at: "2026-10-01T10:00:00Z" },
  editor: { id: 2, username: "editor", display_name: "Редактор", role: "editor", is_active: true, created_at: "2026-10-02T10:00:00Z" },
  viewer: { id: 3, username: "viewer", display_name: "Зритель", role: "viewer", is_active: true, created_at: "2026-10-03T10:00:00Z" },
};

export const tree: SectionNode[] = [
  { id: 1, slug: "overview", title: "Об игре", group: "main", status: "done", position: 0, parent_slug: null, children: [] },
  {
    id: 2,
    slug: "ff",
    title: "Сон 1: Фастфуд",
    group: "levels",
    status: "done",
    position: 1,
    parent_slug: null,
    children: [
      { id: 3, slug: "ff-visitors", title: "Семь посетителей", group: "levels", status: "done", position: 0, parent_slug: "ff", children: [] },
    ],
  },
  { id: 4, slug: "items", title: "Предметы", group: "reference", status: "part", position: 2, parent_slug: null, children: [] },
];

export function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    code: "FF-V01",
    title: "Мужчина без лица",
    kind: "quest",
    status: "todo",
    section_slug: "ff-visitors",
    assignee: null,
    content: '<div class="line" data-id="FF-V01-01"><span class="who">Мужчина</span><q>Комбо без прошлого.</q></div>',
    position: 0,
    version: 1,
    updated_at: "2026-10-10T10:00:00Z",
    updated_by: null,
    ...over,
  };
}

export function makeSection(over: Partial<Section> = {}): Section {
  return {
    id: 2,
    slug: "ff",
    title: "Сон 1: Фастфуд",
    group: "levels",
    status: "done",
    position: 1,
    parent_slug: null,
    content: '<p class="lede">Ева за кассой.</p>',
    version: 3,
    updated_at: "2026-10-10T10:00:00Z",
    updated_by: { id: 2, username: "editor", display_name: "Редактор" },
    tasks: [],
    children: [
      {
        id: 3,
        slug: "ff-visitors",
        title: "Семь посетителей",
        group: "levels",
        status: "done",
        position: 0,
        parent_slug: "ff",
        content: '<p>Порядок фиксированный.</p><div data-task="FF-V01"></div>',
        version: 1,
        updated_at: "2026-10-10T10:00:00Z",
        updated_by: null,
        tasks: [makeTask()],
        children: [],
      },
    ],
    ...over,
  };
}

export const progress: Progress = { total: 4, done: 1, by_status: { todo: 2, in_progress: 1, review: 0, done: 1 } };

/** Stub the endpoints every authenticated page touches. */
export function mockBaseApi(user: User | null) {
  if (user) tokenStore.set("test-token");
  vi.spyOn(api, "me").mockResolvedValue(user as User);
  vi.spyOn(api, "sectionTree").mockResolvedValue(tree);
  vi.spyOn(api, "progress").mockResolvedValue(progress);
  vi.spyOn(api, "users").mockResolvedValue([users.admin, users.editor]);
  vi.spyOn(api, "site").mockResolvedValue({ hero: "/media/hero.jpg", allow_registration: true });
  vi.spyOn(api, "activity").mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(api, "tasks").mockResolvedValue([]);
}

/** Render the whole app at `route`; `setup` runs after the base stubs so it can override them. */
export async function renderApp(route: string, user: User | null = users.editor, setup?: () => void) {
  mockBaseApi(user);
  setup?.();
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <LightboxProvider>
          <AppRoutes />
        </LightboxProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  if (user) await screen.findByText(user.display_name, { selector: ".userbox b" });
  return result;
}
