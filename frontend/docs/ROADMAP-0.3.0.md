# Aria 0.3.0-beta — план / roadmap

Делаем строго по порядку, каждый шаг — отдельный рабочий архив. / Strictly in order; every step ends in a working build.

Решения / Decisions: трек может быть в нескольких плейлистах (хранятся id); очередь сохраняется между запусками. / A track can be in several playlists (ids are stored); the queue persists between launches.

- [x] **1. Модель данных / Data model** — `playlists.json` (`{id, name, trackIds[]}`), Go-методы Load/SavePlaylists, стор `playlists.js`; очередь как список id в сторе, сохранение. / store + Go persistence + persisted queue.
- [x] **2. Очередь в контроллере / Queue in controller** — `pickNext()` идёт по очереди; запуск из плейлиста делает его очередью; «играть следом». / playback follows the queue; playing from a playlist makes it the queue; "play next".
- [x] **3. Вкладки плеера / Player tabs** — «Все песни», плейлисты, «+» (создать), слайд-анимации, добавить трек в плейлист (контекстное меню/кнопка). / "All songs", playlists, "+", slide animations, add track to playlist.
- [x] **4. Страница «Плейлисты» / Playlists page** — сетка карточек: создать, открыть, переименовать, удалить, плавные анимации; пункт в боковом меню. / card grid + sidebar entry.
- [x] **5. Большая страница: Текст / Очередь / Плейлист / Big page: Lyrics / Queue / Playlist** — переключатель над областью текста, список с перестановкой. / tab switcher over the lyrics area, reorderable list.
- [ ] (отложено / postponed) **6. Горячие клавиши и медиа-клавиши / Hotkeys & media keys** — пробел, стрелки, M, N/P; `navigator.mediaSession`. / space, arrows, M, N/P; mediaSession.
- [x] **7. «Настройки» на большой странице / Big-page "Settings"** — скорость (рабочая, `playbackRate`), эквалайзер и тон (заготовки). / speed (working), equalizer & pitch (placeholders).
- [x] **7.1 Скорость/тон и визуализатор / Tempo & visualizer** — скорость и тон в одной карточке с кнопкой «связать», пресеты 0.5×–2×, рабочий сдвиг тона (AudioWorklet); визуализатор: число колонок + пресеты Обычный / Круглый (с вращением) / Большой (фон). / tempo+pitch card with link button and presets, real pitch shifter; visualizer bar count + Base / Circle (spin) / Big (background) presets.
- [x] **8. «Обновления» / "What's new"** — окно с описанием изменений при первом запуске новой версии (один раз) + кнопка «Обновления» в углу/боковом меню; данные — локальный файл changelog; позже — обновления по сети. / one-time dialog on first launch of a new version + an "Updates" button; data from a local changelog file; network updates later.
- [ ] **9. Версия и релиз / Version & release** (в `changelog.json` проставить дату 0.3.0-beta; обновить README/RELEASE) — — `tools/setversion` → 0.3.0-beta, README, RELEASE (RU+EN), DEVELOPMENT.md.
- [ ] **Позже / Later** — ссылки `ariapl://` и `aria://`, рабочие эквалайзер и тон. / share links, real EQ and pitch.
