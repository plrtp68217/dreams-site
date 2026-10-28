import { useState, type FormEvent } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import type { SectionGroup, SectionNode } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useChatUnread } from "../lib/chats";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { GROUP_LABEL, ROLE_LABEL } from "../lib/labels";
import { useScenario } from "../lib/ScenarioContext";
import { toggleTheme } from "../lib/theme";

const GROUPS: SectionGroup[] = ["main", "levels", "reference"];

function NodeLink({ node, top, onNavigate }: { node: SectionNode; top: string; onNavigate: () => void }) {
  const isTop = node.slug === top;
  return (
    <li>
      {isTop ? (
        <NavLink to={`/s/${node.slug}`} className={({ isActive }) => (isActive ? "active" : "")} onClick={onNavigate}>
          <span className={`dot ${node.status}`} />
          {node.title}
        </NavLink>
      ) : (
        <Link to={`/s/${top}#${node.slug}`} onClick={onNavigate}>
          {node.title}
        </Link>
      )}
      {node.children.length > 0 && (
        <ol>
          {node.children.map((c) => (
            <NodeLink key={c.slug} node={c} top={top} onNavigate={onNavigate} />
          ))}
        </ol>
      )}
    </li>
  );
}

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { user, isTeam, isAdmin, logout } = useAuth();
  const { tree, progress } = useScenario();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const unread = useChatUnread(isTeam);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    onNavigate();
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;

  return (
    <aside className={`nav${open ? " open" : ""}`} id="nav" aria-label="Навигация по сценарию">
      <button className="nav-close btn" type="button" onClick={onNavigate}><Icon name="close" />Закрыть содержание</button>
      <p className="brand">
        <Link to="/" style={{ color: "inherit", textDecoration: "none" }} onClick={onNavigate}>
          DREAMS
        </Link>
      </p>
      <p className="brand-sub">Сценарий для разработки</p>
      <form className="search-form" role="search" onSubmit={submit}>
        <Icon name="search" />
        <input
          className="search"
          type="search"
          placeholder="Поиск по сценарию…"
          aria-label="Поиск по сценарию"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      <div className="progress">
        <span data-testid="progress-text">
          Готово: {done} из {total} задач
        </span>
        <div className="bar">
          <i style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
        </div>
      </div>

      <ol className="app-links">
        <li><NavLink to="/" end onClick={onNavigate}><Icon name="home" />Главная</NavLink></li>
        <li>
          <NavLink to="/tasks" onClick={onNavigate}><Icon name="tasks" />Доска задач</NavLink>
        </li>
        {isTeam && (
          <li>
            <NavLink to="/chats" onClick={onNavigate}>
              <Icon name="chat" />Чаты
              {unread > 0 && (
                <span className="unread" aria-label={`Непрочитанных сообщений: ${unread}`}>
                  {unread}
                </span>
              )}
            </NavLink>
          </li>
        )}
        <li>
          <NavLink to="/activity" onClick={onNavigate}><Icon name="activity" />Активность команды</NavLink>
        </li>
        {isAdmin && (
          <li>
            <NavLink to="/admin/users" onClick={onNavigate}><Icon name="users" />Пользователи и роли</NavLink>
          </li>
        )}
      </ol>

      {GROUPS.map((group) => {
        const nodes = tree.filter((n) => n.group === group);
        if (!nodes.length) return null;
        return (
          <div key={group}>
            {GROUP_LABEL[group] && <p className="grp">{GROUP_LABEL[group]}</p>}
            <ol>
              {nodes.map((n) => (
                <NodeLink key={n.slug} node={n} top={n.slug} onNavigate={onNavigate} />
              ))}
            </ol>
          </div>
        );
      })}

      <div className="nav-actions">
        {isTeam && (
          <Link className="btn small" to="/new/section" onClick={onNavigate}>
            + Раздел
          </Link>
        )}
        <button className="theme-btn" type="button" onClick={() => toggleTheme()}>
          Сменить тему
        </button>
      </div>

      {user && (
        <div className="userbox">
          <div className="userbox-head">
            <Avatar user={user} size={36} />
            <div>
              <b>{user.display_name}</b>
              <span className={`role-badge ${user.role}`}>{ROLE_LABEL[user.role]}</span>
            </div>
          </div>
          <div className="nav-actions">
            <Link className="btn small" to="/account" onClick={onNavigate}>
              Профиль
            </Link>
            <button className="btn small" type="button" onClick={logout}>
              Выйти
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
