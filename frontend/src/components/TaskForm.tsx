import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Task, TaskKind } from "../api/types";
import { TASK_KINDS, TASK_KIND_LABEL } from "../lib/labels";
import { placesIn, type Place } from "../lib/places";
import { flattenTree, useScenario } from "../lib/ScenarioContext";

export interface TaskFormValues {
  title: string;
  content: string;
  kind: TaskKind;
  assignee: string;
  section: string;
  anchor: string;
}

/** Places of a section, loaded when the section changes. */
function useSectionPlaces(slug: string) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  useEffect(() => {
    if (!slug) {
      setPlaces([]);
      return;
    }
    let alive = true;
    setPlaces(null);
    api.section(slug).then(
      (s) => alive && setPlaces(placesIn(s.content)),
      () => alive && setPlaces([]),
    );
    return () => {
      alive = false;
    };
  }, [slug]);
  return places;
}

interface Props {
  /** Task being edited; omit to create a new one. */
  task?: Task;
  /** Prefill for a new task (e.g. from «+ задача» next to a line in the scenario). */
  defaults?: Partial<TaskFormValues>;
  onSaved: (task: Task) => void;
  onCancel: () => void;
  /** Called when the user drops their edit after a conflict and wants the fresh version. */
  onReload?: () => void;
}

export function TaskForm({ task, defaults, onSaved, onCancel, onReload }: Props) {
  const { tree, team } = useScenario();
  const [values, setValues] = useState<TaskFormValues>(() => ({
    title: task?.title ?? defaults?.title ?? "",
    content: task?.content ?? defaults?.content ?? "",
    kind: task?.kind ?? defaults?.kind ?? "other",
    assignee: task?.assignee ? String(task.assignee.id) : (defaults?.assignee ?? ""),
    section: task?.section_slug ?? defaults?.section ?? "",
    anchor: task?.anchor ?? defaults?.anchor ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const places = useSectionPlaces(values.section);

  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value, ...(key === "section" ? { anchor: "" } : {}) }));

  const selectedPlace = places?.find((p) => p.anchor === values.anchor);
  // a place that has since been removed from the text: keep it, but say so
  const missingPlace = values.anchor && places && !selectedPlace;
  const anchorLabel = selectedPlace?.label ?? (values.anchor === task?.anchor ? (task?.anchor_label ?? "") : "");

  const save = async (version?: number) => {
    setSaving(true);
    setError(null);
    const place = {
      section_slug: values.section || null,
      anchor: values.section && values.anchor ? values.anchor : null,
      anchor_label: values.section && values.anchor ? anchorLabel : "",
    };
    const assigneeId = values.assignee ? Number(values.assignee) : null;
    try {
      let saved: Task;
      if (task) {
        saved = await api.updateTask(task.id, {
          version: version ?? task.version,
          title: values.title,
          content: values.content,
          kind: values.kind,
          ...place,
        });
        if ((task.assignee?.id ?? null) !== assigneeId) saved = await api.setAssignee(task.id, assigneeId);
      } else {
        saved = await api.createTask({
          title: values.title,
          content: values.content,
          kind: values.kind,
          assignee_id: assigneeId,
          ...place,
        });
      }
      setConflictVersion(null);
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const detail = e.detail as { current_version?: number } | undefined;
        setConflictVersion(detail?.current_version ?? null);
      }
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  return (
    <form className="task-form" onSubmit={submit} aria-label={task ? "Правка задачи" : "Новая задача"}>
      <label className="field">
        <span>Название</span>
        <input
          className="input"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          required
          maxLength={300}
          placeholder="Например: нарисовать спрайт мужчины без лица"
          autoFocus={!task}
        />
      </label>
      <label className="field">
        <span>Описание (Markdown)</span>
        <textarea
          className="textarea plain"
          value={values.content}
          onChange={(e) => set("content", e.target.value)}
          maxLength={20000}
          placeholder="Что нужно сделать, критерии готовности, ссылки на референсы… Можно Markdown: **жирный**, - список, [ссылка](https://…)"
        />
      </label>
      <div className="form-row">
        <label className="field">
          <span>Тип</span>
          <select className="select" value={values.kind} onChange={(e) => set("kind", e.target.value as TaskKind)}>
            {TASK_KINDS.map((k) => (
              <option key={k} value={k}>
                {TASK_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Исполнитель</span>
          <select className="select" value={values.assignee} onChange={(e) => set("assignee", e.target.value)}>
            <option value="">Без исполнителя</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="place-fieldset">
        <legend>Место в сценарии</legend>
        <p className="muted small">Исполнитель откроет задачу и сразу попадёт в нужное место текста.</p>
        <div className="form-row">
          <label className="field">
            <span>Раздел</span>
            <select className="select" value={values.section} onChange={(e) => set("section", e.target.value)}>
              <option value="">— не привязана —</option>
              {flattenTree(tree).map((n) => (
                <option key={n.slug} value={n.slug}>
                  {"  ".repeat(n.depth) + n.title}
                </option>
              ))}
            </select>
          </label>
          {values.section && (
            <label className="field grow">
              <span>Место в разделе</span>
              <select
                className="select"
                value={values.anchor}
                disabled={places === null}
                onChange={(e) => set("anchor", e.target.value)}
              >
                <option value="">{places === null ? "Загрузка…" : "Весь раздел"}</option>
                {missingPlace && <option value={values.anchor}>{anchorLabel || values.anchor} (нет в тексте)</option>}
                {places?.map((p) => (
                  <option key={p.anchor} value={p.anchor}>
                    {"   ".repeat(p.depth) + p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </fieldset>

      {error && (
        <div className="error-box" role="alert">
          <p style={{ margin: 0 }}>{error}</p>
          {conflictVersion !== null && (
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button type="button" className="btn danger" onClick={() => save(conflictVersion)}>
                Сохранить поверх чужой правки
              </button>
              {onReload && (
                <button type="button" className="btn" onClick={onReload}>
                  Отменить мои правки и загрузить свежую версию
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={saving || !values.title.trim()}>
          {saving ? "Сохранение…" : task ? "Сохранить" : "Создать задачу"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
