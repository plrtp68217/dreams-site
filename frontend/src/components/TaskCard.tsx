import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { TaskBrief, TaskStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { taskRef, TASK_KIND_LABEL } from "../lib/labels";
import { placeHref } from "../lib/places";
import { useScenario } from "../lib/ScenarioContext";
import { AssigneeControl, TaskStatusControl } from "./StatusControls";
import { needsReason, ReturnFromReview } from "./TaskComments";

/** «Сон 1 › Мужчина без лица: «Комбо…»» — where in the scenario the task points, as a link. */
export function TaskPlaceLink({ task, prefix = "" }: { task: TaskBrief; prefix?: string }) {
  const href = placeHref(task.page, task.section_slug, task.anchor);
  if (!href) return null;
  const text = task.anchor_label ? `${task.section_title} › ${task.anchor_label}` : task.section_title;
  return (
    <Link className="task-place" to={href} title="Открыть это место в сценарии">
      {prefix}
      {text}
    </Link>
  );
}

interface BoardCardProps {
  task: TaskBrief;
  onChange: (task: TaskBrief) => void;
}

/** A task on the board: number, title, place, assignee and status (editable for the team). */
export function BoardCard({ task, onChange }: BoardCardProps) {
  const { isTeam } = useAuth();
  const { team, reloadProgress } = useScenario();
  const [returning, setReturning] = useState<TaskStatus | null>(null);
  const setStatus = async (status: TaskStatus) => {
    if (needsReason(task.status, status)) {
      setReturning(status);
      return;
    }
    const updated = await api.setTaskStatus(task.id, status);
    onChange({ ...task, status: updated.status });
    void reloadProgress();
  };
  const setAssignee = async (id: number | null) => {
    const updated = await api.setAssignee(task.id, id);
    onChange({ ...task, assignee: updated.assignee });
  };

  return (
    <li className={`board-card kind-${task.kind}`}>
      <div className="row">
        <span className="qid">{taskRef(task.id)}</span>
        <span className="kind">{TASK_KIND_LABEL[task.kind]}</span>
      </div>
      <Link className="title" to={`/t/${task.id}`}>
        {task.title}
      </Link>
      <TaskPlaceLink task={task} prefix="↳ " />
      {(task.reviewer || task.comments_count > 0) && (
        <div className="row card-extra">
          {task.reviewer && <span>Проверяет: {task.reviewer.display_name}</span>}
          {task.comments_count > 0 && (
            <Link to={`/t/${task.id}#comments`} title="Обсуждение">
              💬 {task.comments_count}
            </Link>
          )}
        </div>
      )}
      <div className="row">
        <AssigneeControl
          assignee={task.assignee}
          team={team}
          editable={isTeam}
          label={`Исполнитель ${taskRef(task.id)}`}
          onChange={setAssignee}
        />
        <TaskStatusControl status={task.status} editable={isTeam} label={`Статус ${taskRef(task.id)}`} onChange={setStatus} />
      </div>
      {returning && (
        <ReturnFromReview
          task={task}
          to={returning}
          onCancel={() => setReturning(null)}
          onSent={({ task: updated }) => {
            setReturning(null);
            onChange({ ...task, status: updated.status, reviewer: updated.reviewer, comments_count: updated.comments_count });
            void reloadProgress();
          }}
        />
      )}
    </li>
  );
}
