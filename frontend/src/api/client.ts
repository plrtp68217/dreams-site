import type {
  ActivityPage,
  Chat,
  ChatMessage,
  ChatUnread,
  MemberSummary,
  Progress,
  Revision,
  Role,
  SearchHit,
  Section,
  SectionGroup,
  SectionNode,
  SectionStatus,
  SiteInfo,
  Task,
  TaskBrief,
  TaskComment,
  TaskKind,
  TaskPlace,
  TaskStatus,
  TokenResponse,
  User,
} from "./types";

const TOKEN_KEY = "snyi-token";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Called whenever the server rejects the stored token (expired, user disabled…). */
export function onUnauthorized(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable – keep the session in memory only */
    }
  },
};

function messageFrom(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message" in detail) return String((detail as { message: unknown }).message);
  if (Array.isArray(detail) && detail.length) {
    // FastAPI validation errors
    return detail.map((d: { msg?: string }) => d.msg ?? "").filter(Boolean).join("; ") || "Некорректные данные";
  }
  if (status >= 500) return "Ошибка сервера, попробуйте позже";
  return `Ошибка запроса (${status})`;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Query; form?: FormData } = {},
): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(url.pathname + url.search, { method: options.method ?? "GET", headers, body });
  } catch {
    throw new ApiError(0, "Нет связи с сервером");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token && unauthorizedHandler) unauthorizedHandler();
    const detail = (data as { detail?: unknown } | null)?.detail;
    throw new ApiError(res.status, messageFrom(res.status, data), detail);
  }
  return data as T;
}

const json = (method: string, body?: unknown) => ({ method, body });

