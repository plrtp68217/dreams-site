import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Chat, ChatMessage } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ScenarioContent } from "../components/ScenarioContent";
import {
  chatName,
  CHATS_POLL_MS,
  isDirect,
  MESSAGES_POLL_MS,
  notifyChatsRead,
  usePolling,
} from "../lib/chats";
import { formatDate, relativeTime } from "../lib/labels";
import { useScenario } from "../lib/ScenarioContext";

const PAGE = 50;

function NewChatForm({ onCreated, onCancel }: { onCreated: (chat: Chat) => void; onCancel: () => void }) {
  const { user } = useAuth();
  const { team, reloadTeam } = useScenario();
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = team.filter((u) => u.id !== user?.id);

  useEffect(() => {
    void reloadTeam();
  }, [reloadTeam]);

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onCreated(await api.createChat({ title, member_ids: picked }));
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <form className="chat-new" onSubmit={submit} aria-label="Новый чат">
      <label className="field">
        <span>Название</span>
        <input
          className="input"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={picked.length > 1 ? "Например: Арт для сна 1" : "Без названия — личная переписка"}
        />
      </label>
      <fieldset className="chat-pick">
        <legend>Участники</legend>
        {others.length === 0 && <p className="muted small">В команде пока больше никого нет.</p>}
        {others.map((u) => (
          <label key={u.id} className="check">
            <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} />
            {u.display_name}
          </label>
        ))}
      </fieldset>
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={saving || picked.length === 0}>
          {saving ? "Создание…" : "Создать"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function ChatList({ chats, onNew }: { chats: Chat[] | null; onNew: () => void }) {
  const { user } = useAuth();
  return (
    <nav className="chat-list" aria-label="Чаты">
      <button type="button" className="btn primary" onClick={onNew}>
        + Новый чат
      </button>
      {chats?.length === 0 && <p className="muted small">Чатов пока нет. Создайте первый и позовите в него команду.</p>}
      <ul>
        {chats?.map((c) => (
          <li key={c.id}>
            <NavLink to={`/chats/${c.id}`} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="chat-list-head">
                <b>{chatName(c, user?.id)}</b>
                {c.unread > 0 && (
                  <span className="unread" aria-label={`Непрочитанных: ${c.unread}`}>
                    {c.unread}
                  </span>
                )}
              </span>
              <span className="chat-list-last">
                {c.last_message ? (
                  <>
                    {c.last_message.author && !isDirect(c) && `${c.last_message.author.display_name}: `}
                    {c.last_message.author?.id === user?.id && isDirect(c) && "Вы: "}
                    {c.last_message.text}
                  </>
                ) : (
                  "Сообщений пока нет"
                )}
              </span>
              <time dateTime={c.last_activity_at}>{relativeTime(c.last_activity_at)}</time>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Members({ chat, onChange, onLeft }: { chat: Chat; onChange: (chat: Chat) => void; onLeft: () => void }) {
  const { user, isAdmin } = useAuth();
  const { team } = useScenario();
  const [title, setTitle] = useState(chat.title);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canRemove = isAdmin || chat.created_by?.id === user?.id;
  const outside = team.filter((u) => !chat.members.some((m) => m.id === u.id));

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="chat-members" aria-label="Участники чата">
      <form
        className="btn-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => onChange(await api.renameChat(chat.id, title)));
        }}
      >
        <label className="inline-field">
          Название
          <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <button type="submit" className="btn small" disabled={title.trim() === chat.title}>
          Переименовать
        </button>
      </form>
      <ul>
        {chat.members.map((m) => (
          <li key={m.id}>
            {m.display_name}
            {m.id === chat.created_by?.id && <span className="muted small"> · создал(а) чат</span>}
            {canRemove && m.id !== user?.id && (
              <button
                type="button"
                className="btn small link-btn"
                onClick={() =>
                  run(async () => {
                    await api.removeChatMember(chat.id, m.id);
                    onChange({ ...chat, members: chat.members.filter((x) => x.id !== m.id) });
                  })
                }
              >
                Убрать
              </button>
            )}
          </li>
        ))}
      </ul>
      {outside.length > 0 && (
        <form
          className="btn-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!adding) return;
            void run(async () => {
              onChange(await api.addChatMembers(chat.id, [Number(adding)]));
              setAdding("");
            });
          }}
        >
          <select className="select" aria-label="Добавить участника" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Добавить участника…</option>
            {outside.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn small" disabled={!adding}>
            Добавить
          </button>
        </form>
      )}
      <button
        type="button"
        className="btn small danger"
        onClick={() =>
          run(async () => {
            if (!window.confirm("Выйти из чата? Вернуть вас сможет только другой участник.")) return;
            await api.removeChatMember(chat.id, user!.id);
            onLeft();
          })
        }
      >
        Выйти из чата
      </button>
      {error && <div className="error-box" role="alert">{error}</div>}
    </section>
  );
}

function Composer({ chatId, onSent }: { chatId: number; onSent: (m: ChatMessage) => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      onSent(await api.sendMessage(chatId, text));
      setText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <form
      className="chat-composer"
      aria-label="Новое сообщение"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {error && <div className="error-box" role="alert">{error}</div>}
      <textarea
        className="textarea plain"
        aria-label="Сообщение"
        placeholder="Сообщение… Enter — отправить, Shift+Enter — новая строка, **Markdown** работает"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
      />
      <button type="submit" className="btn primary" disabled={saving || !text.trim()}>
        Отправить
      </button>
    </form>
  );
}

function ChatView({
  chat,
  onChatChange,
  onLeft,
  onActivity,
}: {
  chat: Chat;
  onChatChange: (chat: Chat) => void;
  onLeft: () => void;
  /** New messages arrived or were sent: refresh the list order and unread counts. */
  onActivity: () => void;
}) {
  const { user, isAdmin } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const keepOffset = useRef<number | null>(null);
  const lastId = messages?.length ? messages[messages.length - 1].id : 0;
  const read = useRef(0);

  useEffect(() => {
    let alive = true;
    setMessages(null);
    setError(null);
    setShowMembers(false);
    stickToBottom.current = true;
    read.current = 0;
    api.chatMessages(chat.id, { limit: PAGE }).then(
      (list) => {
        if (!alive) return;
        setMessages(list);
        setHasOlder(list.length === PAGE);
      },
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [chat.id]);

  // everything shown is read
  useEffect(() => {
    if (!lastId || lastId <= read.current || document.visibilityState === "hidden") return;
    read.current = lastId;
    api.markChatRead(chat.id, lastId).then(() => {
      notifyChatsRead();
      onActivity();
    }, () => {});
  }, [chat.id, lastId, onActivity]);

  const poll = useCallback(() => {
    if (messages === null) return;
    api.chatMessages(chat.id, { after: lastId }).then(
      (fresh) => {
        if (!fresh.length) return;
        setMessages((list) => {
          const known = new Set((list ?? []).map((m) => m.id));
          return [...(list ?? []), ...fresh.filter((m) => !known.has(m.id))];
        });
      },
      () => {
        /* try again on the next tick */
      },
    );
  }, [chat.id, lastId, messages]);
  usePolling(poll, MESSAGES_POLL_MS);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepOffset.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const loadOlder = async () => {
    if (!messages?.length) return;
    try {
      const older = await api.chatMessages(chat.id, { before: messages[0].id, limit: PAGE });
      if (scroller.current) keepOffset.current = scroller.current.scrollHeight - scroller.current.scrollTop;
      setHasOlder(older.length === PAGE);
      setMessages((list) => [...older, ...(list ?? [])]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (m: ChatMessage) => {
    try {
      await api.deleteMessage(chat.id, m.id);
      setMessages((list) => (list ?? []).filter((x) => x.id !== m.id));
      onActivity();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="chat-view" aria-label={chatName(chat, user?.id)}>
      <header className="chat-head">
        <Link className="chat-back" to="/chats">
          ← Чаты
        </Link>
        <div>
          <h2>{chatName(chat, user?.id)}</h2>
          <p className="muted small">{chat.members.map((m) => m.display_name).join(", ")}</p>
        </div>
        <button type="button" className="btn small" aria-expanded={showMembers} onClick={() => setShowMembers((s) => !s)}>
          Участники ({chat.members.length})
        </button>
      </header>
      {showMembers && <Members key={chat.id} chat={chat} onChange={onChatChange} onLeft={onLeft} />}
      {error && <div className="error-box" role="alert">{error}</div>}
      <div
        className="chat-messages"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {hasOlder && (
          <button type="button" className="btn small chat-older" onClick={loadOlder}>
            Показать более ранние
          </button>
        )}
        {messages === null && !error && <p className="loading">Загрузка…</p>}
        {messages?.length === 0 && <p className="muted">Сообщений пока нет — напишите первым.</p>}
        <ol aria-label="Сообщения">
          {messages?.map((m) => {
            const mine = m.author?.id === user?.id;
            return (
              <li key={m.id} className={`chat-msg${mine ? " mine" : ""}`}>
                <header>
                  <b>{m.author?.display_name ?? "Удалённый пользователь"}</b>
                  <time dateTime={m.created_at}>{formatDate(m.created_at)}</time>
                  {(mine || isAdmin) && (
                    <button type="button" className="btn small link-btn" onClick={() => remove(m)}>
                      Удалить
                    </button>
                  )}
                </header>
                <ScenarioContent html={m.html} className="content chat-body" />
              </li>
            );
          })}
        </ol>
      </div>
      <Composer
        chatId={chat.id}
        onSent={(m) => {
          stickToBottom.current = true;
          setMessages((list) => (list?.some((x) => x.id === m.id) ? list : [...(list ?? []), m]));
          onActivity();
        }}
      />
    </section>
  );
}

export function ChatsPage() {
  const { id } = useParams();
  const chatId = id ? Number(id) : null;
  const navigate = useNavigate();
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a chat opened by link that is not in the list yet (or the list has not loaded)
  const [opened, setOpened] = useState<Chat | null>(null);

  const reload = useCallback(async () => {
    try {
      setChats(await api.chats());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  usePolling(reload, CHATS_POLL_MS);

  const listed = chats?.find((c) => c.id === chatId) ?? null;
  useEffect(() => {
    if (chatId === null || listed || chats === null) return;
    let alive = true;
    api.chat(chatId).then(
      (c) => alive && setOpened(c),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [chatId, listed, chats]);

  const current = listed ?? (opened?.id === chatId ? opened : null);

  const replace = (chat: Chat) => {
    setOpened(chat);
    setChats((list) => (list ?? []).map((c) => (c.id === chat.id ? { ...c, ...chat, unread: c.unread } : c)));
  };

  return (
    <div className={`chats${chatId !== null ? " has-chat" : ""}`}>
      <div className="chats-side">
        <h2>Чаты</h2>
        {creating ? (
          <NewChatForm
            onCancel={() => setCreating(false)}
            onCreated={(chat) => {
              setCreating(false);
              setOpened(chat);
              setChats((list) => [chat, ...(list ?? []).filter((c) => c.id !== chat.id)]);
              navigate(`/chats/${chat.id}`);
            }}
          />
        ) : (
          <ChatList chats={chats} onNew={() => setCreating(true)} />
        )}
      </div>
      <div className="chats-main">
        {error && <div className="error-box" role="alert">{error}</div>}
        {current ? (
          <ChatView
            chat={current}
            onChatChange={replace}
            onActivity={reload}
            onLeft={() => {
              setChats((list) => (list ?? []).filter((c) => c.id !== current.id));
              navigate("/chats");
            }}
          />
        ) : (
          chatId === null && (
            <p className="lede chats-empty">
              Переписка команды: выберите чат слева или создайте новый — личный с одним человеком или общий для
              нескольких. Видят чат только его участники.
            </p>
          )
        )}
      </div>
    </div>
  );
}
