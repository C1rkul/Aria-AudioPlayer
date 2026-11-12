<script>
  import { tt, tr } from '../lib/i18n.js';
  import { onMount } from 'svelte';
  import { APP_NAME, APP_VERSION } from '../lib/version.js';
  import { settings } from '../stores/settings.js';
  import { effectiveStyle } from '../lib/holiday.js';

  // Бейдж издания — по активному стилю («Стиль» в настройках):
  // Хеллоуин → Halloween Edition, Новый Год → New Year Edition, обычная → без бейджа
  const STYLE_BADGES = { halloween: 'Halloween Edition', ny: 'New Year Edition' };
  const VERSION_LABEL = String(APP_VERSION).replace(/_[A-Za-z0-9-]+$/, '');
  $: edition = STYLE_BADGES[effectiveStyle($settings)] || '';
  import AriaMark from './AriaMark.svelte';
  import GithubIcon from './GithubIcon.svelte';
  import TelegramIcon from './TelegramIcon.svelte';
  import NoteIcon from './NoteIcon.svelte';
  import BoltIcon from './BoltIcon.svelte';
  import SlidersIcon from './SlidersIcon.svelte';
  import RepeatIcon from './RepeatIcon.svelte';
  import { tracks } from '../stores/player.js';
  import { GetSystemInfo } from '../../wailsjs/go/main/App';
  import { BrowserOpenURL } from '../../wailsjs/runtime/runtime';

  const GITHUB = 'https://github.com/C1rkul/Aria-AudioPlayer';
  const TELEGRAM = 'https://t.me/aria_audio_player'; // кнопка в Hero (канал приложения)
  const AUTHOR = 'https://t.me/shpionski'; // ссылка автора в подвале страницы

  const STACK = [
    { mono: 'Go', color: '#00ADD8', name: 'Go', sub: 'Backend & Audio', hint: tr('Бэкенд: стрим-сервер, теги, обложки и файловая система') },
    { mono: 'W', color: 'var(--accent)', name: 'Wails v2', sub: 'Desktop Bridge', hint: tr('Системный WebView вместо тяжёлого Electron') },
    { mono: 'S', color: '#FF3E00', name: 'Svelte', sub: 'UI Framework', hint: tr('Реактивный интерфейс без лишних килобайт рантайма') },
    { mono: 'V', color: '#646CFF', name: 'Vite', sub: 'Bundler', hint: tr('Быстрая сборка и горячая перезагрузка при разработке') },
  ];

  const FEATURES = [
    { icon: NoteIcon, props: {}, title: tr('Форматы'), text: tr('FLAC, WAV, MP3, OGG, M4A и AAC — с чтением тегов и встроенных обложек') },
    { icon: BoltIcon, props: {}, title: tr('Лёгкий и быстрый'), text: tr('Go + системный WebView: минимальное потребление памяти, без Electron') },
    { icon: SlidersIcon, props: {}, title: tr('Скорость и тон'), text: tr('Пресеты 0.5×–2× — вместе или независимо, как у пластинки') },
    { icon: RepeatIcon, props: { mode: 'all' }, title: tr('Кроссфейд и очередь'), text: tr('Плавный переход на автопереходе, «играть следом», плейлисты') },
  ];

  let sys = { platform: '', arch: '', audioDevice: '…' };

  onMount(async () => {
    try {
      sys = await GetSystemInfo();
    } catch {
      // вне Wails (например, открыто в обычном браузере)
      sys = { platform: navigator.platform || '—', arch: '', audioDevice: '—' };
    }
  });

  function open(url) {
    try {
      BrowserOpenURL(url);
    } catch {
      window.open(url, '_blank');
    }
  }

  function platformLabel() {
    if (!sys.platform) return '…';
    const osMap = { windows: 'Windows', linux: 'Linux', darwin: 'macOS' };
    const archMap = { amd64: 'x64', arm64: 'ARM64', '386': 'x86' };
    const os = osMap[sys.platform] || sys.platform;
    const arch = archMap[sys.arch];
    return arch ? `${os} ${arch}` : os;
  }
