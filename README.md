<div align="center">

# Aria — Audio Player

**🇷🇺 [Русский](#-русский) · 🇬🇧 [English](#-english)**

Локальный аудио-плеер на Go + Wails + Svelte · A local audio player built with Go + Wails + Svelte

`v0.3.2-beta`

</div>


---

# 🇷🇺 Русский

## О проекте

**Aria** — десктопный плеер для локальной музыки. Бэкенд написан на Go, интерфейс на Svelte, всё упаковано в Wails v2 (системный WebView вместо Electron, поэтому приложение лёгкое). Проект в стадии беты: основные функции работают, часть возможностей помечена как «в разработке».

## Возможности

**Библиотека**
- Добавление отдельных файлов или целой папки (с рекурсивным сканированием).
- Форматы: `mp3`, `wav`, `ogg`, `flac`, `m4a`, `aac`.
- Чтение тегов (название, исполнитель, альбом) и встроенных обложек.
- Поиск по названию, исполнителю и альбому, удаление треков из списка.
- Список и настройки сохраняются между запусками.

**Воспроизведение**
- Перемотка, громкость, повтор (выкл / весь список / один трек), перемешивание.
- Кнопка «назад» перематывает в начало, если трек играет дольше 3 секунд.
- Если плеер на паузе и вы переключаете трек, новый трек тоже остаётся на паузе.
- Опция «восстанавливать последний трек при запуске» (трек ждёт на паузе).
- Кроссфейд с настраиваемой длительностью (1–12 с): плавно только при автоматическом переходе к следующему треку, ручные переключения всегда мгновенные.
- Звук отдаётся через локальный HTTP-сервер с поддержкой Range-запросов, поэтому перемотка быстрая даже на больших файлах.

**Большая страница (Now Playing)**
- Плавно выезжает снизу, показывает крупную обложку и данные трека.
- Визуализатор спектра (Web Audio), перемотка, громкость, повтор и перемешивание.
- Вкладки сбоку: «Текст» (заготовка под поиск через внешний API), «Очередь», «Плейлист» и «Настройки» — скорость, тон и визуализатор.
- Закрывается только по ESC или кнопке ✕; уход страницы быстрый и плавный.
- Адаптивный фон: цвет подстраивается под обложку (без обложки фон тёмный), при закрытии цвет «замораживается».

**Оформление**
- Темы: тёмная и светлая. Дизайны: обычный, Glassmorphism, Glassmorphism+.
- Анимированные фоны: Particle, Babble, Matrix, Aurora — у каждого свои настройки (количество точек / пузырей / туманностей, скорость и плотность символов).
- Палитра: базовая или свой акцентный цвет. Неоновая обводка окна (включается переключателем).
- Анимированный логотип-эквалайзер в боковом меню и собственные SVG-иконки интерфейса.
- Плавные переходы: смена темы, страниц, обложек. Анимированная заставка при запуске.

**Окно**
- Без рамки: кнопки «— ×» слева сверху, окно тянется за верхнюю полосу, кнопки «развёрнуть» нет.
- Своя иконка приложения вместо стандартной.

## Скриншоты

**ГЛАВНАЯ**
<p align="center">
  <img src="./frontend/docs/main1.png" alt="ГЛАВНАЯ" width="380">
</p>

##

**СЕЙЧАС ИГРАЕТ**
<p align="center">
  <img src="./frontend/docs/now-playing1.png" alt="СЕЙЧАС ИГРАЕТ" width="380">
</p>

##

## Установка

### Готовая сборка
Скачайте `audioplayer.exe` из раздела [Releases](../../releases) и запустите. Установка не требуется. Для работы нужен Microsoft WebView2 (есть в Windows 10/11 из коробки или ставится вместе с Edge).

### Сборка из исходников
Понадобятся:
- [Go](https://go.dev/dl/) 1.25+
- [Node.js](https://nodejs.org/) 18+
- [Wails v2](https://wails.io/docs/gettingstarted/installation): `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

```bash
git clone https://github.com/C1rkul/Aria-AudioPlayer.git
cd Aria-AudioPlayer
cd frontend && npm install && cd ..

wails dev      # режим разработки с горячей перезагрузкой
wails build    # готовая сборка: build/bin/audioplayer.exe
```

Проверьте установку командой `wails doctor`.

## Где хранятся данные

Папка по умолчанию: `Documents/audioplayer` (можно посмотреть и открыть в Настройках → Данные).

| Файл | Содержимое |
|---|---|
| `settings.json` | настройки приложения |
| `tracks.json` | список треков |
| `covers/` | извлечённые из тегов обложки |

Сами музыкальные файлы приложение не копирует и не изменяет — хранятся только пути к ним.

## Структура проекта

```
app.go            бэкенд: настройки, треки, теги и обложки, локальный стрим-сервер
main.go           запуск Wails, окно без рамки (1100×720, без изменения размера)
frontend/src/
  App.svelte      каркас, нижняя панель, заставка, переходы
  components/     страницы и UI-компоненты (плеер, настройки, Now Playing, фон, логотип, иконки)
  lib/            контроллер воспроизведения, источники, заготовка для текстов, автоскрытие скролла
  stores/         состояние: треки, настройки, плейлисты
  design.css      темы и дизайны (переменные CSS)
build/            иконка приложения и ресурсы сборки
```

## Стек

Go · [Wails v2](https://wails.io) · Svelte 4 · Vite 5 · [dhowden/tag](https://github.com/dhowden/tag) (теги и обложки).

## Документация для разработчика

См. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — какие файлы за что отвечают.

## Планы

- Поиск текстов песен через внешний API — поле для ссылки и парсер уже подготовлены.
- Внешние источники музыки (вкладка «Внешние»).

## Авторы

**made by C1RKUL & Claude x Qwen**

Проект сделан с помощью ИИ — и мы этого не скрываем.

---

# 🇬🇧 English

## About

**Aria** is a desktop player for your local music. The backend is written in Go, the UI in Svelte, and everything is packaged with Wails v2 (it uses the system WebView instead of Electron, so the app stays lightweight). The project is in beta: the core features work, some are marked as "work in progress".

## Features

**Library**
- Add individual files or a whole folder (scanned recursively).
- Formats: `mp3`, `wav`, `ogg`, `flac`, `m4a`, `aac`.
- Reads tags (title, artist, album) and embedded cover art.
- Search by title, artist and album; remove tracks from the list.
- The track list and settings persist between launches.

**Playback**
- Seek, volume, repeat (off / all / one), shuffle.
- The "previous" button restarts the track if it has been playing for more than 3 seconds.
- If the player is paused and you switch tracks, the new track stays paused too.
- Optional "restore last track on startup" (the track waits, paused).
- Crossfade with adjustable duration (1–12 s): it only blends tracks on automatic advance — manual switches are always instant.
- Audio is served by a local HTTP server with Range-request support, so seeking is fast even in large files.

**Now Playing page**
- Smoothly slides up from the bottom and shows large cover art and track info.
- Spectrum visualizer (Web Audio), seek bar, volume, repeat and shuffle.
- Side tabs: "Lyrics" (an API stub), "Queue", "Playlist" and "Settings" — tempo, pitch and visualizer.
- Closes only with ESC or the ✕ button; the page slides away quickly and smoothly.
- Adaptive background: the color follows the cover art (dark when there is no cover) and freezes while the page slides away.

**Appearance**
- Themes: dark and light. Designs: normal, Glassmorphism, Glassmorphism+.
- Animated backgrounds: Particle, Babble, Matrix, Aurora — each with its own settings (number of dots / bubbles / nebulae, symbol speed and density).
- Palette: base or a custom accent color. Neon window outline (toggle).
- Animated equalizer logo in the sidebar and custom SVG interface icons.
- Smooth transitions for theme, pages and cover art. Animated splash screen on startup.

**Window**
- Frameless: "— ×" controls in the top-left corner, drag the window by the top strip, no maximize button.
- A custom app icon instead of the default one.

## Screenshots

**MAIN PAGE**
<p align="center">
  <img src="./frontend/docs/main1.png" alt="MAIN PAGE" width="380">
</p>

##

**NOW PLAYING PAGE**
<p align="center">
  <img src="./frontend/docs/now-playing1.png" alt="NOW PLAYING" width="380">
</p>

##

## Installation

### Prebuilt binary
Download `audioplayer.exe` from [Releases](../../releases) and run it. No installation is needed. Microsoft WebView2 is required (included with Windows 10/11 or installed together with Edge).

### Build from source
Requirements:
- [Go](https://go.dev/dl/) 1.25+
- [Node.js](https://nodejs.org/) 18+
- [Wails v2](https://wails.io/docs/gettingstarted/installation): `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

```bash
git clone https://github.com/C1rkul/Aria-AudioPlayer.git
cd Aria-AudioPlayer
cd frontend && npm install && cd ..

wails dev      # development mode with hot reload
wails build    # production build: build/bin/audioplayer.exe
```

Check your setup with `wails doctor`.

## Where data is stored

Default folder: `Documents/audioplayer` (you can see and open it in Settings → Data).

| File | Contents |
|---|---|
| `settings.json` | app settings |
| `tracks.json` | track list |
| `covers/` | cover art extracted from tags |

The app never copies or modifies your music files — only their paths are stored.

## Project structure

```
app.go            backend: settings, tracks, tags and covers, local stream server
main.go           Wails entry point, frameless window (1100×720, not resizable)
frontend/src/
  App.svelte      shell, bottom bar, splash screen, transitions
  components/     pages and UI components (player, settings, Now Playing, background, logo, icons)
  lib/            playback controller, sources, lyrics stub, scrollbar auto-hide
  stores/         state: tracks, settings, playlists
  design.css      themes and designs (CSS variables)
build/            app icon and build resources
```

## Tech stack

Go · [Wails v2](https://wails.io) · Svelte 4 · Vite 5 · [dhowden/tag](https://github.com/dhowden/tag) (tags and cover art).

## Developer docs

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — which file does what.

## Roadmap

- Lyrics via an external API — the URL field and the response parser are prepared.
- External music sources (the "External" tab).

## Credits

**made by C1RKUL & Claude x Qwen**

This project was built with the help of AI — and we don't hide it.
