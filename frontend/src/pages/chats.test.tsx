import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Chat, ChatMessage } from "../api/types";
import { chatName } from "../lib/chats";
import { renderApp, users } from "../test/utils";

const me = { id: 2, username: "editor", display_name: "Редактор" };
const admin = { id: 1, username: "admin", display_name: "Админ" };

function chat(over: Partial<Chat> = {}): Chat {
  return {
    id: 5,
    title: "",
    members: [me, admin],
    created_by: me,
    created_at: "2026-10-12T10:00:00Z",
    last_activity_at: "2026-10-12T11:00:00Z",
    last_message: { id: 9, text: "Глянь спрайт", created_at: "2026-10-12T11:00:00Z", author: admin },
    unread: 2,
    ...over,
  };
}

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 9,
    chat_id: 5,
    text: "Глянь **спрайт**",
    html: "<p>Глянь <strong>спрайт</strong></p>",
    created_at: "2026-10-12T11:00:00Z",
    author: admin,
    ...over,
  };
}

describe("chatName", () => {
  it("uses the title or the other members", () => {
    expect(chatName(chat({ title: "Арт" }), 2)).toBe("Арт");
    expect(chatName(chat(), 2)).toBe("Админ");
    expect(chatName(chat({ members: [me] }), 2)).toBe("Только вы");
  });
});

describe("chats", () => {
  it("shows the unread badge in the sidebar for the team only", async () => {
    await renderApp("/", users.editor, () => vi.mocked(api.chatUnread).mockResolvedValue({ messages: 3, chats: 1 }));
    const link = await screen.findByRole("link", { name: /Чаты/ });
    expect(link).toHaveAttribute("href", "/chats");
    await waitFor(() => expect(within(link).getByLabelText("Непрочитанных сообщений: 3")).toBeInTheDocument());
  });

  it("is closed to viewers", async () => {
    await renderApp("/chats", users.viewer);
    expect(screen.queryByRole("link", { name: /Чаты/ })).not.toBeInTheDocument();
    expect(screen.getByText("Чаты доступны только участникам команды.")).toBeInTheDocument();
    expect(api.chatUnread).not.toHaveBeenCalled();
  });

  it("lists chats, opens one, marks it read and sends a message", async () => {
    vi.spyOn(api, "chatMessages").mockResolvedValue([message()]);
    const read = vi.spyOn(api, "markChatRead").mockResolvedValue(undefined);
    const send = vi.spyOn(api, "sendMessage").mockResolvedValue(
      message({ id: 10, author: me, text: "Смотрю", html: "<p>Смотрю</p>" }),
    );
    await renderApp("/chats", users.editor, () => vi.mocked(api.chats).mockResolvedValue([chat()]));
    const list = await screen.findByRole("navigation", { name: "Чаты" });
    const item = await within(list).findByRole("link", { name: /Админ/ });
    expect(item).toHaveTextContent("Глянь спрайт");
    expect(within(item).getByLabelText("Непрочитанных: 2")).toBeInTheDocument();

    await userEvent.click(item);
    const view = await screen.findByRole("region", { name: "Админ" });
    const shown = await within(view).findByRole("list", { name: "Сообщения" });
    expect(within(shown).getByText("спрайт").tagName).toBe("STRONG");
    expect(api.chatMessages).toHaveBeenCalledWith(5, { limit: 50 });
    await waitFor(() => expect(read).toHaveBeenCalledWith(5, 9));
    // someone else's message cannot be deleted
    expect(within(shown).queryByRole("button", { name: "Удалить" })).not.toBeInTheDocument();

    const box = within(view).getByLabelText("Сообщение");
    await userEvent.type(box, "Смотрю{Enter}");
    expect(send).toHaveBeenCalledWith(5, "Смотрю");
    await waitFor(() => expect(within(shown).getAllByRole("listitem")).toHaveLength(2));
    expect(box).toHaveValue("");
    expect(within(shown).getAllByRole("listitem")[1]).toHaveClass("mine");
  });

  it("keeps Shift+Enter as a new line", async () => {
    vi.spyOn(api, "chatMessages").mockResolvedValue([]);
    const send = vi.spyOn(api, "sendMessage");
    await renderApp("/chats/5", users.editor, () => vi.mocked(api.chats).mockResolvedValue([chat({ unread: 0 })]));
    const box = await screen.findByLabelText("Сообщение");
    await userEvent.type(box, "раз{Shift>}{Enter}{/Shift}два");
    expect(box).toHaveValue("раз\nдва");
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByText("Сообщений пока нет — напишите первым.")).toBeInTheDocument();
  });

  it("creates a chat with chosen members", async () => {
    vi.spyOn(api, "chatMessages").mockResolvedValue([]);
    const created = chat({ id: 8, title: "Арт", last_message: null, unread: 0 });
    const create = vi.spyOn(api, "createChat").mockResolvedValue(created);
    await renderApp("/chats", users.editor);
    await userEvent.click(await screen.findByRole("button", { name: "+ Новый чат" }));
    const form = screen.getByRole("form", { name: "Новый чат" });
    expect(within(form).getByRole("button", { name: "Создать" })).toBeDisabled();
    // the creator is not offered: they are in the chat anyway
    expect(within(form).queryByLabelText("Редактор")).not.toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText("Название"), "Арт");
    await userEvent.click(await within(form).findByLabelText("Админ"));
    await userEvent.click(within(form).getByRole("button", { name: "Создать" }));
    expect(create).toHaveBeenCalledWith({ title: "Арт", member_ids: [1] });
    expect(await screen.findByRole("region", { name: "Арт" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Арт/ })).toHaveClass("active");
  });

  it("deletes own messages and manages members", async () => {
    vi.spyOn(api, "chatMessages").mockResolvedValue([message({ author: me })]);
    vi.spyOn(api, "markChatRead").mockResolvedValue(undefined);
    const del = vi.spyOn(api, "deleteMessage").mockResolvedValue(undefined);
    const rename = vi.spyOn(api, "renameChat").mockResolvedValue(chat({ title: "Звук", unread: 0 }));
    await renderApp("/chats/5", users.editor, () => vi.mocked(api.chats).mockResolvedValue([chat({ unread: 0 })]));
    const view = await screen.findByRole("region", { name: "Админ" });
    await userEvent.click(await within(view).findByRole("button", { name: "Удалить" }));
    expect(del).toHaveBeenCalledWith(5, 9);
    await waitFor(() => expect(within(view).queryByRole("listitem")).not.toBeInTheDocument());

    await userEvent.click(within(view).getByRole("button", { name: "Участники (2)" }));
    const members = within(view).getByRole("region", { name: "Участники чата" });
    // the creator may remove others
    expect(within(members).getByRole("button", { name: "Убрать" })).toBeInTheDocument();
    await userEvent.type(within(members).getByLabelText("Название"), "Звук");
    await userEvent.click(within(members).getByRole("button", { name: "Переименовать" }));
    expect(rename).toHaveBeenCalledWith(5, "Звук");
    expect(await screen.findByRole("region", { name: "Звук" })).toBeInTheDocument();
  });
});
