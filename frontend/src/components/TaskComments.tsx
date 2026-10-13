import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Task, TaskComment, TaskStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { formatDate, TASK_STATUSES, TASK_STATUS_LABEL } from "../lib/labels";
import { ScenarioContent } from "./ScenarioContent";
import { TaskStatusPill } from "./StatusControls";

/** Sending work back from review needs a reason: the reviewer explains what to fix. */
export function needsReason(from: TaskStatus, to: TaskStatus): boolean {
  return from === "review" && (to === "in_progress" || to === "todo");
}

interface SendProps {
  task: Pick<Task, "id" | "status" | "reviewer">;
  onSent: (result: { comment: TaskComment; task: Task }) => void;
}

/** «Почему возвращаете?» — shown instead of silently changing the status from «На проверке». */
export function ReturnFromReview({ task, to, onSent, onCancel }: SendProps & { to: TaskStatus; onCancel: () => void }) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [asReviewer, setAsReviewer] = useState(!task.reviewer || task.reviewer.id === user?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSent(await api.addComment(task.id, { text, status: to, set_reviewer: asReviewer }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="return-form" onSubmit={submit} aria-label="Вернуть с проверки">
      <p className="return-title">
        <TaskStatusPill status={task.status} /> → <TaskStatusPill status={to} />
      </p>
      <label className="field">
        <span>Почему возвращаете? Что нужно исправить</span>
        <textarea
          className="textarea plain"
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
          autoFocus
          placeholder="Например: лицо всё ещё видно — размыть, как в варианте A"
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={asReviewer} onChange={(e) => setAsReviewer(e.target.checked)} />
        Я проверяющий
      </label>
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={saving || !text.trim()}>
          {saving ? "Отправка…" : "Вернуть с комментарием"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function CommentForm({ task, onSent }: SendProps) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [asReviewer, setAsReviewer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isReviewer = task.reviewer?.id === user?.id;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSent(await api.addComment(task.id, { text, status: status || null, set_reviewer: asReviewer }));
      setText("");
      setStatus("");
      setAsReviewer(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="comment-form" onSubmit={submit} aria-label="Новый комментарий">
      <label className="field">
        <span>Комментарий (Markdown)</span>
        <textarea className="textarea plain" value={text} onChange={(e) => setText(e.target.value)} required />
      </label>
      <div className="btn-row">
        <label className="inline-field">
          Статус
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | "")}>
            <option value="">не менять</option>
            {TASK_STATUSES.filter((s) => s !== task.status).map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {!isReviewer && (
          <label className="check">
            <input type="checkbox" checked={asReviewer} onChange={(e) => setAsReviewer(e.target.checked)} />
            Я проверяющий
          </label>
        )}
        <button type="submit" className="btn primary" disabled={saving || !text.trim()}>
          {saving ? "Отправка…" : "Отправить"}
        </button>
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
    </form>
  );
}

/** Discussion of a task: comments, each with the status change it explains. */
export function TaskComments({ task, onTaskChange }: { task: Task; onTaskChange: (task: Task) => void }) {
  const { user, isTeam, isAdmin } = useAuth();
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = useRef<number | null>(null);
  shown.current = comments?.length ?? null;

  useEffect(() => {
    if (shown.current === task.comments_count) return;
    let alive = true;
    api.taskComments(task.id).then(
      (c) => alive && setComments(c),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
    // a comment added elsewhere on the page (sending back from review) changes the count: reload then
  }, [task.id, task.comments_count]);

  const remove = async (c: TaskComment) => {
    try {
      await api.deleteComment(task.id, c.id);
      setComments((list) => (list ?? []).filter((x) => x.id !== c.id));
      onTaskChange({ ...task, comments_count: task.comments_count - 1 });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="comments" id="comments" aria-label="Обсуждение">
      <h3>Обсуждение {comments && comments.length > 0 && <span className="muted">({comments.length})</span>}</h3>
      {error && <div className="error-box" role="alert">{error}</div>}
      {comments?.length === 0 && <p className="muted">Комментариев пока нет.</p>}
      <ol className="comment-list">
        {comments?.map((c) => (
          <li key={c.id} className="comment">
            <header>
              <b>{c.author?.display_name ?? "Удалённый пользователь"}</b>
              {c.author && task.reviewer?.id === c.author.id && <span className="role-badge">проверяющий</span>}
              <time dateTime={c.created_at}>{formatDate(c.created_at)}</time>
              {c.status_from && c.status_to && (
                <span className="comment-status">
                  <TaskStatusPill status={c.status_from} /> → <TaskStatusPill status={c.status_to} />
                </span>
              )}
              {(c.author?.id === user?.id || isAdmin) && (
                <button type="button" className="btn small link-btn" onClick={() => remove(c)}>
                  Удалить
                </button>
              )}
            </header>
            <ScenarioContent html={c.html} className="content comment-body" />
          </li>
        ))}
      </ol>
      {isTeam && (
        <CommentForm
          task={task}
          onSent={({ comment, task: updated }) => {
            setComments((list) => [...(list ?? []), comment]);
            onTaskChange(updated);
          }}
        />
      )}
    </section>
  );
}
