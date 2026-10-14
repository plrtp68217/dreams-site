import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Chat } from "../api/types";

/** How often an open chat asks for new messages, the chat list refreshes, and the sidebar counts unread. */
export const MESSAGES_POLL_MS = 3000;
export const CHATS_POLL_MS = 10000;
export const UNREAD_POLL_MS = 30000;

/** Fired when the user has read something, so the sidebar badge updates at once. */
export const CHATS_READ_EVENT = "dreams:chats-read";

export function notifyChatsRead() {
  window.dispatchEvent(new Event(CHATS_READ_EVENT));
}

/** A chat's title, or for an untitled one — who else is in it. */
export function chatName(chat: Pick<Chat, "title" | "members">, meId: number | undefined): string {
  if (chat.title) return chat.title;
  const others = chat.members.filter((m) => m.id !== meId).map((m) => m.display_name);
  return others.length ? others.join(", ") : "Только вы";
}

export function isDirect(chat: Pick<Chat, "title" | "members">): boolean {
  return !chat.title && chat.members.length === 2;
}

/** Calls `tick` every `ms` while the tab is visible, and right away when the tab becomes visible again. */
export function usePolling(tick: () => void, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (document.visibilityState !== "hidden") tick();
    };
    const timer = window.setInterval(run, ms);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [tick, ms, enabled]);
}

/** Unread messages in all chats, for the sidebar. */
export function useChatUnread(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      api.chatUnread().then(
        (u) => alive && setCount(u.messages),
        () => {
          /* the badge is a hint; ignore failures */
        },
      );
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && load(), UNREAD_POLL_MS);
    window.addEventListener(CHATS_READ_EVENT, load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(CHATS_READ_EVENT, load);
    };
  }, [enabled]);
  return enabled ? count : 0;
}
