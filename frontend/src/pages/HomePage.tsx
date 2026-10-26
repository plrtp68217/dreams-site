import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { TaskBrief } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { TaskStatusPill } from "../components/StatusControls";
import { TaskPlaceLink } from "../components/TaskCard";
import { relativeTime, ROLE_LABEL, taskRef, TASK_STATUSES, TASK_STATUS_LABEL } from "../lib/labels";
import {
  buildNews,
  groupByDay,
  matchesFilter,
  summarize,
  takeLastVisit,
  type NewsFilter,
  type NewsItem,
} from "../lib/news";
import { useScenario } from "../lib/ScenarioContext";
import { useAsync } from "../lib/useAsync";

const DAYS = 30;
const PAGE = 25;

const FILTERS: Array<[NewsFilter, string]> = [
  ["all", "Всё"],
  ["tasks", "Задачи"],
  ["scenario", "Сценарий"],
  ["comments", "Обсуждения"],
];

const FIELD: Record<string, string> = { title: "название", content: "текст", kind: "тип", place: "место", section: "раздел" };

const KIND_LABEL: Record<NewsItem["kind"], string> = {
  "task-new": "Новая задача",
  "task-comment": "Обсуждение",
  "task-status": "Статус",
  "task-update": "Задача",
  "section-new": "Новый раздел",
  scenario: "Сценарий",
  "section-status": "Раздел",
  team: "Команда",
  removed: "Удалено",
};

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

function TaskTitle({ item, task }: { item: NewsItem; task?: TaskBrief }) {
  return (
    <Link to={`/t/${item.entityKey}`} className="news-title">
      <span className="qid">{taskRef(item.entityKey)}</span> {task?.title ?? item.label}
    </Link>
  );
}

/** One story: what happened, who and when, and enough context to decide whether to click. */
function NewsCard({ item, task, isNew }: { item: NewsItem; task?: TaskBrief; isNew: boolean }) {
  const who = item.user?.display_name ?? "Кто-то";
  const count = item.events.length;
  let body: ReactNode = null;
  let headline: ReactNode;

  switch (item.kind) {
    case "task-new":
      headline = <TaskTitle item={item} task={task} />;
      body = (
        <>
          <p className="news-meta-line">
            {task && <TaskStatusPill status={task.status} />}
            {(task?.assignee?.display_name ?? item.text) && <span>Исполнитель: {task?.assignee?.display_name ?? item.text}</span>}
          </p>
          {task && <TaskPlaceLink task={task} prefix="↳ " />}
        </>
      );
      break;
    case "task-comment":
      headline = <TaskTitle item={item} task={task} />;
      body = (
        <>
          {item.from && item.to && (
            <p className="news-meta-line">
              <TaskStatusPill status={item.from} /> → <TaskStatusPill status={item.to} />
            </p>
          )}
          <blockquote className="news-quote">
            <Link to={`/t/${item.entityKey}#comments`}>{item.text}</Link>
          </blockquote>
        </>
      );
      break;
    case "task-status":
      headline = <TaskTitle item={item} task={task} />;
      body = item.from && item.to && (
        <p className="news-meta-line">
          <TaskStatusPill status={item.from} /> → <TaskStatusPill status={item.to} />
        </p>
      );
      break;
    case "task-update":
      headline = <TaskTitle item={item} task={task} />;
      body = (
        <p className="news-meta-line muted">
          {item.events
            .map((e) => {
              const d = e.details as Record<string, unknown>;
              if (e.action === "task.assignee") return d.to ? `исполнитель — ${d.to}` : "снят исполнитель";
              if (e.action === "task.reviewer") return d.to ? `проверяющий — ${d.to}` : "снят проверяющий";
              if (e.action === "task.restore") return `восстановлена версия ${d.version}`;
              return `изменено: ${((d.fields as string[]) ?? []).map((f) => FIELD[f] ?? f).join(", ")}`;
            })
            .filter((t, i, all) => all.indexOf(t) === i)
            .join(" · ")}
        </p>
      );
      break;
    case "scenario":
    case "section-new":
    case "section-status":
      headline = (
        <Link to={`/s/${item.entityKey}`} className="news-title">
          {item.label}
        </Link>
      );
      body = (
        <p className="news-meta-line muted">
          {item.kind === "section-new" && "новый раздел"}
          {item.kind === "section-status" && "сменился статус раздела"}
          {item.kind === "scenario" &&
            `${count} ${plural(count, "правка", "правки", "правок")}` +
              (item.fields?.length ? ` · ${item.fields.map((f) => FIELD[f] ?? f).join(", ")}` : "")}
        </p>
      );
      break;
    case "team":
      headline = <span className="news-title">{item.label}</span>;
      body = (
        <p className="news-meta-line muted">
          {item.events[0].action === "user.create" ? "новый участник" : "новая роль"}
          {item.text && ROLE_LABEL[item.text as keyof typeof ROLE_LABEL] ? ` · ${ROLE_LABEL[item.text as keyof typeof ROLE_LABEL]}` : ""}
        </p>
      );
      break;
    case "removed":
      headline = <span className="news-title">{item.entityType === "task" ? `${taskRef(item.entityKey)} ${item.label}` : item.label}</span>;
      body = <p className="news-meta-line muted">{item.entityType === "task" ? "задача удалена" : "раздел удалён"}</p>;
      break;
  }

  return (
    <li className={`news-card news-${item.kind}${isNew ? " is-new" : ""}`}>
      <div className="news-top">
        <span className="news-kind">{KIND_LABEL[item.kind]}</span>
        {isNew && <span className="news-new">новое</span>}
        <span className="news-who">
          {who} · <time dateTime={item.at}>{relativeTime(item.at)}</time>
        </span>
      </div>
      <div className="news-headline">{headline}</div>
      {body}
    </li>
  );
}

