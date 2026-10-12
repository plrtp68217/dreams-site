# «СНЫ» — сценарий для разработки

Совместный редактор сценария игры: React (Vite + TypeScript) + FastAPI (SQLAlchemy, SQLite).

- **Авторизация** — логин/пароль, JWT. Первый зарегистрированный пользователь становится администратором.
- **Роли**
  | Роль | Может |
  |---|---|
  | Зритель (`viewer`) | читать сценарий, доску задач, историю и активность |
  | Команда (`editor`) | всё выше + править тексты разделов и задач, менять статусы, назначать исполнителей, создавать разделы/задачи, загружать картинки, откатывать версии |
  | Администратор (`admin`) | всё выше + выдавать роли, отключать учётные записи, сбрасывать пароли, удалять разделы и задачи |
- **Редактирование** — у каждого раздела и задачи есть редактор с панелью блоков (реплика, записка, заметка, таблица, выбор…), загрузкой изображений и живым предпросмотром. Правки версионируются: если двое правят одно и то же, второй получит предупреждение о конфликте, а не молча затрёт чужой текст. Любую прошлую версию можно посмотреть и восстановить.
- **Статусы**
  - задачи: Не начато → В работе → На проверке → Готово; доска задач с фильтрами по типу, разделу и исполнителю;
  - разделы: расписано полностью / есть концепт / восстановлено по скриншотам / нет в сценарии.
- **Активность** — лента всех изменений и сводка по каждому участнику команды (правки, смены статусов, последняя активность).

## Запуск для разработки

Нужны Python 3.11+ и Node 20+.

```bash
# backend — http://127.0.0.1:8000 (документация API: /docs)
cd backend
python -m venv .venv
.venv\Scripts\activate            # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload

# frontend — http://127.0.0.1:5173 (проксирует /api и /media на backend)
cd frontend
npm install
npm run dev
```

При первом старте база `backend/dreams.db` заполняется сценарием из `backend/app/seed_data/scenario.json`,
а картинки лежат в `backend/media/`. Затем откройте сайт и зарегистрируйтесь — вы станете администратором.

## Тесты

```bash
cd backend && .venv\Scripts\python -m pytest --cov=app
cd frontend && npm test            # или npm run coverage
cd frontend && npm run typecheck
```

## Настройки backend

Переменные окружения (или файл `backend/.env`) с префиксом `DREAMS_`:

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `DREAMS_DATABASE_URL` | `sqlite:///backend/dreams.db` | любая БД, поддерживаемая SQLAlchemy |
| `DREAMS_SECRET_KEY` | генерируется в `backend/.secret_key` | ключ подписи токенов |
| `DREAMS_ALLOW_REGISTRATION` | `true` | `false` — пользователей создаёт только админ |
| `DREAMS_ADMIN_USERNAME` / `DREAMS_ADMIN_PASSWORD` | — | создать администратора при старте |
| `DREAMS_TOKEN_TTL_MINUTES` | `10080` (7 дней) | срок жизни входа |
| `DREAMS_CORS_ORIGINS` | `["http://localhost:5173", ...]` | если фронтенд на другом домене |

Обслуживание:

```bash
python -m app.cli create-admin <логин> <пароль>
python -m app.cli set-role <логин> viewer|editor|admin
python -m app.cli reseed      # стереть разделы/задачи и заново импортировать сценарий
```

## Структура

```
backend/
  app/            FastAPI: models, routers (auth, users, sections, tasks, activity, misc), seed, cli
  app/seed_data/  scenario.json — сценарий, извлечённый из старого сайта
  media/          картинки (из старого сайта и загруженные)
  tools/import_legacy.py  повторный импорт legacy/index.html → seed_data + media
  tests/
frontend/
  src/api         клиент API и типы
  src/components  рендер сценария, карточки задач, редактор, история
  src/pages       страницы
  src/styles      scenario.css — стили исходного сайта, app.css — новый интерфейс
legacy/index.html исходный одностраничный сайт
```

Текст разделов хранится как HTML с классами исходного сайта (`line`, `note`, `callout`, `quest`…).
Карточки задач встраиваются в текст тегом `<div data-task="FF-V01"></div>`; старые внутренние ссылки
вида `#ff-v01` продолжают работать — они ведут на нужную страницу и прокручивают к задаче.
HTML очищается и на сервере (nh3), и в браузере (DOMPurify).
