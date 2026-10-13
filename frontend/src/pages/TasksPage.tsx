import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { Task, TaskBrief, TaskKind, TaskStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { BoardCard } from "../components/TaskCard";
import { TaskForm } from "../components/TaskForm";
import { taskRef, TASK_KINDS, TASK_KIND_LABEL, TASK_STATUSES, TASK_STATUS_LABEL } from "../lib/labels";
import { flattenTree, useScenario } from "../lib/ScenarioContext";
import { useAsync } from "../lib/useAsync";

// ?new=1 opens the «new task» form; at= and anchor= prefill the place in the scenario (separate from the filters)
const NEW_KEYS = ["new", "at", "anchor"];

export function TasksPage() {
  const { isTeam } = useAuth();
  const { tree, team, reloadProgress, reloadTeam } = useScenario();
  useEffect(() => {
    void reloadTeam();
  }, [reloadTeam]);
  const [params, setParams] = useSearchParams();
  const kind = (params.get("kind") as TaskKind | null) ?? undefined;
  const section = params.get("section") ?? undefined;
  const assignee = params.get("assignee") ?? undefined;
  const onlyStatus = params.get("status") as TaskStatus | null;
  const creating = isTeam && params.get("new") === "1";
  const [created, setCreated] = useState<Task | null>(null);

  const { data, error, setData } = useAsync(
    () => api.tasks({ kind, section, assignee_id: assignee ? Number(assignee) : undefined }),
    [kind, section, assignee],
  );

  const columns = useMemo(() => {
    const by: Record<TaskStatus, TaskBrief[]> = { todo: [], in_progress: [], review: [], done: [] };
    for (const t of data ?? []) by[t.status].push(t);
    return by;
  }, [data]);

  const update = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    setParams(next, { replace: true });
  };
  const setFilter = (key: string, value: string) => update((next) => (value ? next.set(key, value) : next.delete(key)));
  const openForm = (open: boolean) =>
    update((next) => {
      NEW_KEYS.forEach((k) => next.delete(k));
      if (open) next.set("new", "1");
    });

  const replaceTask = (task: TaskBrief) => setData((data ?? []).map((t) => (t.id === task.id ? task : t)));

  const onCreated = (task: Task) => {
    setCreated(task);
    void reloadProgress();
    const matches =
      (!kind || task.kind === kind) &&
      (!section || task.section_slug === section) &&
      (!assignee || String(task.assignee?.id) === assignee);
    if (matches) setData([...(data ?? []), task]);
    openForm(false);
  };

  const visible = onlyStatus ? [onlyStatus] : TASK_STATUSES;
  const empty = data !== null && data !== undefined && data.length === 0;
  const filtered = Boolean(kind || section || assignee);

  return (
    <div className="board-main">
      <div className="board-head">
        <h2>Доска задач</h2>
        {isTeam && !creating && (
          <button type="button" className="btn primary" onClick={() => openForm(true)}>
            + Новая задача
          </button>
        )}
      </div>
      <p className="lede">
        {isTeam
          ? "Задача может ссылаться на место в сценарии — реплику, записку или карточку. Создать её можно здесь или кнопкой «+ задача» прямо в тексте."
          : "Задачи ведёт команда; у вас доступ на чтение."}
      </p>

      {creating && (
        <section className="task-form-panel" aria-label="Новая задача">
          <h3>Новая задача</h3>
          <TaskForm
            key={`${params.get("at") ?? ""}#${params.get("anchor") ?? ""}`}
            defaults={{ section: params.get("at") ?? "", anchor: params.get("anchor") ?? "" }}
            onSaved={onCreated}
            onCancel={() => openForm(false)}
          />
        </section>
      )}
      {created && !creating && (
        <div className="ok-box" role="status">
          Задача <Link to={`/t/${created.id}`}>{taskRef(created.id)} «{created.title}»</Link> создана
          {created.assignee ? ` и назначена на ${created.assignee.display_name}` : ""}.
        </div>
      )}

      <div className="filters">
        <label>
          Тип
          <select className="select" value={kind ?? ""} onChange={(e) => setFilter("kind", e.target.value)}>
            <option value="">Все</option>
            {TASK_KINDS.map((k) => (
              <option key={k} value={k}>
                {TASK_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Раздел
          <select className="select" value={section ?? ""} onChange={(e) => setFilter("section", e.target.value)}>
            <option value="">Все</option>
            {flattenTree(tree).map((n) => (
              <option key={n.slug} value={n.slug}>
                {"  ".repeat(n.depth) + n.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Исполнитель
          <select className="select" value={assignee ?? ""} onChange={(e) => setFilter("assignee", e.target.value)}>
            <option value="">Все</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Статус
          <select className="select" value={onlyStatus ?? ""} onChange={(e) => setFilter("status", e.target.value)}>
            <option value="">Все колонки</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      {empty && (
        <p className="empty-board">
          {filtered
            ? "Под эти фильтры задач нет."
            : isTeam
              ? "Задач пока нет. Создайте первую кнопкой «+ Новая задача»."
              : "Задач пока нет."}
        </p>
      )}
      <div className="board">
        {visible.map((status) => (
          <section key={status} className={`board-col ts-${status}`} aria-label={TASK_STATUS_LABEL[status]}>
            <h3>
              <span>{TASK_STATUS_LABEL[status]}</span>
              <span>{columns[status].length}</span>
            </h3>
            <ul>
              {columns[status].map((t) => (
                <BoardCard key={t.id} task={t} onChange={replaceTask} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
