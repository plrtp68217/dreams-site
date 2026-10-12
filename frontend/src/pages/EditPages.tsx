import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { SectionGroup, TaskKind } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { EditorForm } from "../components/EditorForm";
import { RevisionHistory } from "../components/RevisionHistory";
import { TaskCard } from "../components/TaskCard";
import { TASK_KINDS, TASK_KIND_LABEL } from "../lib/labels";
import { findTopSlug, flattenTree, useScenario } from "../lib/ScenarioContext";
import { useAsync } from "../lib/useAsync";

function pageLink(tree: Parameters<typeof findTopSlug>[0], slug: string | null, anchor?: string) {
  if (!slug) return "/tasks";
  const top = findTopSlug(tree, slug) ?? slug;
  const hash = anchor ?? (top !== slug ? slug : "");
  return `/s/${top}${hash ? `#${hash}` : ""}`;
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
        Блоки вставляются в позицию курсора. Карточки задач встраиваются тегом <code>{'<div data-task="КОД">'}</code> —
        их текст правится отдельно, в самой задаче.
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

export function TaskPage() {
  const { code = "" } = useParams();
  const { tree } = useScenario();
  const { data, error } = useAsync(() => api.task(code), [code]);
  if (error) return <div className="col error-box" role="alert">{error}</div>;
  if (!data) return <p className="loading">Загрузка…</p>;
  return (
    <div className="col">
      <p>
        {data.section_slug ? (
          <Link to={pageLink(tree, data.section_slug, data.code.toLowerCase())}>← Открыть в сценарии</Link>
        ) : (
          <Link to="/tasks">← К доске задач</Link>
        )}
      </p>
      <TaskCard task={data} />
    </div>
  );
}

function SectionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { tree } = useScenario();
  return (
    <label className="field">
      <span>Раздел сценария</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— без раздела —</option>
        {flattenTree(tree).map((n) => (
          <option key={n.slug} value={n.slug}>
            {"  ".repeat(n.depth) + n.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function KindSelect({ value, onChange }: { value: TaskKind; onChange: (v: TaskKind) => void }) {
  return (
    <label className="field">
      <span>Тип</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as TaskKind)}>
        {TASK_KINDS.map((k) => (
          <option key={k} value={k}>
            {TASK_KIND_LABEL[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TaskEditPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const { tree } = useScenario();
  const { data, error, reload } = useAsync(() => api.task(code), [code]);
  const [kind, setKind] = useState<TaskKind | null>(null);
  const [section, setSection] = useState<string | null>(null);

  if (error) return <div className="col error-box" role="alert">{error}</div>;
  if (!data) return <p className="loading">Загрузка…</p>;
  const currentKind = kind ?? data.kind;
  const currentSection = section ?? data.section_slug ?? "";
  const back = data.section_slug ? pageLink(tree, data.section_slug, data.code.toLowerCase()) : `/t/${data.code}`;

  return (
    <div className="editor-col-wide">
      <p>
        <Link to={back}>← Назад</Link>
      </p>
      <h2>
        Правка задачи <span className="qid">{data.code}</span>
      </h2>
      <EditorForm
        key={data.version}
        initialTitle={data.title}
        initialContent={data.content}
        version={data.version}
        allowTasks={false}
        extraFields={
          <div className="btn-row">
            <KindSelect value={currentKind} onChange={setKind} />
            <SectionSelect value={currentSection} onChange={setSection} />
          </div>
        }
        onSave={async (title, content, version) => {
          const updated = await api.updateTask(code, {
            version,
            title,
            content,
            kind: currentKind,
            section_slug: currentSection || null,
          });
          navigate(updated.section_slug ? pageLink(tree, updated.section_slug, updated.code.toLowerCase()) : `/t/${updated.code}`);
        }}
        onCancel={() => navigate(back)}
        onReload={() => {
          setKind(null);
          setSection(null);
          void reload();
        }}
      />
      <DeleteTask code={data.code} />
    </div>
  );
}

function DeleteTask({ code }: { code: string }) {
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
          <span>Удалить {code} безвозвратно?</span>
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              try {
                await api.deleteTask(code);
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
  const { code = "" } = useParams();
  const { isTeam } = useAuth();
  const navigate = useNavigate();
  const task = useAsync(() => api.task(code), [code]);
  const revisions = useAsync(() => api.taskRevisions(code), [code]);
  if (task.error) return <div className="col error-box" role="alert">{task.error}</div>;
  if (!task.data || !revisions.data) return <p className="loading">Загрузка…</p>;
  return (
    <div className="col">
      <p>
        <Link to={`/t/${code}`}>← К задаче</Link>
      </p>
      <h2>
        История <span className="qid">{task.data.code}</span> {task.data.title}
      </h2>
      <RevisionHistory
        revisions={revisions.data}
        currentVersion={task.data.version}
        canRestore={isTeam}
        onRestore={async (rev) => {
          await api.restoreTask(code, rev.id);
          navigate(`/t/${code}`);
        }}
      />
    </div>
  );
}

const CODE_RE = /^[A-Z0-9][A-Z0-9\-_]{0,39}$/;

export function NewTaskPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { team, reloadProgress } = useScenario();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKind>("quest");
  const [section, setSection] = useState(params.get("section") ?? "");
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!CODE_RE.test(code)) {
      setError("Код: заглавные латинские буквы, цифры, дефис — например AC-V01");
      return;
    }
    try {
      const task = await api.createTask({
        code,
        title,
        kind,
        section_slug: section || null,
        assignee_id: assignee ? Number(assignee) : null,
        content: "<p></p>",
      });
      void reloadProgress();
      navigate(`/t/${task.code}/edit`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="col">
      <h2>Новая задача</h2>
      <form onSubmit={submit}>
        <label className="field">
          <span>Код</span>
          <input className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required />
        </label>
        <label className="field">
          <span>Название</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <KindSelect value={kind} onChange={setKind} />
        <SectionSelect value={section} onChange={setSection} />
        <label className="field">
          <span>Исполнитель</span>
          <select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Без исполнителя</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
          </select>
        </label>
        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="btn primary" type="submit">
          Создать и перейти к тексту
        </button>
      </form>
    </div>
  );
}
