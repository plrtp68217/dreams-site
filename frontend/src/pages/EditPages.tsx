import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { SectionGroup, Task } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { EditorForm } from "../components/EditorForm";
import { RevisionHistory } from "../components/RevisionHistory";
import { AssigneeControl, TaskStatusControl } from "../components/StatusControls";
import { TaskPlaceLink } from "../components/TaskCard";
import { TaskForm } from "../components/TaskForm";
import { formatDate, taskRef, TASK_KIND_LABEL } from "../lib/labels";
import { findTopSlug, useScenario } from "../lib/ScenarioContext";
import { useAsync } from "../lib/useAsync";

function pageLink(tree: Parameters<typeof findTopSlug>[0], slug: string) {
  const top = findTopSlug(tree, slug) ?? slug;
  return `/s/${top}${top !== slug ? `#${slug}` : ""}`;
}

// ---------------- sections ----------------

export function SectionEditPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { tree, reloadTree } = useScenario();
  const { data, error, reload } = useAsync(() => api.section(slug), [slug]);
  const back = pageLink(tree, slug);

  if (error) return <div className="col error-box" role="alert">{error}</div>;
  if (!data) return <p className="loading">Загрузка…</p>;

  return (
    <div className="editor-col-wide">
      <p>
        <Link to={back}>← К разделу</Link>
      </p>
      <h2>Правка: {data.title}</h2>
      <p className="lede">
        Блоки вставляются в позицию курсора. Задачу к конкретной реплике или записке можно создать прямо на странице
        раздела — кнопка «+ задача» появляется при наведении.
      </p>
      <EditorForm
        key={data.version}
        initialTitle={data.title}
        initialContent={data.content}
        version={data.version}
        onSave={async (title, content, version) => {
          await api.updateSection(slug, { version, title, content });
          await reloadTree();
          navigate(back);
        }}
        onCancel={() => navigate(back)}
        onReload={() => void reload()}
      />
    </div>
  );
}

export function SectionHistoryPage() {
  const { slug = "" } = useParams();
  const { isTeam } = useAuth();
  const { tree, reloadTree } = useScenario();
  const navigate = useNavigate();
  const section = useAsync(() => api.section(slug), [slug]);
  const revisions = useAsync(() => api.sectionRevisions(slug), [slug]);

  if (section.error) return <div className="col error-box" role="alert">{section.error}</div>;
  if (!section.data || !revisions.data) return <p className="loading">Загрузка…</p>;
  return (
    <div className="col">
      <p>
        <Link to={pageLink(tree, slug)}>← К разделу</Link>
      </p>
      <h2>История: {section.data.title}</h2>
      <RevisionHistory
        revisions={revisions.data}
        currentVersion={section.data.version}
        canRestore={isTeam}
        onRestore={async (rev) => {
          await api.restoreSection(slug, rev.id);
          await reloadTree();
          navigate(pageLink(tree, slug));
        }}
      />
    </div>
  );
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function NewSectionPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { tree, reloadTree } = useScenario();
  const [parent, setParent] = useState(params.get("parent") ?? "");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [group, setGroup] = useState<SectionGroup>("levels");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!SLUG_RE.test(slug)) {
      setError("Адрес: латинские строчные буквы, цифры и дефис");
      return;
    }
    try {
      await api.createSection({ slug, title, group, parent_slug: parent || null, content: "<p></p>" });
      await reloadTree();
      navigate(`/s/${slug}/edit`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="col">
      <h2>Новый раздел</h2>
      <form onSubmit={submit}>
        <label className="field">
          <span>Название</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="field">
          <span>Адрес (slug), например academy-plac</span>
          <input className="input" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} required />
        </label>
        <label className="field">
          <span>Родительский раздел</span>
          <select className="select" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— верхний уровень —</option>
            {tree.map((n) => (
              <option key={n.slug} value={n.slug}>
                {n.title}
              </option>
            ))}
          </select>
        </label>
        {!parent && (
          <label className="field">
            <span>Группа в меню</span>
            <select className="select" value={group} onChange={(e) => setGroup(e.target.value as SectionGroup)}>
              <option value="main">Основное</option>
              <option value="levels">Уровни</option>
              <option value="reference">Справочник</option>
            </select>
          </label>
        )}
        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="btn primary" type="submit">
          Создать и перейти к тексту
        </button>
      </form>
    </div>
  );
}

// ---------------- tasks ----------------

function useTaskId(): number | null {
  const { id = "" } = useParams();
  return /^\d+$/.test(id) ? Number(id) : null;
}

const notFound = () => Promise.reject(new Error("Задача не найдена"));