function SideList({ title, tasks, empty, testId }: { title: string; tasks: TaskBrief[]; empty: string; testId: string }) {
  return (
    <section className="side-block" data-testid={testId}>
      <h3>{title}</h3>
      {tasks.length ? (
        <ul>
          {tasks.map((t) => (
            <li key={t.id}>
              <Link to={`/t/${t.id}`}>
                {taskRef(t.id)} · {t.title}
              </Link>{" "}
              <TaskStatusPill status={t.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{empty}</p>
      )}
    </section>
  );
}

export function HomePage() {
  const { user, isTeam } = useAuth();
  const { progress } = useScenario();
  const [filter, setFilter] = useState<NewsFilter>("all");
  const [shown, setShown] = useState(PAGE);
  const [lastVisit] = useState(() => (user ? takeLastVisit(user.id) : null));

  const activity = useAsync(
    () => api.activity({ limit: 200, since: new Date(Date.now() - DAYS * 86_400_000).toISOString() }),
    [],
  );
  const tasks = useAsync(() => api.tasks(), []);
  const byId = useMemo(() => new Map((tasks.data ?? []).map((t) => [String(t.id), t])), [tasks.data]);
  const news = useMemo(() => buildNews(activity.data?.items ?? []), [activity.data]);
  const fresh = lastVisit ? news.filter((n) => Date.parse(n.at) > Date.parse(lastVisit) && n.user?.id !== user?.id) : [];
  const visible = news.filter((n) => matchesFilter(n, filter));
  const summary = summarize(fresh);

  const mine = (tasks.data ?? []).filter((t) => t.assignee?.id === user?.id && t.status !== "done");
  const toReview = (tasks.data ?? []).filter(
    (t) => t.status === "review" && (!t.reviewer || t.reviewer.id === user?.id) && t.assignee?.id !== user?.id,
  );

  return (
    <div className="home">
      <header className="home-head">
        <h1>DREAMS</h1>
        <p>
          Сценарий и задачи команды: что изменилось за последние {DAYS} дней.
          {isTeam ? "" : " У вас доступ на чтение — правки вносит команда."}
        </p>
      </header>

      <nav className="workspace-shortcuts" aria-label="Быстрый переход">
        <Link to="/s/overview"><strong>Читать сценарий</strong><span>История, уровни и последовательность событий</span></Link>
        <Link to="/tasks"><strong>Открыть задачи</strong><span>Работа команды и текущие статусы</span></Link>
      </nav>

      <div className="home-grid">
        <section className="news" aria-label="Что нового">
          <h2>Что нового</h2>
          {lastVisit && activity.data && (
            <p className="news-summary" role="status">
              {summary.length
                ? `С вашего прошлого визита: ${summary.join(", ")}.`
                : "С вашего прошлого визита ничего нового."}
            </p>
          )}
          <div className="chips" role="group" aria-label="Показывать">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`chip${filter === value ? " active" : ""}`}
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setShown(PAGE);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {activity.error && <div className="error-box" role="alert">{activity.error}</div>}
          {activity.data && visible.length === 0 && (
            <p className="empty-board">
              {filter === "all" ? `За последние ${DAYS} дней ничего не происходило.` : "Здесь пока пусто."}
            </p>
          )}
          {groupByDay(visible.slice(0, shown)).map(({ day, items }) => (
            <section key={day} className="news-day" aria-label={day}>
              <h3>{day}</h3>
              <ul className="news-list">
                {items.map((item) => (
                  <NewsCard
                    key={item.key}
                    item={item}
                    task={item.entityType === "task" ? byId.get(item.entityKey) : undefined}
                    isNew={fresh.includes(item)}
                  />
                ))}
              </ul>
            </section>
          ))}
          {visible.length > shown && (
            <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>
              Показать ещё ({visible.length - shown})
            </button>
          )}
          <p>
            <Link to="/activity">Вся активность команды →</Link>
          </p>
        </section>

        <aside className="home-side">
          {isTeam && (
            <SideList title="Мои задачи" tasks={mine} empty="На вас ничего не назначено." testId="my-tasks" />
          )}
          {isTeam && (
            <SideList title="Ждут проверки" tasks={toReview} empty="Проверять нечего." testId="to-review" />
          )}
          <section className="side-block">
            <h3>Прогресс</h3>
            <div className="stats">
              {TASK_STATUSES.map((s) => (
                <Link key={s} className={`stat ts-${s}`} to={`/tasks?status=${s}`}>
                  <strong>{progress?.by_status[s] ?? "—"}</strong>
                  <span>{TASK_STATUS_LABEL[s]}</span>
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
