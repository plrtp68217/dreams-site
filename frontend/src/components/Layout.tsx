import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ScenarioProvider } from "../lib/ScenarioContext";
import { Sidebar } from "./Sidebar";

export function Layout() {
  const [open, setOpen] = useState(false);
  return (
    <ScenarioProvider>
      <div className="shell">
        <Sidebar open={open} onNavigate={() => setOpen(false)} />
        <main id="top">
          <button
            className="menu-btn"
            type="button"
            aria-controls="nav"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            Содержание
          </button>
          <Outlet />
        </main>
      </div>
    </ScenarioProvider>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="loading">Загрузка…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.hash }} />;
  return <>{children}</>;
}

export function RequireTeam({ children }: { children: React.ReactNode }) {
  const { isTeam } = useAuth();
  if (!isTeam) return <Forbidden text="Редактировать сценарий могут только участники команды." />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Forbidden text="Раздел доступен только администраторам." />;
  return <>{children}</>;
}

function Forbidden({ text }: { text: string }) {
  return (
    <div className="col">
      <h2>Нет доступа</h2>
      <p className="lede">{text}</p>
    </div>
  );
}