</script>

<section class="page">
  <div class="body">
    <h2>{tt('О приложении')}</h2>

    <!-- 🔹 1. Hero -->
    <header class="hero">
      <div class="hero-logo"><AriaMark size={92} glow={false} /></div>
      <div class="hero-text">
        <div class="title-row">
          <span class="app-name">{APP_NAME}</span>
          <span class="ver"><span class="dot" aria-hidden="true"></span>v{VERSION_LABEL}</span>
          {#if edition}
            <span class="ver"><span class="dot" aria-hidden="true"></span>{edition}</span>
          {/if}
        </div>
        <p class="tagline">{tt('Локальный аудио-плеер · Go + Wails + Svelte')}</p>
        <div class="actions">
          <button class="act primary" on:click={() => open(GITHUB)}><GithubIcon />GitHub</button>
          <button class="act" on:click={() => open(TELEGRAM)}><TelegramIcon />Telegram</button>
        </div>
      </div>
    </header>

    <!-- 🔹 2. Технологии -->
    <section class="card">
      <h3>{tt('Технологии')}</h3>
      <div class="stack">
        {#each STACK as s}
          <div class="chip" data-hint={s.hint} title={s.hint}>
            <span class="mono" style="background:{s.color}">{s.mono}</span>
            <span class="chip-text">
              <b>{s.name}</b>
              <small>{s.sub}</small>
            </span>
          </div>
        {/each}
      </div>
    </section>

    <!-- 🔹 3. Возможности и аудио-движок -->
    <section class="card">
      <h3>{tt('Возможности и аудио-движок')}</h3>
      <div class="features">
        {#each FEATURES as f}
          <div class="feat">
            <span class="fi" aria-hidden="true"><svelte:component this={f.icon} {...f.props} /></span>
            <div>
              <b>{f.title}</b>
              <p>{f.text}</p>
            </div>
          </div>
        {/each}
      </div>
    </section>

    <!-- 🔹 4. О системе -->
    <section class="card">
      <h3>{tt('О системе')}</h3>
      <div class="sys">
        <div class="row">
          <span class="k">{tt('Аудио-устройство')}</span>
          <span class="v">{sys.audioDevice}</span>
        </div>
        <div class="row">
          <span class="k">{tt('Треков в медиатеке')}</span>
          <span class="v">{$tracks.length.toLocaleString('ru-RU')}</span>
        </div>
        <div class="row">
          <span class="k">{tt('Платформа')}</span>
          <span class="v">{platformLabel()}</span>
        </div>
      </div>
    </section>
  </div>

  <footer class="credit">
    made by
    <a href={AUTHOR} on:click|preventDefault={() => open(AUTHOR)}>Shpionski(aka C1RKUL)</a>
    &amp; Claude x Qwen
  </footer>
</section>

<style>
  .page { min-height: 100%; height: 100%; display: flex; flex-direction: column; }
  .body { max-width: 760px; width: 100%; display: flex; flex-direction: column; gap: 16px; }

  h2 { margin: 0; color: var(--text); font-size: 28px; }
  h3 { margin: 0 0 13px; font-size: 15px; color: var(--text); letter-spacing: 0.3px; }

  /* 🔹 Hero */
  .hero {
    display: flex;
    align-items: center;
    gap: 22px;
    padding: 22px 24px;
    border: 1px solid var(--border);
    border-radius: 18px;
    background: var(--panel-bg, rgba(127, 127, 127, 0.06));
  }
  .hero-logo {
    flex-shrink: 0;
    filter: drop-shadow(0 0 22px rgba(var(--accent-rgb, 124, 92, 255), 0.5));
  }
  .hero-text { min-width: 0; }
  .title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .app-name { font-size: 34px; font-weight: 800; letter-spacing: 1px; color: var(--text); line-height: 1.1; }

  .ver {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid rgba(var(--accent-rgb, 124, 92, 255), 0.45);
    background: rgba(var(--accent-rgb, 124, 92, 255), 0.12);
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(var(--accent-rgb, 124, 92, 255), 0.55); }
    50% { opacity: 0.6; box-shadow: 0 0 0 5px rgba(var(--accent-rgb, 124, 92, 255), 0); }
  }

  .tagline { margin: 7px 0 0; color: var(--muted); font-size: 13.5px; }

  .actions { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
  .act {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border-radius: 11px;
    border: 1px solid var(--border);
    background: var(--item-bg, rgba(127, 127, 127, 0.08));
    color: var(--text);
    font-size: 14px;
    cursor: pointer;
    transition: 0.15s ease;
  }
  .act:hover { border-color: rgba(var(--accent-rgb, 124, 92, 255), 0.5); transform: translateY(-1px); }
  .act.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .act.primary:hover { filter: brightness(1.1); }

  /* 🔹 Карточки */
  .card {
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--panel-bg, rgba(127, 127, 127, 0.06));
    padding: 18px 20px;
  }

  /* 🔹 Стек технологий */
  .stack { display: grid; grid-template-columns: repeat(auto-fit, minmax(158px, 1fr)); gap: 10px; }
  .chip {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 13px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: var(--item-bg, rgba(127, 127, 127, 0.08));
    cursor: default;
    transition: 0.15s ease;
  }
  .chip:hover { border-color: rgba(var(--accent-rgb, 124, 92, 255), 0.5); transform: translateY(-2px); }
  .mono {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 13px;
    color: #fff;
    flex-shrink: 0;
  }
  .chip-text { display: flex; flex-direction: column; min-width: 0; }
  .chip-text b { font-size: 13.5px; color: var(--text); }
  .chip-text small {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip::after {
    content: attr(data-hint);
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 8px);
    background: #14141a;
    border: 1px solid rgba(var(--accent-rgb, 124, 92, 255), 0.35);
    color: #e8e8ee;
    font-size: 12px;
    line-height: 1.45;
    padding: 8px 10px;
    border-radius: 9px;
    opacity: 0;
    pointer-events: none;
    transform: translateY(4px);
    transition: 0.15s ease;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4);
    z-index: 30;
  }
  .chip:hover::after { opacity: 1; transform: none; }

  /* 🔹 Возможности */
  .features { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 860px) {
    .features { grid-template-columns: 1fr; }
    .hero { flex-direction: column; text-align: center; }
    .title-row { justify-content: center; }
    .actions { justify-content: center; }
  }
  .feat {
    display: flex;
    gap: 11px;
    padding: 13px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: var(--item-bg, rgba(127, 127, 127, 0.08));
  }
  .fi {
    width: 38px;
    height: 38px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: rgba(var(--accent-rgb, 124, 92, 255), 0.12);
    color: var(--accent);
    font-size: 19px;
  }
  .feat b { display: block; color: var(--text); font-size: 14px; margin-bottom: 3px; }
  .feat p { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }

  /* 🔹 О системе */
  .sys { display: flex; flex-direction: column; gap: 8px; }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    padding: 11px 14px;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: var(--item-bg, rgba(127, 127, 127, 0.08));
    font-size: 13.5px;
  }
  .k { color: var(--muted); }
  .v { color: var(--text); font-weight: 600; text-align: right; }

  /* подпись всегда внизу по центру */
  .credit { margin-top: auto; padding: 24px 0 4px; text-align: center; color: var(--muted); font-size: 13px; letter-spacing: 1.2px; }
  .credit a {
    color: var(--text);
    text-decoration: none;
    border-bottom: 1px dashed rgba(var(--accent-rgb, 124, 92, 255), 0.6);
    cursor: pointer;
    transition: color 0.15s ease;
  }
  .credit a:hover { color: var(--accent); }
</style>