export const api = {
  // auth
  site: () => request<SiteInfo>("/api/site"),
  login: (username: string, password: string) =>
    request<TokenResponse>("/api/auth/login", json("POST", { username, password })),
  register: (username: string, password: string, display_name?: string) =>
    request<TokenResponse>("/api/auth/register", json("POST", { username, password, display_name })),
  me: () => request<User>("/api/auth/me"),
  changePassword: (old_password: string, new_password: string) =>
    request<void>("/api/auth/change-password", json("POST", { old_password, new_password })),

  // users
  users: (teamOnly = false) => request<User[]>("/api/users", { query: { team_only: teamOnly || undefined } }),
  createUser: (data: { username: string; password: string; display_name?: string; role: Role }) =>
    request<User>("/api/users", json("POST", data)),
  updateUser: (id: number, data: Partial<Pick<User, "role" | "is_active" | "display_name">>) =>
    request<User>(`/api/users/${id}`, json("PATCH", data)),
  resetPassword: (id: number, password: string) =>
    request<void>(`/api/users/${id}/password`, json("POST", { password })),
  setAvatar: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<User>(`/api/users/${id}/avatar`, { method: "PUT", form });
  },
  removeAvatar: (id: number) => request<User>(`/api/users/${id}/avatar`, { method: "DELETE" }),

  // sections
  sectionTree: () => request<SectionNode[]>("/api/sections"),
  section: (slug: string) => request<Section>(`/api/sections/${encodeURIComponent(slug)}`),
  createSection: (data: {
    slug: string;
    title: string;
    group?: SectionGroup;
    parent_slug?: string | null;
    status?: SectionStatus;
    source?: string;
  }) => request<Section>("/api/sections", json("POST", data)),
  updateSection: (slug: string, data: { version: number; title?: string; source?: string }) =>
    request<Section>(`/api/sections/${encodeURIComponent(slug)}`, json("PATCH", data)),
  setSectionStatus: (slug: string, status: SectionStatus) =>
    request<Section>(`/api/sections/${encodeURIComponent(slug)}/status`, json("PUT", { status })),
  deleteSection: (slug: string) => request<void>(`/api/sections/${encodeURIComponent(slug)}`, { method: "DELETE" }),
  sectionRevisions: (slug: string) => request<Revision[]>(`/api/sections/${encodeURIComponent(slug)}/revisions`),
  restoreSection: (slug: string, revisionId: number) =>
    request<Section>(`/api/sections/${encodeURIComponent(slug)}/revisions/${revisionId}/restore`, { method: "POST" }),

  // tasks
  tasks: (filters: { status?: TaskStatus; kind?: TaskKind; section?: string; assignee_id?: number } = {}) =>
    request<TaskBrief[]>("/api/tasks", { query: filters }),
  progress: () => request<Progress>("/api/tasks/progress"),
  task: (id: number) => request<Task>(`/api/tasks/${id}`),
  createTask: (data: { title: string; kind: TaskKind; content: string; assignee_id: number | null } & TaskPlace) =>
    request<Task>("/api/tasks", json("POST", data)),
  updateTask: (
    id: number,
    data: { version: number; title?: string; content?: string; kind?: TaskKind } & Partial<TaskPlace>,
  ) => request<Task>(`/api/tasks/${id}`, json("PATCH", data)),
  setTaskStatus: (id: number, status: TaskStatus) => request<Task>(`/api/tasks/${id}/status`, json("PUT", { status })),
  setAssignee: (id: number, assignee_id: number | null) =>
    request<Task>(`/api/tasks/${id}/assignee`, json("PUT", { assignee_id })),
  setReviewer: (id: number, reviewer_id: number | null) =>
    request<Task>(`/api/tasks/${id}/reviewer`, json("PUT", { reviewer_id })),
  taskComments: (id: number) => request<TaskComment[]>(`/api/tasks/${id}/comments`),
  addComment: (id: number, data: { text: string; status?: TaskStatus | null; set_reviewer?: boolean }) =>
    request<{ comment: TaskComment; task: Task }>(`/api/tasks/${id}/comments`, json("POST", data)),
  deleteComment: (id: number, commentId: number) =>
    request<void>(`/api/tasks/${id}/comments/${commentId}`, { method: "DELETE" }),
  deleteTask: (id: number) => request<void>(`/api/tasks/${id}`, { method: "DELETE" }),
  taskRevisions: (id: number) => request<Revision[]>(`/api/tasks/${id}/revisions`),
  restoreTask: (id: number, revisionId: number) =>
    request<Task>(`/api/tasks/${id}/revisions/${revisionId}/restore`, { method: "POST" }),

  // chats
  chats: () => request<Chat[]>("/api/chats"),
  chatUnread: () => request<ChatUnread>("/api/chats/unread"),
  chat: (id: number) => request<Chat>(`/api/chats/${id}`),
  createChat: (data: { title: string; member_ids: number[] }) => request<Chat>("/api/chats", json("POST", data)),
  renameChat: (id: number, title: string) => request<Chat>(`/api/chats/${id}`, json("PATCH", { title })),
  addChatMembers: (id: number, user_ids: number[]) =>
    request<Chat>(`/api/chats/${id}/members`, json("POST", { user_ids })),
  removeChatMember: (id: number, userId: number) =>
    request<void>(`/api/chats/${id}/members/${userId}`, { method: "DELETE" }),
  chatMessages: (id: number, page: { after?: number; before?: number; limit?: number } = {}) =>
    request<ChatMessage[]>(`/api/chats/${id}/messages`, { query: page }),
  sendMessage: (id: number, text: string) =>
    request<ChatMessage>(`/api/chats/${id}/messages`, json("POST", { text })),
  markChatRead: (id: number, last_id: number) => request<void>(`/api/chats/${id}/read`, json("PUT", { last_id })),
  deleteMessage: (id: number, messageId: number) =>
    request<void>(`/api/chats/${id}/messages/${messageId}`, { method: "DELETE" }),

  // activity, search, media
  activity: (
    filters: { user_id?: number; entity_type?: string; entity_key?: string; since?: string; limit?: number; offset?: number } = {},
  ) =>
    request<ActivityPage>("/api/activity", { query: filters }),
  // days are counted in the viewer's time zone
  activitySummary: () =>
    request<MemberSummary[]>("/api/activity/summary", { query: { tz: -new Date().getTimezoneOffset() } }),
  search: (q: string) => request<SearchHit[]>("/api/search", { query: { q } }),
  render: (source: string) => request<{ html: string }>("/api/render", json("POST", { source })),
  resolveAnchor: (anchor: string) =>
    request<{ page: string; anchor: string }>(`/api/anchors/${encodeURIComponent(anchor)}`),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ url: string }>("/api/media", { method: "POST", form });
  },
};

export type Api = typeof api;
