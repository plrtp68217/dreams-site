export type Role = "viewer" | "editor" | "admin";
export type SectionStatus = "done" | "part" | "shot" | "none";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type TaskKind = "scenario" | "design" | "art" | "code" | "sound" | "other";
export type SectionGroup = "main" | "levels" | "reference";

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface UserBrief {
  id: number;
  username: string;
  display_name: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface SiteInfo {
  hero: string | null;
  allow_registration: boolean;
}

export interface SectionNode {
  id: number;
  slug: string;
  title: string;
  group: SectionGroup;
  status: SectionStatus;
  position: number;
  parent_slug: string | null;
  children: SectionNode[];
}

/** A board task, referred to by its number (#12). */
export interface TaskBrief {
  id: number;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  assignee: UserBrief | null;
  /** Who checks the work. */
  reviewer: UserBrief | null;
  comments_count: number;
  /** Place in the scenario: section, top-level page that shows it, and an element inside (id / data-id). */
  section_slug: string | null;
  section_title: string | null;
  page: string | null;
  anchor: string | null;
  anchor_label: string;
  position: number;
  updated_at: string;
}

export interface Task extends TaskBrief {
  /** Description in Markdown, and rendered. */
  content: string;
  content_html: string;
  version: number;
  created_at: string;
  created_by: UserBrief | null;
  updated_by: UserBrief | null;
}

export interface TaskComment {
  id: number;
  /** Markdown, and rendered. */
  text: string;
  html: string;
  /** The status change this comment explains, if any. */
  status_from: TaskStatus | null;
  status_to: TaskStatus | null;
  created_at: string;
  author: UserBrief | null;
}

export interface TaskPlace {
  section_slug: string | null;
  anchor: string | null;
  anchor_label: string;
}

export interface Section {
  id: number;
  slug: string;
  title: string;
  group: SectionGroup;
  status: SectionStatus;
  position: number;
  parent_slug: string | null;
  /** What editors write: scenario Markdown. */
  source: string;
  /** Rendered HTML, with hidden anchors for tasks. */
  content: string;
  version: number;
  updated_at: string;
  updated_by: UserBrief | null;
  tasks: TaskBrief[];
  children: Section[];
}

export interface Progress {
  total: number;
  done: number;
  by_status: Record<TaskStatus, number>;
}

export interface Revision {
  id: number;
  version: number;
  title: string;
  /** Markdown as written, and rendered. */
  content: string;
  html: string;
  created_at: string;
  author: UserBrief | null;
}

export interface ActivityItem {
  id: number;
  action: string;
  entity_type: string;
  entity_key: string;
  entity_label: string;
  details: Record<string, unknown>;
  created_at: string;
  user: UserBrief | null;
}

export interface ActivityPage {
  items: ActivityItem[];
  total: number;
}

export interface MemberSummary {
  user: User;
  total: number;
  edits: number;
  status_changes: number;
  last_active: string | null;
  by_action: Record<string, number>;
  /** Actions per local day ("2026-10-13": 4) over the last year. */
  days: Record<string, number>;
}

export interface SearchHit {
  type: "section" | "task";
  key: string;
  title: string;
  page: string;
  anchor: string;
  snippet: string;
}

export interface ChatMessage {
  id: number;
  chat_id: number;
  /** Markdown, and rendered. */
  text: string;
  html: string;
  created_at: string;
  author: UserBrief | null;
}

export interface Chat {
  id: number;
  /** Empty for a direct chat of two people. */
  title: string;
  members: UserBrief[];
  created_by: UserBrief | null;
  created_at: string;
  last_activity_at: string;
  /** Plain text, shortened. */
  last_message: { id: number; text: string; created_at: string; author: UserBrief | null } | null;
  unread: number;
}

export interface ChatUnread {
  messages: number;
  chats: number;
}
