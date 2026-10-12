import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Task } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useScenario } from "../lib/ScenarioContext";
import { ScenarioContent } from "./ScenarioContent";
import { AssigneeControl, TaskStatusControl } from "./StatusControls";

export function TaskCard({ task: initial }: { task: Task }) {
  const { isTeam } = useAuth();
  const { team, reloadProgress } = useScenario();
  const [task, setTask] = useState(initial);
  useEffect(() => setTask(initial), [initial]);

  return (
    <article
      className={`quest kind-${task.kind}${task.status === "done" ? " is-done" : ""}`}
      id={task.code.toLowerCase()}
      data-qid={task.code}
    >
      <header>
        <span className="qid">{task.code}</span>
        <h4>{task.title}</h4>
        <div className="task-controls">
          <TaskStatusControl
            status={task.status}
            editable={isTeam}
            label={`Статус ${task.code}`}
            onChange={async (status) => {
              setTask(await api.setTaskStatus(task.code, status));
              void reloadProgress();
            }}
          />
          <AssigneeControl
            assignee={task.assignee}
            team={team}
            editable={isTeam}
            onChange={async (id) => setTask(await api.setAssignee(task.code, id))}
          />
          {isTeam && (
            <Link className="btn small" to={`/t/${task.code}/edit`}>
              Править
            </Link>
          )}
          <Link className="btn small" to={`/t/${task.code}/history`}>
            История
          </Link>
        </div>
      </header>
      <div className="qbody">
        <ScenarioContent html={task.content} />
      </div>
    </article>
  );
}
