/**
 * The home page news feed: the activity log folded into stories a person can read at a glance —
 * «new task #5», «Сергей updated «Посетители» (3 edits)», «comment on #3: …».
 */
import type { ActivityItem, TaskStatus, UserBrief } from "../api/types";

export type NewsKind =
  | "task-new" // a task was created
  | "task-comment" // a comment (possibly explaining a status change)
  | "task-status" // status moved without a comment
  | "task-update" // edited, assigned, reviewer set, restored
  | "section-new"
  | "scenario" // a section's text was edited / restored
  | "section-status"
  | "team" // new member, role change
  | "removed"; // a task or section was deleted

export type NewsFilter = "all" | "tasks" | "scenario" | "comments";

export interface NewsItem {
  key: string;
  kind: NewsKind;
  /** Time of the latest event in the story. */
  at: string;
  user: UserBrief | null;
  entityType: string;
  entityKey: string;
  label: string;
  /** Events folded into this story, newest first. */
  events: ActivityItem[];
  /** For status stories: where it started and where it ended. */
  from?: TaskStatus;
  to?: TaskStatus;
  /** Comment excerpt, assignee name… */
  text?: string;
  /** Fields changed across the folded edits. */
  fields?: string[];
}

function kindOf(item: ActivityItem): NewsKind | null {
  const d = item.details as Record<string, unknown>;
  switch (item.action) {
    case "task.create":
      return "task-new";
    case "task.comment":
      return "task-comment";
    case "task.status":
      // the comment that caused it already tells the story
      return "comment" in d ? null : "task-status";
    case "task.edit":
    case "task.assignee":
    case "task.reviewer":
    case "task.restore":
      return "task-update";
    case "section.create":
      return "section-new";
    case "section.edit":
    case "section.restore":
      return "scenario";
    case "section.status":
      return "section-status";
    case "user.create":
    case "user.role":
      return "team";
    case "task.delete":
    case "section.delete":
      return "removed";
    default:
      // registrations, password resets, uploads… are not news
      return null;
  }
}

// stories of these kinds absorb repeated events by the same person on the same thing on the same day
const FOLDABLE = new Set<NewsKind>(["task-status", "task-update", "scenario", "section-status"]);

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Fold activity (newest first, as the API returns it) into news stories, newest first. */
export function buildNews(items: ActivityItem[]): NewsItem[] {
  const out: NewsItem[] = [];
  const open = new Map<string, NewsItem>();
  for (const item of items) {
    const kind = kindOf(item);
    if (!kind) continue;
    const d = item.details as Record<string, unknown>;
    const foldKey = `${kind}|${item.entity_type}|${item.entity_key}|${item.user?.id ?? "-"}|${localDay(item.created_at)}`;
    const existing = FOLDABLE.has(kind) ? open.get(foldKey) : undefined;
    if (existing) {
      // going back in time: this event happened earlier than the ones already folded
      existing.events.push(item);
      if (kind === "task-status" || kind === "section-status") existing.from = d.from as TaskStatus;
      if (Array.isArray(d.fields)) existing.fields = [...new Set([...(d.fields as string[]), ...(existing.fields ?? [])])];
      continue;
    }
    const story: NewsItem = {
      key: `${item.id}`,
      kind,
      at: item.created_at,
      user: item.user,
      entityType: item.entity_type,
      entityKey: item.entity_key,
      label: item.entity_label,
      events: [item],
    };
    if (kind === "task-status" || kind === "section-status" || (kind === "task-comment" && d.to)) {
      story.from = d.from as TaskStatus;
      story.to = d.to as TaskStatus;
    }
    if (kind === "task-comment") story.text = String(d.text ?? "");
    if (kind === "task-new" && d.to) story.text = String(d.to);
    if (kind === "team") story.text = String(d.to ?? d.role ?? "");
    if (Array.isArray(d.fields)) story.fields = d.fields as string[];
    out.push(story);
    if (FOLDABLE.has(kind)) open.set(foldKey, story);
  }
  return out;
}

export function matchesFilter(item: NewsItem, filter: NewsFilter): boolean {
  if (filter === "all") return true;
  if (filter === "comments") return item.kind === "task-comment";
  if (filter === "scenario") return item.entityType === "section";
  return item.entityType === "task";
}

/** Day heading: «Сегодня», «Вчера», «12 октября». */
export function dayTitle(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export function groupByDay(items: NewsItem[], now: Date = new Date()): Array<{ day: string; items: NewsItem[] }> {
  const groups: Array<{ day: string; items: NewsItem[] }> = [];
  for (const item of items) {
    const day = dayTitle(item.at, now);
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(item);
  }
  return groups;
}

/** «3 новые задачи, 5 правок сценария, 2 комментария» for the stories since the last visit. */
export function summarize(items: NewsItem[]): string[] {
  const count = (kinds: NewsKind[]) =>
    items.filter((i) => kinds.includes(i.kind)).reduce((n, i) => n + (i.kind === "scenario" ? i.events.length : 1), 0);
  const parts: Array<[number, [string, string, string]]> = [
    [count(["task-new"]), ["новая задача", "новые задачи", "новых задач"]],
    [count(["task-comment"]), ["комментарий", "комментария", "комментариев"]],
    [count(["task-status"]), ["смена статуса", "смены статуса", "смен статуса"]],
    [count(["scenario", "section-new"]), ["правка сценария", "правки сценария", "правок сценария"]],
  ];
  return parts.filter(([n]) => n > 0).map(([n, forms]) => `${n} ${pluralForm(n, forms)}`);
}

function pluralForm(n: number, [one, few, many]: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const VISIT_KEY = "dreams-last-visit";

/**
 * When the viewer last opened the news, so new stories can be marked. The baseline is kept for the whole browser
 * session (reloading the page does not make everything «old»); the stored time moves to now.
 */
export function takeLastVisit(userId: number, now: Date = new Date()): string | null {
  const key = `${VISIT_KEY}-${userId}`;
  try {
    let baseline = sessionStorage.getItem(key);
    if (baseline === null) {
      baseline = localStorage.getItem(key) ?? "";
      sessionStorage.setItem(key, baseline);
    }
    localStorage.setItem(key, now.toISOString());
    return baseline || null;
  } catch {
    return null; // storage unavailable: nothing is marked as new
  }
}
