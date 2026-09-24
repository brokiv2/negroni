# Negroni — локальная установка (play project)

Форк Rakazo (https://rakazo.com) для локального тестирования. Всё крутится нативно на Маке, без Docker.

## Что где лежит

| Что | Где |
|---|---|
| Приложение (Electron-клиент) | `/Applications/Negroni.app` |
| Код (репо, source of truth) | `PROJECTS/Sandbox/negroni` (iCloud Drive — не перемещать!) |
| Бэкенд (api + worker + web + supervisor) | автостарт через LaunchAgent `dev.negroni.backend` |
| Скрипт стека | `~/Library/Application Support/Negroni/negroni-stack.sh` |
| LaunchAgent | `~/Library/LaunchAgents/dev.negroni.backend.plist` |
| База | локальный Homebrew Postgres 16, порт 5432, база/юзер `rakazo` |
| Логи сервисов | `~/Library/Logs/Negroni/{api,worker,web,supervisor,backend-launchd}.log` (вне iCloud: процессам launchd macOS запрещает писать в iCloud Drive, 2026-09-17) |

## Как этим пользоваться

- **Запуск:** просто открой Negroni.app. Бэкенд стартует сам при логине (launchd, KeepAlive).
- **Ключ модели:** Settings → Models → OpenAI-compatible. Base URL `https://open.bigmodel.cn/api/paas/v4`, модель `glm-4.6` (или другая), твой ключ. Публичные хосты разрешены (`RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC=1` в `.env`).
- **Аккаунт:** purely локальный, ничего не отправляет наружу. Почта не проверяется (`EMAIL_EMULATOR=true`).

## Управление бэкендом

```bash
# остановить
launchctl bootout gui/$(id -u)/dev.negroni.backend
# запустить
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.negroni.backend.plist
# здоровье
curl http://127.0.0.1:3100/health
```

Веб-версия без приложения: http://127.0.0.1:5173

## Режим «компьютера бота»

Сейчас `SANDBOX_PROVIDER=desktop`: боты работают шеллом и файлами **прямо на этом Маке** (виртуальные директории в домашней папке). Экрана «компьютера бота» с браузером нет — это Docker-режим (`pnpm sandbox:build` + `SANDBOX_PROVIDER=docker`), можно включить позже.

## Mac Control — computer-use на локальном Маке (2026-09-03)

Боту доступно управление этим Маком через локальный MCP-сервер:

- **Сервер**: `~/Library/Application Support/Negroni/mac-control/` (`server.mjs`), MCP Streamable HTTP на `http://127.0.0.1:9400/mcp`, bearer-токен в `token.txt` (там же в LaunchAgent).
- **Автостарт**: LaunchAgent `dev.negroni.mac-control` (`launchctl kickstart -k gui/$(id -u)/dev.negroni.mac-control` для перезапуска).
- **Подключён в Negroni**: Integrations → Advanced → MCP servers → «Mac Control».
- **Инструменты**: `mac_osascript` (AppleScript — универсальный рычаг), `mac_open_url` (открыть ссылку в Comet/Chrome/Safari с залогиненными сессиями), `screen_view` (скриншот → картинка модели), `screen_click` / `screen_type` / `screen_key` / `screen_scroll` (cliclick), `screen_info` (какое приложение/окно на переднем плане, текстом), `ui_tree` (AX-дерево элементов окна текстом — работает даже без vision-модели).
- **Патч форка**: `packages/adapters/src/remote-mcp.ts` — loopback-URL разрешены по HTTP (апстрим требует HTTPS всегда). При обновлении апстрима проверить, что патч пережил merge.
- **Права macOS** (System Settings → Privacy & Security):
  - **Screen Recording → node** — чтобы работал `screen_view` (иначе «could not create image from display»).
  - **Accessibility → cliclick и node** — чтобы работали клики/клавиатура (`screen_click` и др.).
  - После выдачи прав перезапустить сервер: `launchctl kickstart -k gui/$(id -u)/dev.negroni.mac-control`.
- Без vision-модели боту доступны `screen_info` + `ui_tree` (текстовое «зрение»); `screen_view` требует модель, принимающую картинки (подключён Z.AI glm-5.3).

## Динамический список моделей (2026-09-03)

- Каталог моделей больше не только захардкоженный: `data/model-overrides.json` добавляет/расширяет модели провайдеров без правок кода. Засеян `glm-5.3-flash` (basedOn glm-5.3, 1M контекст, vision, $0.15/$0.50).
- Механика: `packages/adapters/src/catalog-overrides.ts` мержит overrides в каталог pi-ai при изменении файла (сигнатура mtime — без рестарта), подключено в pi-models / pi-runtime / model-vision.
- В Settings → Models у подключённого провайдера есть кнопка «Fetch model list from provider»: дергает живой `GET {baseUrl}/models` с сохранённым ключом (rpc `models.probeProvider`), показывает модели, чужие каталогу можно добавить кнопкой «Add to list» (rpc `models.addModelOverride` → пишет в overrides-файл, каталог обновляется сам).
- Формат записи overrides: `{ "zai": [{ "id": "...", "name": "...", "basedOn": "каталожная-модель", "contextWindow"?, "maxTokens"?, "reasoning"?, "input"?: ["text","image"] }] }`.

## Поведение чата и типографика (2026-09-03)

- **Раздумья бота скрыты.** Пока ран живой,наррация и шаги инструментов не рендерятся (Shell.tsx: live narration → null) — видно только глиф с морфящим аватаром и «‹бот› is working» (ActiveBotGlyph). После завершения остаётся свёрнутый «Worked for Ns» как история.
- **Типографика в стиле Grok**: body font-weight 350 (styles.css), у markdown strong = 550, заголовки = 500 (packages/chat-ui/src/markdown.web.css). Инлайн-код и код-блоки — `#ececf0` на тёмной заливке (фикс читаемости в светлой теме).

## Коннекторы (Composio): OAuth-колбэк и телефон (2026-09-24)

- **Куда возвращается OAuth.** `connections.begin` больше не шлёт на `WEB_ORIGIN/app`. Колбэк теперь страница API `GET /connections/callback?connection=<id>` (`apps/api/src/connection-callback.ts`). Origin выбирается по запросу: пришёл с телефона через туннель, значит публичный адрес; пришёл с Мака (127.0.0.1:3100 или веб на 5173), значит `API_URL`.
- **Env.** `PUBLIC_API_URL` (необязательный, описан в `.env.example`). Если не задан, а `NEGRONI_PUBLIC_TUNNEL_HOST` есть (его ставит `negroni-stack.sh`), берётся `https://<tunnel host>`.
- **Туннель.** `publicTunnelGate` пропускает без `x-negroni-tunnel-key` только `GET/HEAD /connections/callback`: редирект браузера не несёт заголовок. Всё остальное на туннеле по-прежнему 401. Страница ключ не содержит.
- **Что делает страница.** Сервер сам проверяет `connectionReady` и переводит строку в `connected`. На телефоне страница уводит в диплинк `negroni://integrations?connection=<id>&status=connected|pending` (плюс кнопка «Return to Negroni»). В попапе веба/десктопа закрывает окно, во вкладке пишет, что её можно закрыть.
- **Мобилка.** `expo-web-browser`: `openAuthSessionAsync(url, "negroni://integrations")`, после возврата сразу `connections.complete` и короткий поллинг (`apps/mobile/lib/connection-auth.ts`). Это нативный модуль: нужна новая сборка dev client / TestFlight, OTA не хватит.
- **ngrok free.** На верхнеуровневой навигации ngrok может показать свою заглушку. Тогда жмём «Visit Site»; если сессия всё равно закрылась, поллинг в приложении досчитает подключение сам.
- **Каталог.** Категории и описания тянутся из `composio.getClient().toolkits.list` (все страницы) и кэшируются вместе с каталогом на час. Список в вебе и на телефоне: сначала Connected, потом поиск, потом секции Popular и категории (сворачиваются), у каждой строки лого или буква в круге.

## Personal: отдельный тред ассистента (2026-09-24)

- **Модель.** У треда есть `kind`: `team` (обычный чат бота, по умолчанию) и `personal` (личный разговор с главным ассистентом). Уникальность теперь `@@unique([botId, kind])`: у бота один Team-тред и максимум один Personal. Миграция `20260924180000_thread_kind`, все старые треды остались `team`.
- **Где создаётся.** Лениво: RPC `personal.thread` находит главного ассистента (закреплённый корневой бот, `mainAssistantBot`) и создаёт ему Personal-тред при первом вызове. Любой `threads.*` принимает `threadKind: "personal"` вместе с `botId`.
- **Кто куда пишет.** Веб в режиме Personal и мобилка с `view=assistant` ходят в Personal-тред. Team-чат того же бота не меняется, в списке ботов и в поиске виден только Team-тред.
- **Раны.** Сообщение в Personal-треде запускает ран с `interactionMode: "personal"`: ассистент сам решает, звать ли `message_bot`, `spawn_bot` или `run_subagent`, пересказывает результат своими словами и не отправляет в чужие чаты. Ответ воркера возвращается в тот тред, откуда пришла просьба (по `returnToMessageId`), поэтому результат для Personal приходит в Personal.
- **Код.** `packages/db/src/thread-kind.ts` (выборка Team-треда и `ensurePersonalThread`), `apps/api/src/personal-thread.ts`, промпт роли в `packages/core/src/main-assistant.ts`.
- **Обновление.** После `git pull` нужны `pnpm db:migrate` и `pnpm db:generate`, в копии рантайма тоже `prisma generate` (`packages/db`), потом перезапуск джобы.
- **Мобилка.** Сборка dev client должна включать `expo-web-browser` (нативный модуль из коннекторов): после `pod install` в `apps/mobile/ios` пересобрать клиент. Старый клиент падает на `Cannot find native module 'ExpoWebBrowser'`.

## Нюансы

- Репо лежит в iCloud. Скрипт стека работает без tsx watch именно поэтому: watch-режим ловил рестарт-шторм от синка iCloud, и сообщения в чате «пропадали» (API умирал на лету). Не редактируй исходники во время работы ботов — горячая перезагрузка выключена, изменения подхватятся после перезапуска стека.
- Если Negroni.app не может подключиться — проверь `curl http://127.0.0.1:3100/health`; если пусто, перезапусти launchd-джобу командой выше и посмотри `~/Library/Logs/Negroni/api.log`.
- Обновление апстрима: `git pull` в `Sandbox/negroni`, потом `pnpm install && pnpm db:migrate && pnpm db:generate`, перезапустить джобу, пересобрать приложение (`pnpm --filter @rakazo/desktop pack:dir`).
- **Правки UI не подхватываются живьём**: Negroni.app отдаёт веб из своего бандла (`Contents/Resources/web`), а не с dev-сервера. После изменения веб-кода: `pnpm --filter @rakazo/web build`, потом заменить папку:
  ```bash
  rm -rf /Applications/Negroni.app/Contents/Resources/web
  cp -R apps/web/dist /Applications/Negroni.app/Contents/Resources/web
  ```
  и перезапустить приложение. (Правки бэкенда — просто перезапуск launchd-джобы.)
- **Бэкенд крутится из зеркала вне iCloud**: `~/Library/Application Support/Negroni/runtime-20260906` (см. `REPO` в `negroni-stack.sh`). Изменённые исходники api/packages нужно скопировать туда, собранный веб положить и в `/Applications/Negroni.app/Contents/Resources/web`, и в `runtime-20260906/apps/web/dist` (его отдаёт `vite preview` на 5173), потом перезапустить джобу.
- 2026-09-03: починили нечитаемый код в светлой теме — `packages/chat-ui/src/markdown.web.css`, инлайн-код и код-блоки теперь `#ececf0` на тёмной заливке.
