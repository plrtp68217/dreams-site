import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useAsync } from "../lib/useAsync";

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  const site = useAsync(() => api.site(), []);
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-hero">
          {site.data?.hero && <img src={site.data.hero} alt="Главное меню игры: Ева спит на больничной койке" />}
          <h1>DREAMS</h1>
        </div>
        <div>
          <h2 className="auth-title">{title}</h2>
          {children}
          {site.data && !site.data.allow_registration && title === "Вход" && (
            <p className="muted small" style={{ padding: "0 20px 16px", margin: 0 }}>
              Регистрация закрыта — попросите администратора создать вам учётную запись.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function useAfterAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  return () => navigate(from, { replace: true });
}

export function LoginPage() {
  const { user, login } = useAuth();
  const done = useAfterAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      done();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Вход">
      <form onSubmit={submit}>
        <label className="field">
          <span>Логин</span>
          <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="error-box" role="alert">{error}</div>}
        <div className="btn-row">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
          <Link to="/register">Создать учётную запись</Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const done = useAfterAuth();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== password2) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(username.trim(), password, displayName.trim() || undefined);
      done();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Регистрация">
      <form onSubmit={submit}>
        <p className="muted small" style={{ marginTop: 0 }}>
          Новые участники получают роль «Зритель» — сценарий можно читать. Права на правку выдаёт администратор.
        </p>
        <label className="field">
          <span>Логин (латиница, цифры, . _ -)</span>
          <input
            className="input"
            autoComplete="username"
            pattern="[A-Za-z0-9_.\-]{3,64}"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Имя в команде</span>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={128} />
        </label>
        <label className="field">
          <span>Пароль (от 6 символов)</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Пароль ещё раз</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            required
          />
        </label>
        {error && <div className="error-box" role="alert">{error}</div>}
        <div className="btn-row">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Создаём…" : "Зарегистрироваться"}
          </button>
          <Link to="/login">Уже есть учётная запись</Link>
        </div>
      </form>
    </AuthShell>
  );
}
