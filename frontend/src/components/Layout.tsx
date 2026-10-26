import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ScenarioProvider } from "../lib/ScenarioContext";
import { Sidebar } from "./Sidebar";

export function Layout() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const nav = document.getElementById("nav");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () => Array.from(nav?.querySelectorAll<HTMLElement>("a[href], button, input") ?? [])
      .filter((element) => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const close = () => setOpen(false);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const elements = controls();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    const desktop = window.matchMedia("(min-width: 901px)");
    desktop.addEventListener("change", close);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keyboard);
      desktop.removeEventListener("change", close);
      menuRef.current?.focus();
    };
  }, [open]);
  return (
    <ScenarioProvider>
      <div className="shell">
        <a className="skip-link" href="#top">К содержимому</a>
        <Sidebar open={open} onNavigate={() => setOpen(false)} />
        {open && <button className="nav-backdrop" aria-label="Закрыть содержание" tabIndex={-1} onClick={() => setOpen(false)} />}
        <main id="top" tabIndex={-1} inert={open}>
          <div className="mobile-header">
            <span className="mobile-brand">СНЫ</span>
          <button
            ref={menuRef}
            className="menu-btn"
            type="button"
            aria-controls="nav"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            Содержание
          </button>
          </div>
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

export function RequireTeam({
  children,
  text = "Редактировать сценарий могут только участники команды.",
}: {
  children: React.ReactNode;
  text?: string;
}) {
  const { isTeam } = useAuth();
  if (!isTeam) return <Forbidden text={text} />;
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
