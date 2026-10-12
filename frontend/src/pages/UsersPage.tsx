import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Role, User } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { formatDate, ROLES, ROLE_HINT, ROLE_LABEL } from "../lib/labels";
import { useAsync } from "../lib/useAsync";

function PasswordReset({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" className="btn small" onClick={() => setOpen(true)}>
        Сбросить пароль
      </button>
    );
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.resetPassword(user.id, password);
          setMsg("Пароль изменён");
          setPassword("");
          setOpen(false);
        } catch (err) {
          setMsg((err as Error).message);
        }
      }}
    >
      <input
        className="input"
        type="password"
        minLength={6}
        placeholder="Новый пароль"
        aria-label={`Новый пароль для ${user.username}`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button className="btn small" type="submit">
        OK
      </button>
      {msg && <span className="small">{msg}</span>}
    </form>
  );
}

function CreateUser({ onCreated }: { onCreated: (u: User) => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      onCreated(await api.createUser({ username, password, display_name: displayName || undefined, role }));
      setUsername("");
      setDisplayName("");
      setPassword("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} aria-label="Новый пользователь">
      <div className="inline-form">
        <input className="input" placeholder="Логин" aria-label="Логин" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input className="input" placeholder="Имя" aria-label="Имя" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input
          className="input"
          type="password"
          placeholder="Пароль"
          aria-label="Пароль"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <select className="select" aria-label="Роль нового пользователя" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <button className="btn primary" type="submit">
          Создать
        </button>
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
    </form>
  );
}

export function UsersPage() {
  const { user: me, setUser } = useAuth();
  const { data, error, setData } = useAsync(() => api.users(), []);
  const [rowError, setRowError] = useState<string | null>(null);

  const patch = async (u: User, change: Partial<Pick<User, "role" | "is_active">>) => {
    setRowError(null);
    try {
      const updated = await api.updateUser(u.id, change);
      setData((data ?? []).map((x) => (x.id === u.id ? updated : x)));
      if (me && updated.id === me.id) setUser(updated);
    } catch (e) {
      setRowError((e as Error).message);
    }
  };

  return (
    <div className="col" style={{ maxWidth: 1000 }}>
      <h2>Пользователи и роли</h2>
      <p className="lede">
        {ROLES.map((r) => `${ROLE_LABEL[r]} — ${ROLE_HINT[r]}`).join(". ")}. Команда — это все с ролью «Команда» или
        «Администратор».
      </p>
      {(error || rowError) && <div className="error-box" role="alert">{error ?? rowError}</div>}
      <div className="tbl-wrap">
        <table className="users-table">
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Роль</th>
              <th>Доступ</th>
              <th>С нами с</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id} data-testid={`user-${u.username}`}>
                <td>
                  <b>{u.display_name}</b>
                  <br />
                  <span className="muted small">@{u.username}</span>
                </td>
                <td>
                  <select
                    className="select"
                    aria-label={`Роль ${u.username}`}
                    value={u.role}
                    onChange={(e) => patch(u, { role: e.target.value as Role })}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <label className="done-toggle">
                    <input
                      type="checkbox"
                      checked={u.is_active}
                      aria-label={`Активен ${u.username}`}
                      onChange={(e) => patch(u, { is_active: e.target.checked })}
                    />
                    {u.is_active ? "Активен" : "Отключён"}
                  </label>
                </td>
                <td className="small">{formatDate(u.created_at)}</td>
                <td>
                  <PasswordReset user={u} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Добавить пользователя</h3>
      <CreateUser onCreated={(u) => setData([...(data ?? []), u])} />
    </div>
  );
}
