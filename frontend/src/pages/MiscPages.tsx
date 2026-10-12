import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ROLE_HINT, ROLE_LABEL } from "../lib/labels";
import { useAsync } from "../lib/useAsync";

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const { data, error, loading } = useAsync(() => (q.length >= 2 ? api.search(q) : Promise.resolve([])), [q]);

  return (
    <div className="col">
      <h2>Поиск: «{q}»</h2>
      {error && <div className="error-box" role="alert">{error}</div>}
      {loading && <p className="loading">Ищем…</p>}
      {!loading && data && data.length === 0 && (
        <div className="empty-search" style={{ display: "block" }}>
          По этому запросу ничего не нашлось. Попробуйте другое слово.
        </div>
      )}
      <ul className="search-hits">
        {data?.map((hit) => (
          <li key={`${hit.type}-${hit.key}`}>
            <Link to={hit.page ? `/s/${hit.page}#${hit.anchor}` : `/t/${hit.key}`}>{hit.title}</Link>{" "}
            <span className="muted small">{hit.type === "task" ? "задача" : "раздел"}</span>
            <p>{hit.snippet}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AccountPage() {
  const { user } = useAuth();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!user) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.changePassword(oldPassword, newPassword);
      setMsg({ ok: true, text: "Пароль изменён" });
      setOld("");
      setNew("");
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <div className="col">
      <h2>{user.display_name}</h2>
      <p className="lede">
        @{user.username} · роль «{ROLE_LABEL[user.role]}» — {ROLE_HINT[user.role]}.
      </p>
      <h3>Сменить пароль</h3>
      <form onSubmit={submit} style={{ maxWidth: 360 }}>
        <label className="field">
          <span>Текущий пароль</span>
          <input className="input" type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} required />
        </label>
        <label className="field">
          <span>Новый пароль</span>
          <input className="input" type="password" minLength={6} value={newPassword} onChange={(e) => setNew(e.target.value)} required />
        </label>
        {msg && (
          <div className={msg.ok ? "ok-box" : "error-box"} role={msg.ok ? "status" : "alert"}>
            {msg.text}
          </div>
        )}
        <button className="btn primary" type="submit">
          Сохранить
        </button>
      </form>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="col">
      <h2>Страница не найдена</h2>
      <p>
        <Link to="/">На главную</Link>
      </p>
    </div>
  );
}
