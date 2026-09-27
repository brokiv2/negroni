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
- **Loopback по HTTP**: наш патч в `packages/adapters/src/remote-mcp.ts` снят при мерже апстрима v0.1.6 (2026-09-27). Апстрим теперь сам пускает `127.0.0.1` / `localhost` / `::1` по HTTP (`isLocalMcpHost`, с DNS-пиннингом), `MCP_ALLOW_PRIVATE_ENDPOINT` для loopback не нужен. Проверено живьём: непатченный код видит все 9 инструментов Mac Control.
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
- **Апстрим**: `git fetch upstream` и мерж делать в клоне вне iCloud (`~/dev/negroni`, origin = наш форк). Мерж в iCloud-папке ловит синк-шторм и оставляет файлы `<имя> 2.ts` (так было 2026-09-27: три файла откатились на версию до коммитов, правильные копии лежали рядом как ` 2.ts`). Перед любой git-операцией в iCloud-копии смотреть `git status` и такие дубликаты сверять с HEAD, а не удалять вслепую.
- **После мержа апстрима** перед сборкой TestFlight вернуть наши иконки `apps/mobile/assets/{icon,adaptive-icon,monochrome-icon}.png` (апстрим подменяет их без конфликта, а `inspect` требует равенства мобильной и десктопной).
- **Правки UI не подхватываются живьём**: Negroni.app отдаёт веб из своего бандла (`Contents/Resources/web`), а не с dev-сервера. После изменения веб-кода: `pnpm --filter @rakazo/web build`, потом заменить папку:
  ```bash
  rm -rf /Applications/Negroni.app/Contents/Resources/web
  cp -R apps/web/dist /Applications/Negroni.app/Contents/Resources/web
  ```
  и перезапустить приложение. (Правки бэкенда — просто перезапуск launchd-джобы.)
- **Бэкенд крутится из зеркала вне iCloud**: `~/Library/Application Support/Negroni/runtime-20260906` (см. `REPO` в `negroni-stack.sh`). С 2026-09-27 это нормальный git-checkout, а не россыпь скопированных файлов. Деплой: `git fetch` в зеркале из `~/dev/negroni` (ref `refs/negroni-deploy/merged`), `git checkout --force <sha>`, проверить что `.env` и `data/model-overrides.json` не изменились, `pnpm install` (Node ≥ 24.15.0), `pnpm db:generate`, при новых миграциях сначала `pg_dump -Fc` в `db-backups/` и `pnpm db:migrate`; собрать веб в `~/dev/negroni` и разложить `apps/web/dist` в `/Applications/Negroni.app/Contents/Resources/web` и в `runtime-20260906/apps/web/dist`; перезапустить джобу; проверить `/health`, хэш `index.html` на :5173, четыре процесса и логи. `negroni-stack.sh` берёт tsx по пути `node_modules/tsx/dist/cli.mjs` без версии в пути (раньше версия была зашита и ломала рестарт после каждого апдейта tsx).
- 2026-09-03: починили нечитаемый код в светлой теме — `packages/chat-ui/src/markdown.web.css`, инлайн-код и код-блоки теперь `#ececf0` на тёмной заливке.

## TestFlight (2026-09-24)

- Пайплайн: `apps/mobile/Scripts/testflight_release.sh testflight` (prepare, archive, export, inspect, upload). Перед запуском синхронизировать номер билда в трёх местах: `apps/mobile/app.json` (`ios.buildNumber`), `CURRENT_PROJECT_VERSION` в `project.pbxproj`, `CFBundleVersion` в `ios/Negroni/Info.plist`.
- Из неинтерактивного шелла запускать с `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`: без этого `pod install` падает с `Unicode Normalization not appropriate for ASCII-8BIT`.
- GitHub: `origin` = `brokiv2/negroni` (наш форк, main = состояние Negroni), `upstream` = `elie222/rakazo`; апстрим на момент форка сохранён в ветке `upstream-main`.
- Приватные env для релиза (`apps/mobile/.env.local`, `.env.testflight.local`) в git не лежат: при сборке из клона вне iCloud копировать их из iCloud-копии.
- Архивы с IPA и логами складывать в `~/Library/Developer/Negroni-Releases/build<N>/`, хранить последний подтверждённый и предыдущий. Предупреждения про dSYM для React / ReactNativeDependencies / hermesvm при загрузке штатные.
- Билд 27 (2026-09-28): первая сборка с Vesper внутри, апстрим v0.1.6, `RCTNewArchEnabled`, expo-updates. Vesper в нём недостижим (не было входа), вход добавлен в билде 28.

## Vesper — личный шелл внутри Negroni (2026-09-28)

- **Что это.** Второй шелл в том же приложении и том же бандле (`com.artempaskov.aisy`): Negroni остался командным, Vesper это личный ассистент в UI по мотивам OpenMuse (`CopilotKit/openmuse`, MIT): светлый холст, шапка с аватаром и строкой статуса, пилюля «Computer · take control», карточки результатов инструментов, композер-пилюля со стрелкой, которая во время рана становится стопом, нижняя нав-пилюля из пяти разделов (Chat, Activity, Ideas, Goals, Apps). Только светлая тема, иконки `lucide-react-native`.
- **Кем управляет.** Тем же главным ассистентом (`mainAssistantBot()`) и его Personal-тредом, что и прежний personal-режим: память, цели, рутины и компьютер общие с первого дня. Старый `assistant-hub` и тумблер Assistant/Team удалены в билде 28; вход в Vesper через тот же тумблер, теперь «Vesper / Team», выход через Apps → «Switch to Negroni». Выбор шелла хранится на устройстве (`lib/shell-mode.ts`).
- **Где код.** `apps/mobile/app/(vesper)/`, `apps/mobile/components/vesper/`, `apps/mobile/lib/vesper/`, токены `packages/ui-tokens/src/vesper.ts` (`tokensForBrand`). Аватар один файл `apps/mobile/assets/vesper-avatar.png`, ссылка на него в одном месте (`components/vesper/avatar.tsx`).
- **Карточки инструментов.** Пять новых видов `MessageBlock` в `packages/contracts/src/events.ts`: `browser`, `mail`, `pdf`, `plan`, `finance`, у всех обязательный `summary`. Незнакомый блок деградирует в строку (`StoredMessageBlock`), а не роняет `threads.get`. Живой эмиттер пока один: `browser` на каждый `browser_navigate` со скриншотом как артефактом (2 MiB на кадр, дедуп по хэшу, `packages/adapters/src/browser-card.ts`); скриншоты видны в Files как `Screenshot — <host>`. Остальные четыре имеют форму и тесты, но данных под ними в Negroni нет.
- **Activity.** Новый RPC `effects.list` (чеки по `ExternalEffect` только своих ранов, поля по allowlist). Аппрувы через `threads.answer`. Паузы и повтора ранов нет, потому что нет RPC.
- **Чего пока нет (фаза 9 спеки):** терминал, просмотр PDF и формы, почта и календарь, финансы, инбокс уведомлений, боковые чаты, вехи у целей и источники у идей (нет колонок), события scratchpad и настроек уведомлений (есть таблица, нет RPC), optimistic-concurrency на памяти. Спека переноса и принятые решения: `~/dev/vesper-ui-port-spec.md` (вне репы). Переводы ru/zh/de для ~200 новых строк машинные, носитель не смотрел.

