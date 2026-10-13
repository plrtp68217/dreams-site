import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { activityLink, describeActivity, relativeTime, taskRef, TASK_STATUSES, TASK_STATUS_LABEL } from "../lib/labels";
import { useScenario } from "../lib/ScenarioContext";
import { useAsync } from "../lib/useAsync";

export function HomePage() {
  const { user, isTeam } = useAuth();
  const { progress } = useScenario();
  const site = useAsync(() => api.site(), []);
  const recent = useAsync(() => api.activity({ limit: 6 }), []);
  const mine = useAsync(
    () => (isTeam && user ? api.tasks({ assignee_id: user.id }) : Promise.resolve([])),
    [isTeam, user?.id],
  );

  return (
    <div className="col">
      <div className="hero">
        {site.data?.hero && <img src={site.data.hero} alt="Главное меню игры: Ева спит на больничной койке, в окне луна" />}
        <div className="hero-txt">
          <h1>DREAMS</h1>
          <p>
            Сценарий 2D-приключения и психологического триллера, разложенный по уровням, заданиям, репликам и флагам.
            {isTeam
              ? " Вы в команде: можно править тексты, заводить задачи и назначать исполнителей."
              : " У вас доступ на чтение — правки вносит команда."}
          </p>
        </div>
      </div>

      <h2>Прогресс</h2>
      <div className="stats">
        {TASK_STATUSES.map((s) => (
          <Link key={s} className={`stat ts-${s}`} to={`/tasks?status=${s}`}>
            <strong>{progress?.by_status[s] ?? "—"}</strong>
            <span>{TASK_STATUS_LABEL[s]}</span>
          </Link>
        ))}
      </div>

      {isTeam && (
        <section>
          <h3>Мои задачи</h3>
          {mine.data && mine.data.length > 0 ? (
            <ul>
              {mine.data.map((t) => (
                <li key={t.id}>
                  <Link to={`/t/${t.id}`}>
                    {taskRef(t.id)} · {t.title}
                  </Link>{" "}
                  <span className="muted small">— {TASK_STATUS_LABEL[t.status]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              На вас пока ничего не назначено. Задачи и исполнителей ведут на <Link to="/tasks">доске задач</Link>.
            </p>
          )}
        </section>
      )}

      <section>
        <h3>Последние изменения</h3>
        {recent.data?.items.length ? (
          <ul className="feed">
            {recent.data.items.map((item) => {
              const href = activityLink(item);
              return (
                <li key={item.id}>
                  <time dateTime={item.created_at}>{relativeTime(item.created_at)}</time>
                  <span>
                    <b>{item.user?.display_name ?? "Кто-то"}</b>{" "}
                    {href ? <Link to={href}>{describeActivity(item)}</Link> : describeActivity(item)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">Пока тихо.</p>
        )}
        <p>
          <Link to="/activity">Вся активность команды →</Link>
        </p>
      </section>
    </div>
  );
}
