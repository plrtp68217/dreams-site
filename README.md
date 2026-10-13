# «СНЫ» — сценарий для разработки

Совместный редактор сценария игры и доска задач команды: React (Vite + TypeScript) + FastAPI (SQLAlchemy, SQLite).

- [Возможности](#возможности)
- [Развёртывание на VPS (Docker, dreams.plrtp.ru)](#развёртывание-на-vps-docker-dreamsplrtpru)
- [Запуск для разработки](#запуск-для-разработки)
- [Настройки](#настройки)
- [Устройство](#устройство)

## Возможности

- **Вход** — логин/пароль, JWT. На сервере администратор создаётся из `.env`, остальных он заводит сам
  («Пользователи и роли»). При открытой регистрации первый зарегистрированный становится администратором.
- **Роли**
  | Роль | Может |
  |---|---|
  | Зритель (`viewer`) | читать сценарий, доску задач, историю и активность |
  | Команда (`editor`) | всё выше + править тексты разделов, создавать и править задачи, менять статусы, назначать исполнителей, создавать разделы, загружать картинки, откатывать версии |
  | Администратор (`admin`) | всё выше + выдавать роли, отключать учётные записи, сбрасывать пароли, удалять разделы и задачи |
- **Текст в Markdown** — без HTML-тегов, с несколькими блоками для сценария:
  ```
  > **Клоун:** Ты заказала это сама.          реплика
  > *Громкая связь:* Касса закрыта.           надпись / объявление
  ::: заметка Заголовок … :::                 заметка (ещё: нет-в-сценарии, записка, карточка,
                                              вводка, характеристики, выбор, этапы, дневник, плакаты)
  `ff_side_done`                              флаг
  ```
  В редакторе — кнопки для вставки блоков, шпаргалка, загрузка изображений и предпросмотр (его рисует сервер, так что
  он совпадает с сохранённым видом). Правки версионируются: если двое правят одно и то же, второй получит
  предупреждение о конфликте, а не молча затрёт чужой текст. Любую прошлую версию можно посмотреть и восстановить.
- **Задачи** — отдельно от текста, нумеруются по порядку: `#1`, `#2`… У задачи есть название, описание (Markdown),
  тип (сценарий, геймдизайн, арт, программирование, звук, прочее), исполнитель и **место в сценарии**: раздел и, при
  желании, конкретная реплика, записка, заметка, заголовок или карточка. Исполнитель открывает задачу и одним кликом
  попадает в нужное место — оно подсвечивается. Создать задачу можно на доске («+ Новая задача») или прямо из текста:
  у реплик и других мест при наведении появляется «+ задача».
- **Статусы** — задачи: Не начато → В работе → На проверке → Готово (доска с фильтрами по типу, разделу и
  исполнителю); разделы: расписано полностью / есть концепт / восстановлено по скриншотам / нет в сценарии.
- **Активность** — у каждого участника график как на GitHub: год по дням, квадратик тем темнее, чем больше действий
  (шкала общая для команды). Ниже — лента всех изменений с фильтром по участнику.

## Развёртывание на VPS (Docker, dreams.plrtp.ru)

Схема: два контейнера — `backend` (FastAPI, база и картинки в томе `dreams-data`) и `web` (nginx со собранным
фронтендом, проксирует `/api` и `/media` в backend). `web` слушает только `127.0.0.1:8080`; домен и HTTPS даёт nginx
на самом сервере.

```
браузер ──https──▶ nginx на VPS (dreams.plrtp.ru, сертификат Let's Encrypt)
                     └──▶ 127.0.0.1:8080 ─ контейнер web ─┬─ статика фронтенда
                                                          └─ /api, /media ─▶ контейнер backend ─▶ том dreams-data
```

Нужен VPS на Ubuntu 22.04/24.04 (или Debian 12) с 1 ГБ памяти и доступ по SSH с правами sudo. Команды ниже
выполняются на сервере.

### 1. DNS

В панели, где управляется зона `plrtp.ru`, добавьте запись:

| Тип | Имя | Значение |
|---|---|---|
| `A` | `dreams` | IPv4-адрес VPS |
| `AAAA` | `dreams` | IPv6-адрес VPS (если есть) |

Проверка (обновление может занять до часа): `dig +short dreams.plrtp.ru` должен вернуть адрес сервера.

### 2. Docker, nginx, certbot, файрвол

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh          # Docker Engine + плагин compose
sudo usermod -aG docker $USER                         # затем перелогиньтесь, чтобы работать без sudo
sudo apt install -y nginx certbot python3-certbot-nginx git

sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'                           # 80 и 443
sudo ufw enable
```

Проверка: `docker compose version`, `systemctl status nginx`.

### 3. Код

```bash
sudo mkdir -p /opt/dreams && sudo chown $USER: /opt/dreams
git clone <адрес репозитория> /opt/dreams            # или скопируйте папку: rsync -av --exclude node_modules
cd /opt/dreams                                        #   --exclude .venv ./ user@сервер:/opt/dreams/
```

### 4. Настройки (`.env`)

```bash
cp .env.example .env
openssl rand -base64 48                                # вставьте результат в DREAMS_SECRET_KEY
nano .env
```

Обязательно заполните `DREAMS_SECRET_KEY` (ключ подписи входа; если его сменить, всех разлогинит) и
`DREAMS_ADMIN_PASSWORD`. `DREAMS_ALLOW_REGISTRATION=false` оставьте как есть: на публичном сервере при открытой
регистрации кто угодно сможет читать сценарий. Файл `.env` в git не попадает.

### 5. Запуск контейнеров

```bash
docker compose up -d --build
docker compose ps                                     # оба сервиса running, backend — healthy
curl -s http://127.0.0.1:8080/api/health              # {"ok":true}
docker compose logs -f backend                        # логи (Ctrl+C — выйти)
```

При первом старте база заполняется сценарием, создаётся администратор из `.env`. Контейнеры перезапускаются сами
после перезагрузки сервера (`restart: unless-stopped`).

### 6. nginx для dreams.plrtp.ru и HTTPS

Готовый конфиг — `deploy/nginx-dreams.plrtp.ru.conf`:

```bash
sudo cp deploy/nginx-dreams.plrtp.ru.conf /etc/nginx/sites-available/dreams.plrtp.ru
sudo ln -s /etc/nginx/sites-available/dreams.plrtp.ru /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d dreams.plrtp.ru               # e-mail, согласие; certbot сам допишет HTTPS и редирект
```

Что в конфиге: сервер `dreams.plrtp.ru` на 80-м порту проксирует всё на `127.0.0.1:8080`, передаёт заголовки
`Host`, `X-Forwarded-For`, `X-Forwarded-Proto` и разрешает загрузку файлов до 12 МБ (`client_max_body_size`; сам
сайт принимает картинки до 10 МБ). Certbot добавит блок `listen 443 ssl` с сертификатом и редирект с http на https.
Сертификат продлевается автоматически (`systemctl list-timers | grep certbot`; проверка — `sudo certbot renew --dry-run`).

Если на сервере уже работают другие сайты `plrtp.ru` — ничего менять в них не нужно: это отдельный `server`
со своим `server_name`. Если порт 8080 занят, поменяйте `WEB_PORT` в `.env` и порт в конфиге nginx.

### 7. Первый вход

Откройте https://dreams.plrtp.ru, войдите как администратор из `.env`, смените пароль («Профиль»), затем в
«Пользователи и роли» создайте учётные записи команды и выдайте роль «Команда».

### Перенос существующей базы (необязательно)

Если сценарий уже правили локально, перенесите `backend/dreams.db` и загруженные картинки `backend/media/upload-*`
в том сервера:

```bash
# с компьютера
scp backend/dreams.db backend/media/upload-* user@сервер:/tmp/dreams-import/

# на сервере
cd /opt/dreams
docker compose stop backend
docker run --rm -v dreams_dreams-data:/data -v /tmp/dreams-import:/import alpine sh -c \
  'cp /import/dreams.db /data/dreams.db && mkdir -p /data/media && cp /import/upload-* /data/media/ 2>/dev/null; chown -R 1000:1000 /data'
docker compose start backend
```

Пользователи переносятся вместе с базой. Администратор из `.env` создаётся, только если пользователя с таким логином нет.

### Обновление

```bash
cd /opt/dreams
./deploy/backup.sh                                    # на всякий случай
git pull
docker compose up -d --build
```

Миграции базы выполняются автоматически при старте backend; перед каждой рядом с базой в томе сохраняется копия
`dreams.before-<шаг>-<дата>.db`.

### Резервные копии

`deploy/backup.sh` делает согласованную копию SQLite-базы (без остановки сайта) и архивирует её вместе с картинками в
`backups/dreams-<дата>.tar.gz`, храня последние 14. Ежедневно в 04:00:

```bash
chmod +x deploy/backup.sh
mkdir -p backups && (crontab -l 2>/dev/null; echo '0 4 * * * cd /opt/dreams && ./deploy/backup.sh >> backups/backup.log 2>&1') | crontab -
```

Копии лучше дополнительно уносить с сервера (`scp`/`rsync` на другую машину или в облако).

Восстановление из архива:

```bash
docker compose stop backend
mkdir -p /tmp/restore && tar xzf backups/dreams-<дата>.tar.gz -C /tmp/restore
docker run --rm -v dreams_dreams-data:/data -v /tmp/restore:/restore alpine sh -c \
  'cp /restore/backup.db /data/dreams.db && cp -r /restore/media/. /data/media/ && chown -R 1000:1000 /data'
docker compose start backend
```

### Полезные команды

```bash
docker compose logs --tail 100 backend                # последние ошибки backend
docker compose restart backend
docker compose exec backend python -m app.cli create-admin <логин> <пароль>
docker compose exec backend python -m app.cli set-role <логин> viewer|editor|admin
docker compose down                                   # остановить (данные в томе сохраняются)
```

`docker compose down -v` удаляет и том с базой — не используйте его без свежей копии.

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

При первом старте база `backend/dreams.db` заполняется сценарием из `backend/app/seed_data/scenario.json` (доска
задач пустая), картинки лежат в `backend/media/`. Откройте сайт и зарегистрируйтесь — вы станете администратором.

Тесты:

```bash
cd backend && .venv\Scripts\python -m pytest --cov=app
cd frontend && npm test            # или npm run coverage
cd frontend && npm run typecheck
```

## Настройки

Переменные окружения backend (в Docker — файл `.env` в корне, локально — `backend/.env`), префикс `DREAMS_`:

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `DREAMS_SECRET_KEY` | локально генерируется в `backend/.secret_key`; в Docker обязателен | ключ подписи входа |
| `DREAMS_ADMIN_USERNAME` / `DREAMS_ADMIN_PASSWORD` | — | создать администратора при старте |
| `DREAMS_ALLOW_REGISTRATION` | `true` (в `.env.example` — `false`) | `false` — пользователей создаёт только админ |
| `DREAMS_TOKEN_TTL_MINUTES` | `10080` (7 дней) | срок жизни входа |
| `DREAMS_DATABASE_URL` | `sqlite:///backend/dreams.db`, в Docker `sqlite:////data/dreams.db` | любая БД, поддерживаемая SQLAlchemy |
| `DREAMS_MEDIA_DIR` | `backend/media`, в Docker `/data/media` | картинки |
| `DREAMS_MAX_UPLOAD_MB` | `10` | предельный размер загружаемой картинки |
| `DREAMS_CORS_ORIGINS` | `["http://localhost:5173", ...]` | нужен, только если фронтенд на другом домене |

Обслуживание (локально; в Docker — через `docker compose exec backend …`):

```bash
python -m app.cli create-admin <логин> <пароль>
python -m app.cli set-role <логин> viewer|editor|admin
python -m app.cli reseed      # стереть разделы/задачи и заново импортировать сценарий
```

## Устройство

```
backend/
  app/            FastAPI: models, routers (auth, users, sections, tasks, activity, misc), seed, cli
  app/markup.py   «сценарный» Markdown → HTML; html_to_markdown.py — обратно (для миграции)
  app/migrations.py, app/scenario_cleanup.py  обновление старых баз
  app/seed_data/  scenario.json — сценарий, извлечённый из старого сайта
  media/          картинки старого сайта
  tools/import_legacy.py  повторный импорт legacy/index.html → seed_data + media
  Dockerfile, docker-entrypoint.sh
frontend/
  src/api         клиент API и типы
  src/components  рендер сценария, редактор, задачи, график активности
  src/pages       страницы
  src/styles      scenario.css — стили исходного сайта, app.css — интерфейс
  Dockerfile, nginx.conf  сборка и nginx внутри контейнера web
deploy/           nginx для dreams.plrtp.ru, скрипт резервного копирования
docker-compose.yml, .env.example
legacy/index.html исходный одностраничный сайт
```

Текст разделов хранится дважды: исходник в Markdown (`sections.source`, его правят) и HTML, который сервер рендерит при
сохранении. Каждой реплике, записке, заметке, заголовку и карточке сервер выдаёт скрытый `data-id` — на него ссылаются
задачи (раздел + `anchor`). В Markdown этих id не видно: при сохранении сервер переносит их со старой версии на новую,
сопоставляя места по тексту, так что правка реплики не отрывает от неё задачи. Внутренние ссылки вида `#ff-v01` ведут на
нужную страницу и прокручивают к месту. HTML очищается и на сервере (nh3), и в браузере (DOMPurify).

Старые базы (где задачи были карточками с кодами `FF-V01`, `LOC-FF-05`…, а текст — HTML) обновляются автоматически при
старте: карточки возвращаются в текст, предложения и коды убираются, доска очищается, текст переводится в Markdown.
Перед каждым шагом рядом с базой создаётся копия `dreams.before-<шаг>-<дата>.db`.
