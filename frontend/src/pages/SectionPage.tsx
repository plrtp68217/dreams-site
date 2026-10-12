import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Section, Task } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { embeddedTaskCodes, ScenarioContent } from "../components/ScenarioContent";
import { SectionStatusControl } from "../components/StatusControls";
import { TaskCard } from "../components/TaskCard";
import { scrollToAnchor } from "../lib/anchors";
import { formatDate } from "../lib/labels";
import { findTopSlug, useScenario } from "../lib/ScenarioContext";
import { useAsync } from "../lib/useAsync";

function SectionBlock({ section: initial, level }: { section: Section; level: 2 | 3 }) {
  const { isTeam, isAdmin } = useAuth();
  const { reloadTree } = useScenario();
  const [section, setSection] = useState(initial);
  useEffect(() => setSection(initial), [initial]);

  const tasks = new Map<string, Task>(section.tasks.map((t) => [t.code, t]));
  const embedded = new Set(embeddedTaskCodes(section.content));
  const loose = section.tasks.filter((t) => !embedded.has(t.code));

  const renderTask = useCallback(
    (code: string) => {
      const task = tasks.get(code);
      return task ? (
        <TaskCard task={task} />
      ) : (
        <Link className="task-missing" to={`/t/${code}`}>
          Задача {code} →
        </Link>
      );
    },
    // tasks is rebuilt from section on every render; section identity is the real dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section],
  );

  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section id={section.slug} className={level === 3 ? "sub-section" : undefined}>
      <Heading>{section.title}</Heading>
      <div className="section-head">
        <SectionStatusControl
          status={section.status}
          editable={isTeam}
          onChange={async (status) => {
            const updated = await api.setSectionStatus(section.slug, status);
            setSection((s) => ({ ...s, status: updated.status }));
            void reloadTree();
          }}
        />
        {isTeam && (
          <Link className="btn small" to={`/s/${section.slug}/edit`}>
            Править текст
          </Link>
        )}
        <Link className="btn small" to={`/s/${section.slug}/history`}>
          История
        </Link>
        {isTeam && (
          <Link className="btn small" to={`/new/task?section=${section.slug}`}>
            + Задача
          </Link>
        )}
        {isTeam && level === 2 && (
          <Link className="btn small" to={`/new/section?parent=${section.slug}`}>
            + Подраздел
          </Link>
        )}
        {isAdmin && <DeleteSection slug={section.slug} />}
        <span className="meta">
          Изменено {formatDate(section.updated_at)}
          {section.updated_by ? ` · ${section.updated_by.display_name}` : ""}
        </span>
      </div>
      <ScenarioContent html={section.content} renderTask={renderTask} />
      {loose.map((t) => (
        <TaskCard key={t.code} task={t} />
      ))}
      {section.children.map((child) => (
        <SectionBlock key={child.slug} section={child} level={3} />
      ))}
    </section>
  );
}

function DeleteSection({ slug }: { slug: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { reloadTree } = useScenario();
  const [deleted, setDeleted] = useState(false);
  if (deleted) return <Navigate to="/" replace />;
  if (!confirming)
    return (
      <button type="button" className="btn small danger" onClick={() => setConfirming(true)}>
        Удалить
      </button>
    );
  return (
    <span className="btn-row">
      <span className="small">Удалить раздел и подразделы? Задачи останутся на доске.</span>
      <button
        type="button"
        className="btn small danger"
        onClick={async () => {
          try {
            await api.deleteSection(slug);
            await reloadTree();
            setDeleted(true);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Да, удалить
      </button>
      <button type="button" className="btn small" onClick={() => setConfirming(false)}>
        Нет
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}

export function SectionPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const { tree } = useScenario();
  const { data, error, loading } = useAsync(() => api.section(slug), [slug]);

  useEffect(() => {
    if (!data) return;
    const anchor = decodeURIComponent(location.hash.slice(1));
    if (!anchor) {
      window.scrollTo?.(0, 0);
      return;
    }
    // Images above the target load lazily and shift the layout, so jump instantly and re-check once.
    const first = requestAnimationFrame(() => scrollToAnchor(anchor, false));
    const again = setTimeout(() => scrollToAnchor(anchor, false), 400);
    return () => {
      cancelAnimationFrame(first);
      clearTimeout(again);
    };
  }, [data, location.hash]);

  if (loading && !data) return <p className="loading">Загрузка…</p>;
  if (error) return <div className="col error-box" role="alert">{error}</div>;
  if (!data) return null;

  if (data.parent_slug) {
    const top = findTopSlug(tree, slug);
    if (top && top !== slug) return <Navigate to={`/s/${top}#${slug}`} replace />;
  }

  return (
    <div className="col">
      <SectionBlock section={data} level={2} />
    </div>
  );
}