export function TaskPage() {
  const id = useTaskId();
  const { isTeam } = useAuth();
  const { team, reloadProgress } = useScenario();
  const { data: task, error, setData } = useAsync(() => (id === null ? notFound() : api.task(id)), [id]);
  if (error) return <div className="col error-box" role="alert">{error}</div>;
  if (!task) return <p className="loading">Загрузка…</p>;

  return (
    <div className="col">
      <p>
        <Link to="/tasks">← К доске задач</Link>
      </p>
      <article className={`task-page kind-${task.kind}`}>
        <h2>
          <span className="qid">{taskRef(task.id)}</span> {task.title}
        </h2>
        <div className="task-meta">
          <TaskStatusControl
            status={task.status}
            editable={isTeam}
            onChange={async (status) => {
              setData(await api.setTaskStatus(task.id, status));
              void reloadProgress();
            }}
          />
          <AssigneeControl
            assignee={task.assignee}
            team={team}
            editable={isTeam}
            onChange={async (assignee) => setData(await api.setAssignee(task.id, assignee))}
          />
          <span className="kind">{TASK_KIND_LABEL[task.kind]}</span>
        </div>
        {task.section_slug ? (
          <p className="task-place-line">
            Место в сценарии: <TaskPlaceLink task={task} />
          </p>
        ) : (
          <p className="muted small">Не привязана к месту в сценарии.</p>
        )}
        <h3>Описание</h3>
        {task.content ? <div className="task-desc">{task.content}</div> : <p className="muted">Описания нет.</p>}
        <p className="small muted">
          Создана {formatDate(task.created_at)}
          {task.created_by ? ` · ${task.created_by.display_name}` : ""} · изменена {formatDate(task.updated_at)}
          {task.updated_by ? ` · ${task.updated_by.display_name}` : ""}
        </p>
        <div className="btn-row">
          {isTeam && (
            <Link className="btn" to={`/t/${task.id}/edit`}>
              Править
            </Link>
          )}
          <Link className="btn" to={`/t/${task.id}/history`}>
            История
          </Link>
        </div>
      </article>
      <DeleteTask task={task} />
    </div>
  );
}

export function TaskEditPage() {
  const id = useTaskId();
  const navigate = useNavigate();
  const { data, error, reload } = useAsync(() => (id === null ? notFound() : api.task(id)), [id]);

  if (error) return <div className="col error-box" role="alert">{error}</div>;
  if (!data) return <p className="loading">Загрузка…</p>;

  return (
    <div className="col">
      <p>
        <Link to={`/t/${data.id}`}>← К задаче</Link>
      </p>
      <h2>
        Правка задачи <span className="qid">{taskRef(data.id)}</span>
      </h2>
      <TaskForm
        key={data.version}
        task={data}
        onSaved={(saved) => navigate(`/t/${saved.id}`)}
        onCancel={() => navigate(`/t/${data.id}`)}
        onReload={() => void reload()}
      />
    </div>
  );
}

function DeleteTask({ task }: { task: Task }) {
  const { isAdmin } = useAuth();
  const { reloadProgress } = useScenario();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isAdmin) return null;
  return (
    <div style={{ marginTop: 30 }}>
      {!confirm ? (
        <button type="button" className="btn danger" onClick={() => setConfirm(true)}>
          Удалить задачу
        </button>
      ) : (
        <div className="btn-row">
          <span>
            Удалить {taskRef(task.id)} «{task.title}» безвозвратно?
          </span>
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              try {
                await api.deleteTask(task.id);
                void reloadProgress();
                navigate("/tasks");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Да, удалить
          </button>
          <button type="button" className="btn" onClick={() => setConfirm(false)}>
            Отмена
          </button>
        </div>
      )}
      {error && <div className="error-box" role="alert">{error}</div>}
    </div>
  );
}

export function TaskHistoryPage() {
  const id = useTaskId();
  const { isTeam } = useAuth();
  const navigate = useNavigate();
  const task = useAsync(() => (id === null ? notFound() : api.task(id)), [id]);
  const revisions = useAsync(() => (id === null ? Promise.resolve([]) : api.taskRevisions(id)), [id]);
  if (task.error) return <div className="col error-box" role="alert">{task.error}</div>;
  if (!task.data || !revisions.data) return <p className="loading">Загрузка…</p>;
  const { data } = task;
  return (
    <div className="col">
      <p>
        <Link to={`/t/${data.id}`}>← К задаче</Link>
      </p>
      <h2>
        История <span className="qid">{taskRef(data.id)}</span> {data.title}
      </h2>
      <RevisionHistory
        revisions={revisions.data}
        currentVersion={data.version}
        canRestore={isTeam}
        renderContent={(content) => <div className="task-desc">{content || "Описания нет."}</div>}
        onRestore={async (rev) => {
          await api.restoreTask(data.id, rev.id);
          navigate(`/t/${data.id}`);
        }}
      />
    </div>
  );
}
