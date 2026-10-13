import type { ActivityItem, Role, SectionGroup, SectionStatus, TaskKind, TaskStatus } from "../api/types";

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "review", "done"];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "Не начато",
  in_progress: "В работе",
  review: "На проверке",
  done: "Готово",
};

export const SECTION_STATUSES: SectionStatus[] = ["done", "part", "shot", "none"];
export const SECTION_STATUS_LABEL: Record<SectionStatus, string> = {
  done: "Расписано полностью",
  part: "Есть концепт",
  shot: "Восстановлено по скриншотам",
  none: "Нет в сценарии",
};

export const TASK_KINDS: TaskKind[] = ["scenario", "design", "art", "code", "sound", "other"];
export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  scenario: "Сценарий",
  design: "Геймдизайн",
  art: "Арт",
  code: "Программирование",
  sound: "Звук",
  other: "Прочее",
};

/** Human-readable task reference: «#12». */
export function taskRef(id: number | string): string {
  return `#${id}`;
}

export const ROLES: Role[] = ["viewer", "editor", "admin"];
export const ROLE_LABEL: Record<Role, string> = {
  viewer: "Зритель",
  editor: "Команда",
  admin: "Администратор",
};
export const ROLE_HINT: Record<Role, string> = {
  viewer: "только просмотр",
  editor: "правка сценария и статусов",
  admin: "всё + управление ролями",
};

export const GROUP_LABEL: Record<SectionGroup, string> = {
  main: "",
  levels: "Уровни",
  reference: "Справочник",
};

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "нет активности";
  const diff = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} дн назад`;
  return formatDate(iso);
}

function statusLabel(entity: string, value: unknown): string {
  if (entity === "task") return TASK_STATUS_LABEL[value as TaskStatus] ?? String(value);
  if (entity === "section") return SECTION_STATUS_LABEL[value as SectionStatus] ?? String(value);
  if (entity === "user") return ROLE_LABEL[value as Role] ?? String(value);
  return String(value);
}

const FIELD_LABEL: Record<string, string> = {
  title: "заголовок",
  content: "текст",
  kind: "тип",
  section: "раздел",
  place: "место в сценарии",
  group: "группу",
  position: "порядок",
};

/** Human-readable description of an activity entry (without the actor's name). */
export function describeActivity(item: ActivityItem): string {
  const d = item.details as Record<string, unknown>;
  const what = item.entity_type === "task" ? `${taskRef(item.entity_key)} «${item.entity_label}»` : `«${item.entity_label}»`;
  switch (item.action) {
    case "task.status":
    case "section.status":
      return `сменил(а) статус ${what}: ${statusLabel(item.entity_type, d.from)} → ${statusLabel(item.entity_type, d.to)}`;
    case "task.edit":
    case "section.edit": {
      const fields = (d.fields as string[] | undefined)?.map((f) => FIELD_LABEL[f] ?? f).join(", ");
      return `отредактировал(а) ${what}${fields ? ` (${fields})` : ""}`;
    }
    case "task.create":
      return `создал(а) задачу ${what}${d.to ? ` и назначил(а) на ${String(d.to)}` : ""}`;
    case "section.create":
      return `создал(а) ${what}`;
    case "task.delete":
    case "section.delete":
      return `удалил(а) ${what}`;
    case "task.restore":
    case "section.restore":
      return `восстановил(а) версию ${String(d.version)} ${what}`;
    case "task.assignee":
      return d.to ? `назначил(а) ${what} на ${String(d.to)}` : `снял(а) исполнителя с ${what}`;
    case "user.role":
      return `выдал(а) роль «${statusLabel("user", d.to)}» пользователю ${item.entity_label}`;
    case "user.active":
      return d.to ? `включил(а) учётную запись ${item.entity_label}` : `отключил(а) учётную запись ${item.entity_label}`;
    case "user.create":
      return `создал(а) пользователя ${item.entity_label}`;
    case "user.password":
      return `сбросил(а) пароль пользователю ${item.entity_label}`;
    case "user.register":
      return "зарегистрировался(-ась)";
    case "media.upload":
      return `загрузил(а) изображение ${item.entity_label}`;
    default:
      return `${item.action} ${what}`;
  }
}

/** Link target for an activity entry, if it points to something viewable. */
export function activityLink(item: ActivityItem): string | null {
  if (item.action.endsWith(".delete")) return null;
  // tasks from before the board was reset had codes instead of numbers and no longer exist
  if (item.entity_type === "task") return /^\d+$/.test(item.entity_key) ? `/t/${item.entity_key}` : null;
  if (item.entity_type === "section") return `/s/${item.entity_key}`;
  return null;
}
