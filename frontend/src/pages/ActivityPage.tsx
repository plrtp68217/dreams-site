import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { ActivityItem } from "../api/types";
import { activityLink, describeActivity, formatDate, relativeTime, ROLE_LABEL } from "../lib/labels";
import { useAsync } from "../lib/useAsync";

const PAGE = 30;

export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const userId = params.get("user") ? Number(params.get("user")) : undefined;
  const summary = useAsync(() => api.activitySummary(), []);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.activity({ user_id: userId, limit: PAGE, offset });
      setItems((prev) => (offset ? [...prev, ...page.items] : page.items));
      setTotal(page.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const selectUser = (id?: number) => setParams(id && id !== userId ? { user: String(id) } : {}, { replace: true });

  return (
    <div className="col" style={{ maxWidth: 1000 }}>
      <h2>Активность команды</h2>
      <p className="lede">Кто что менял в сценарии: правки текстов, статусы задач и разделов, назначения и роли.</p>

      {summary.error && <div className="error-box" role="alert">{summary.error}</div>}
      <div className="members">
        {summary.data?.map((m) => (
          <button
            key={m.user.id}
            type="button"
            className={`member${m.user.id === userId ? " active" : ""}`}
            aria-pressed={m.user.id === userId}
            onClick={() => selectUser(m.user.id)}
          >
            <b>{m.user.display_name}</b>
            <span className={`role-badge ${m.user.role}`}>{ROLE_LABEL[m.user.role]}</span>
            <div className="nums">
              <span>
                <strong>{m.edits}</strong>правок
              </span>
              <span>
                <strong>{m.status_changes}</strong>статусов
              </span>
              <span>
                <strong>{m.total}</strong>всего
              </span>
            </div>
            <span className="muted small">{relativeTime(m.last_active)}</span>
          </button>
        ))}
      </div>

      <h3>
        Лента{" "}
        {userId && (
          <button type="button" className="btn small" onClick={() => selectUser()}>
            Показать всех
          </button>
        )}
      </h3>
      {error && <div className="error-box" role="alert">{error}</div>}
      {items.length === 0 && !loading ? (
        <p className="muted">Событий нет.</p>
      ) : (
        <ul className="feed" aria-label="Лента активности">
          {items.map((item) => {
            const href = activityLink(item);
            return (
              <li key={item.id}>
                <time dateTime={item.created_at} title={formatDate(item.created_at)}>
                  {relativeTime(item.created_at)}
                </time>
                <span>
                  <b>{item.user?.display_name ?? "Удалённый пользователь"}</b>{" "}
                  {href ? <Link to={href}>{describeActivity(item)}</Link> : describeActivity(item)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {items.length < total && (
        <p>
          <button type="button" className="btn" disabled={loading} onClick={() => load(items.length)}>
            {loading ? "Загрузка…" : `Показать ещё (${total - items.length})`}
          </button>
        </p>
      )}
    </div>
  );
}
