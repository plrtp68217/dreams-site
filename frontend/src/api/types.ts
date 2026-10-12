export type Role = "viewer" | "editor" | "admin";
export type SectionStatus = "done" | "part" | "shot" | "none";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type TaskKind = "quest" | "art" | "question" | "other";
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

export interface Task {
  id: number;
  code: string;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  section_slug: string | null;
  assignee: UserBrief | null;
  content: string;
  position: number;
  version: number;
  updated_at: string;
  updated_by: UserBrief | null;
}

export type TaskBrief = Omit<Task, "content" | "version" | "updated_by">;

export interface Section {
  id: number;
  slug: string;
  title: string;
  group: SectionGroup;
  status: SectionStatus;
  position: number;
  parent_slug: string | null;
  content: string;
  version: number;
  updated_at: string;
  updated_by: UserBrief | null;
  tasks: Task[];
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
  content: string;
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
}

export interface SearchHit {
  type: "section" | "task";
  key: string;
  title: string;
  page: string;
  anchor: string;
  snippet: string;
}
