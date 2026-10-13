import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Section } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ScenarioContent, type PlaceTasks } from "../components/ScenarioContent";
import { SectionStatusControl, TaskStatusPill } from "../components/StatusControls";
import { TaskPlaceLink } from "../components/TaskCard";
import { scrollToAnchor } from "../lib/anchors";
import { formatDate, taskRef } from "../lib/labels";
import { findTopSlug, useScenario } from "../lib/ScenarioContext";
import { useAsync } from "../lib/useAsync";

function SectionBlock({ section: initial, level }: { section: Section; level: 2 | 3 }) {
  const { isTeam, isAdmin } = useAuth();
  const { reloadTree } = useScenario();
  const [section, setSection] = useState(initial);
  useEffect(() => setSection(initial), [initial]);

  const places = useMemo<PlaceTasks>(
    () => ({ section: section.slug, tasks: section.tasks, canCreate: isTeam }),
    [section.slug, section.tasks, isTeam],
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
          <Link className="btn small" to={`/tasks?new=1&at=${section.slug}`}>
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
      <ScenarioContent html={section.content} places={places} />
      {section.tasks.length > 0 && (
        <aside className="section-tasks" aria-label={`Задачи: ${section.title}`}>
          <p className="section-tasks-title">Задачи по разделу</p>
          <ul>
            {section.tasks.map((t) => (
              <li key={t.id}>
                <Link to={`/t/${t.id}`}>
                  <span className="qid">{taskRef(t.id)}</span> {t.title}
                </Link>
                <TaskStatusPill status={t.status} />
                <span className="muted small">{t.assignee?.display_name ?? "без исполнителя"}</span>
                {t.anchor && <TaskPlaceLink task={t} prefix="↳ " />}
              </li>
            ))}
          </ul>
        </aside>
      )}
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
