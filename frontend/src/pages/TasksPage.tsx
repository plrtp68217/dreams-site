import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { TaskBrief, TaskKind, TaskStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { TaskStatusControl } from "../components/StatusControls";
import { TASK_KINDS, TASK_KIND_LABEL, TASK_STATUSES, TASK_STATUS_LABEL } from "../lib/labels";
import { flattenTree, useScenario } from "../lib/ScenarioContext";
import { useAsync } from "../lib/useAsync";

export function TasksPage() {
  const { isTeam } = useAuth();
  const { tree, team, reloadProgress } = useScenario();
  const [params, setParams] = useSearchParams();
  const kind = (params.get("kind") as TaskKind | null) ?? undefined;
  const section = params.get("section") ?? undefined;
  const assignee = params.get("assignee") ?? undefined;
  const onlyStatus = params.get("status") as TaskStatus | null;

  const { data, error, setData } = useAsync(
    () => api.tasks({ kind, section, assignee_id: assignee ? Number(assignee) : undefined }),
    [kind, section, assignee],
  );

  const columns = useMemo(() => {
    const by: Record<TaskStatus, TaskBrief[]> = { todo: [], in_progress: [], review: [], done: [] };
    for (const t of data ?? []) by[t.status].push(t);
    return by;
  }, [data]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const changeStatus = async (code: string, status: TaskStatus) => {
    const updated = await api.setTaskStatus(code, status);
    setData((data ?? []).map((t) => (t.code === code ? { ...t, status: updated.status } : t)));
    void reloadProgress();
  };

  const visible = onlyStatus ? [onlyStatus] : TASK_STATUSES;

  return (
    <div className="board-main">
      <h2>Доска задач</h2>
      <p className="lede">
        {isTeam ? "Меняйте статус прямо в карточке — изменение сразу попадает в ленту активности." : "Статусы меняет команда."}
      </p>
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
        {isTeam && (
          <Link className="btn primary" to={`/new/task${section ? `?section=${section}` : ""}`}>
            + Задача
          </Link>
        )}
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="board">
        {visible.map((status) => (
          <section key={status} className={`board-col ts-${status}`} aria-label={TASK_STATUS_LABEL[status]}>
            <h3>
              <span>{TASK_STATUS_LABEL[status]}</span>
              <span>{columns[status].length}</span>
            </h3>
            <ul>
              {columns[status].map((t) => (
                <li key={t.code} className="board-card">
                  <span className="qid">{t.code}</span>
                  <Link className="title" to={`/t/${t.code}`}>
                    {t.title}
                  </Link>
                  <div className="row">
                    <span>{t.assignee?.display_name ?? "—"}</span>
                    <TaskStatusControl
                      status={t.status}
                      editable={isTeam}
                      label={`Статус ${t.code}`}
                      onChange={(s) => changeStatus(t.code, s)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
