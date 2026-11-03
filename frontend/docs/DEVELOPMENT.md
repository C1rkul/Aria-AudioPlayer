# Aria — Developer guide / Руководство разработчика

## 🇷🇺 Русский

### Как всё устроено
Go (Wails) — бэкенд: файлы, метаданные, настройки, локальный стрим-сервер. Svelte — интерфейс. Они общаются через `frontend/wailsjs/go/main/App.js` (вызовы Go-методов).

### Где что менять

| Что случилось / что нужно | Файл |
|---|---|
| Не играет звук, ошибки воспроизведения, следующий/предыдущий, повтор, shuffle, громкость (логика) | `frontend/src/lib/player-controller.js` |
| Список треков, добавление без дублей, перестановка, сохранение списка | `frontend/src/stores/player.js` |
| Настройки (значения по умолчанию, сохранение) | `frontend/src/stores/settings.js` + структура `Settings` и `defaultSettings`/`normalizeSettings` в `app.go` |
| Новая настройка | добавить поле в оба места: `Settings` (app.go) и `defaultSettings` (settings.js), затем UI в `SettingsPage.svelte` |
| Нижняя панель, сайдбар, заставка, перетаскивание файлов, оверлей drop, тосты, смена страниц | `frontend/src/App.svelte` |
| Версия приложения | `frontend/src/lib/version.js` (+ `wails.json` → `info.productVersion`, README, RELEASE) |
| Страница плеера: список, поиск, вкладки, перестановка мышью | `frontend/src/components/PlayerPage.svelte` |
| Большой экран: обложка, текст, визуализатор, адаптивный фон, анимация закрытия | `frontend/src/components/NowPlayingPage.svelte` |
| Настройки (вкладки «Основные» / «Большой экран») | `frontend/src/components/SettingsPage.svelte` |
| Фоновые эффекты (Particle, Babble, Matrix, Aurora) | `frontend/src/components/BackgroundFX.svelte` |
| Заставка с логотипом | `frontend/src/components/Splash.svelte`, `AriaMark.svelte` |
| Цвета, темы, дизайны (normal / glass / glass+) | `frontend/src/design.css` |
| Окно «Что нового», кнопка «Обновления», список изменений | `frontend/src/components/UpdatesModal.svelte`, `frontend/src/data/changelog.json`, `frontend/src/lib/updates.js` (см. `docs/UPDATES.md`) |
| Страница «О приложении» | `frontend/src/components/AboutPage.svelte` |
| Текст песен (заготовка под API) | `frontend/src/lib/lyrics.js` |
| Чтение файлов, теги, обложки, диалоги, добавление папок и перетащенных путей (`AddPaths`) | `app.go` |
| Стрим аудио/обложек, CORS, Range | `app.go` (`handleStream`, `handleCover`, `corsMiddleware`) |
| Окно: размер, перетаскивание файлов (`DragAndDrop`) | `main.go` |
| Имя, версия, метаданные .exe | `wails.json` |

### Срочные фиксы — быстрый чек-лист
1. Не играет музыка → `player-controller.js` (`playTrack`), потом `handleStream` в `app.go`.
2. Нет обложек → `handleCover`/`validateCoverPath` в `app.go`, `CoverImage.svelte`.
3. Настройка не сохраняется → поле есть в `Settings` (Go) и в `defaultSettings` (JS)? Проверь `normalizeSettings`.
4. Тормозит большой экран → `NowPlayingPage.svelte` (визуализатор, `closing`), `BackgroundFX.svelte`.
5. Drag-n-drop не работает → `main.go` (`DragAndDrop`), `App.svelte` (`OnFileDrop`), `AddPaths` в `app.go`.
6. Сломалась сборка Go → после правок `app.go` запусти `gofmt -l .` и `go vet ./...`.

### Команды
```
cd frontend && npm install     # один раз
wails dev                      # разработка
wails build                    # готовая сборка (build/bin)
```
Смена версии (version.js + wails.json за раз): `go run ./tools/setversion` — ↑↓ выбор поля, Д/Y применить. Работает без внешних зависимостей. README/RELEASE правятся вручную.

Не коммить `node_modules` и `frontend/dist`.

---

## 🇬🇧 English

### Overview
Go (Wails) is the backend: files, metadata, settings, local stream server. Svelte is the UI. They talk through `frontend/wailsjs/go/main/App.js` (Go method calls).

### What to change where

| Problem / task | File |
|---|---|
| No sound, playback errors, next/prev, repeat, shuffle, volume (logic) | `frontend/src/lib/player-controller.js` |
| Track list, de-duplicated adding, reordering, persistence | `frontend/src/stores/player.js` |
| Settings (defaults, saving) | `frontend/src/stores/settings.js` + `Settings` struct and `defaultSettings`/`normalizeSettings` in `app.go` |
| New setting | add the field in both places: `Settings` (app.go) and `defaultSettings` (settings.js), then UI in `SettingsPage.svelte` |
| Footer player, sidebar, splash, file drop, drop overlay, toasts, page switching | `frontend/src/App.svelte` |
| App version | `frontend/src/lib/version.js` (+ `wails.json` → `info.productVersion`, README, RELEASE) |
| Player page: list, search, tabs, mouse reordering | `frontend/src/components/PlayerPage.svelte` |
| Big screen: cover, lyrics, visualizer, adaptive background, closing animation | `frontend/src/components/NowPlayingPage.svelte` |
| Settings ("General" / "Big screen" tabs) | `frontend/src/components/SettingsPage.svelte` |
| Background effects (Particle, Babble, Matrix, Aurora) | `frontend/src/components/BackgroundFX.svelte` |
| Logo splash | `frontend/src/components/Splash.svelte`, `AriaMark.svelte` |
| Colors, themes, designs (normal / glass / glass+) | `frontend/src/design.css` |
| "What's new" dialog, "Updates" button, changelog | `frontend/src/components/UpdatesModal.svelte`, `frontend/src/data/changelog.json`, `frontend/src/lib/updates.js` (see `docs/UPDATES.md`) |
| About page | `frontend/src/components/AboutPage.svelte` |
| Lyrics (API placeholder) | `frontend/src/lib/lyrics.js` |
| File reading, tags, covers, dialogs, adding folders and dropped paths (`AddPaths`) | `app.go` |
| Audio/cover streaming, CORS, Range | `app.go` (`handleStream`, `handleCover`, `corsMiddleware`) |
| Window: size, file drop (`DragAndDrop`) | `main.go` |
| Name, version, .exe metadata | `wails.json` |

### Urgent-fix checklist
1. No music → `player-controller.js` (`playTrack`), then `handleStream` in `app.go`.
2. No covers → `handleCover`/`validateCoverPath` in `app.go`, `CoverImage.svelte`.
3. Setting not saved → is the field in both `Settings` (Go) and `defaultSettings` (JS)? Check `normalizeSettings`.
4. Big screen lags → `NowPlayingPage.svelte` (visualizer, `closing`), `BackgroundFX.svelte`.
5. Drag-n-drop broken → `main.go` (`DragAndDrop`), `App.svelte` (`OnFileDrop`), `AddPaths` in `app.go`.
6. Go build broken → after editing `app.go` run `gofmt -l .` and `go vet ./...`.

### Commands
```
cd frontend && npm install     # once
wails dev                      # development
wails build                    # release build (build/bin)
```
Version change (version.js + wails.json at once): `go run ./tools/setversion` — ↑↓ to pick a field, Y/Д to apply. No external dependencies. README/RELEASE are edited by hand.

Don't commit `node_modules` or `frontend/dist`.
