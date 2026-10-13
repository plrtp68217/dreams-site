import { useState } from "react";
import type { SectionStatus, TaskStatus, User, UserBrief } from "../api/types";
import { SECTION_STATUSES, SECTION_STATUS_LABEL, TASK_STATUSES, TASK_STATUS_LABEL } from "../lib/labels";

export function TaskStatusPill({ status }: { status: TaskStatus }) {
  return <span className={`pill ts-${status}`}>{TASK_STATUS_LABEL[status]}</span>;
}

/** Wraps an async change so the control is disabled while saving and shows a failure inline. */
function useSaving() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, run };
}

interface TaskStatusProps {
  status: TaskStatus;
  editable: boolean;
  onChange: (status: TaskStatus) => Promise<unknown>;
  label?: string;
}

export function TaskStatusControl({ status, editable, onChange, label = "Статус задачи" }: TaskStatusProps) {
  const { saving, error, run } = useSaving();
  if (!editable) return <TaskStatusPill status={status} />;
  return (
    <>
      <select
        className={`select status-select ts-${status}`}
        aria-label={label}
        value={status}
        disabled={saving}
        onChange={(e) => run(() => onChange(e.target.value as TaskStatus))}
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {error && <span role="alert" className="small" style={{ color: "var(--red)" }}>{error}</span>}
    </>
  );
}

interface SectionStatusProps {
  status: SectionStatus;
  editable: boolean;
  onChange: (status: SectionStatus) => Promise<unknown>;
}

export function SectionStatusControl({ status, editable, onChange }: SectionStatusProps) {
  const { saving, error, run } = useSaving();
  if (!editable) {
    return (
      <span className={`status ${status}`} style={{ margin: 0 }}>
        <i className={`dot ${status}`} />
        {SECTION_STATUS_LABEL[status]}
      </span>
    );
  }
  return (
    <>
      <select
        className={`select sec-status-select ${status}`}
        aria-label="Статус раздела"
        value={status}
        disabled={saving}
        onChange={(e) => run(() => onChange(e.target.value as SectionStatus))}
      >
        {SECTION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {SECTION_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {error && <span role="alert" className="small" style={{ color: "var(--red)" }}>{error}</span>}
    </>
  );
}

interface AssigneeProps {
  assignee: UserBrief | null;
  team: User[];
  editable: boolean;
  onChange: (userId: number | null) => Promise<unknown>;
  label?: string;
  /** The same control picks the reviewer. */
  reviewer?: boolean;
}

export function AssigneeControl({ assignee, team, editable, onChange, label, reviewer = false }: AssigneeProps) {
  const { saving, error, run } = useSaving();
  const title = reviewer ? "Проверяющий" : "Исполнитель";
  const none = reviewer ? "Без проверяющего" : "Без исполнителя";
  if (!editable) {
    return <span className="assignee">{assignee ? `${title}: ${assignee.display_name}` : none}</span>;
  }
  return (
    <>
      <select
        className="select"
        aria-label={label ?? title}
        value={assignee?.id ?? ""}
        disabled={saving}
        onChange={(e) => run(() => onChange(e.target.value ? Number(e.target.value) : null))}
      >
        <option value="">{none}</option>
        {team.map((u) => (
          <option key={u.id} value={u.id}>
            {u.display_name}
          </option>
        ))}
      </select>
      {error && <span role="alert" className="small" style={{ color: "var(--red)" }}>{error}</span>}
    </>
  );
}
