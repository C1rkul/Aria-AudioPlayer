<script>
  import { onMount } from 'svelte';
  
  // Компоненты страниц
  import PlayerPage from './components/PlayerPage.svelte';
  import SettingsPage from './components/SettingsPage.svelte';
  import AboutPage from './components/AboutPage.svelte';
  import PlaylistsPage from './components/PlaylistsPage.svelte';
  import UpdatesModal from './components/UpdatesModal.svelte';
  import BackgroundFX from './components/BackgroundFX.svelte';
  import NowPlayingPage from './components/NowPlayingPage.svelte';
  import Marquee from './components/Marquee.svelte';
  import PlayPauseIcon from './components/PlayPauseIcon.svelte';
  import VolumeIcon from './components/VolumeIcon.svelte';
  import { autohideScroll } from './lib/autohide-scroll.js';
  import { fade } from 'svelte/transition';
  import { loadPlaylists } from './stores/playlists.js';
  import { APP_VERSION } from './lib/version.js';
  import { toast, showToast } from './stores/toast.js';
  import { addTracksDedup } from './stores/player.js';
  import { OnFileDrop, OnFileDropOff } from '../wailsjs/runtime/runtime';
  import { AddPaths } from '../wailsjs/go/main/App';
  import Splash from './components/Splash.svelte';
  import AriaMark from './components/AriaMark.svelte';
  import CoverImage from './components/CoverImage.svelte';
  import RepeatIcon from './components/RepeatIcon.svelte';
  import ShuffleIcon from './components/ShuffleIcon.svelte';

  // Stores
  import { tracks, currentIndex, currentTrack, isPlaying, repeatMode, shuffleEnabled } from './stores/player.js';
  import { settings, defaultSettings, updateSettings } from './stores/settings.js';

  // Controller & Sources
  import { playerController } from './lib/player-controller.js';

  // Wails Bindings
  import { LoadTracks, LoadSettings, GetStreamBaseURL } from '../wailsjs/go/main/App';

  // State
  let page = 'player';
  let showNowPlaying = false;
  let streamBase = '';
  
  // Refs
  let audioElement;
  let progressInputEl;
  let volumeInputEl;

  // Local state for sliders (synced with controller)
  let currentTime = 0;
  let duration = 0;
  const volumeStore = playerController.volume;
  $: volume = $volumeStore;
  let isLoading = false;
  let appearanceReady = false;
  let showSplash = true;      // заставка при запуске: блокирует интерфейс
  let showUpdates = false;
  let settingsLoaded = false;
  let updatesChecked = false;
  $: hasNewVersion = ($settings.lastSeenVersion || '') !== APP_VERSION;
  // один раз после заставки: показать «Что нового», если эту версию ещё не просматривали
  $: if (!showSplash && settingsLoaded && !updatesChecked) {
    updatesChecked = true;
    if (hasNewVersion) showUpdates = true;
  }
  function closeUpdates() {
    showUpdates = false;
    if (hasNewVersion) updateSettings({ lastSeenVersion: APP_VERSION });
  }
  let bgActive = true;        // фон главного окна на паузе, пока большая страница полностью закрывает его
  let bgTimer;
  let prevLook = null;

  // Helper function for time formatting
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  onMount(async () => {
    try {
      // 1. Init Settings
      const loadedSettings = await LoadSettings();
      const merged = { ...defaultSettings, ...(loadedSettings || {}) };
      settings.set(merged);
      settingsLoaded = true;
      playerController.setVolume(merged.defaultVolume ?? 0.5, false);
      
      applyAppearance(merged);
      appearanceReady = true;
      updateVolumeStyle();

      // 2. Init Stream Server
      streamBase = await GetStreamBaseURL();
      playerController.init(audioElement, streamBase);
      playerController.applyCurrentVolume();

      // 3. Init Tracks
      const savedTracks = await LoadTracks();
      tracks.set(Array.isArray(savedTracks) ? savedTracks : []);
      await loadPlaylists();

      // Subscribe to controller states to sync UI
      playerController.currentTime.subscribe(v => currentTime = v);
      playerController.duration.subscribe(v => duration = v);
      playerController.isLoading.subscribe(v => isLoading = v);

      // 5. Restore Last Track Logic
      if (merged.restoreLastTrack && merged.lastTrackId) {
        const list = Array.isArray(savedTracks) ? savedTracks : [];
        const idx = list.findIndex(t => t.id === merged.lastTrackId);
        if (idx >= 0) {
          playerController.startPaused = true; // при запуске приложения не стартуем музыку сами
          currentIndex.set(idx);
          playerController.setPendingPos(merged.lastPosition || 0);
        }
      }

    } catch (err) {
      console.error(err);
    }
  });

  // Тема / дизайн / палитра применяются при ЛЮБОМ изменении настроек
  $: if (appearanceReady) applyAppearanceSmooth($settings);

  $: {
    clearTimeout(bgTimer);
    if (showSplash) bgActive = false;                       // на заставке фон не анимируем — меньше нагрузки на старте
    else if (showNowPlaying) bgTimer = setTimeout(() => (bgActive = false), 700);
    else bgTimer = setTimeout(() => (bgActive = true), 560); // фон возобновляем только после того, как страница уехала
  }

  // Смена темы/дизайна/режима палитры — плавный кроссфейд всего экрана (View Transitions),
  // смена только акцентного цвета применяется сразу
  function applyAppearanceSmooth(s) {
    const key = [s.theme, s.design, s.palette === 'custom' ? 'custom' : 'base'].join('|');
    const changed = prevLook !== null && key !== prevLook;
    prevLook = key;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (changed && !reduce && typeof document.startViewTransition === 'function') {
      document.startViewTransition(() => applyAppearance(s));
    } else {
      applyAppearance(s);
    }
  }

  // Update Slider Styles reactively
  $: if (progressInputEl) {
    const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
    progressInputEl.style.setProperty('--fill-percent', `${Math.max(0, Math.min(100, pct))}%`);
  }

  $: if (volumeInputEl) {
    volumeInputEl.style.setProperty('--fill-percent', `${volume * 100}%`);
  }

  // Auto-load track when selection changes
  let lastTrackId = null;
  $: if ($currentTrack) {
    if ($currentTrack.id !== lastTrackId) {
      lastTrackId = $currentTrack.id;
      playerController.playTrack($currentTrack);
    }
  } else {
    lastTrackId = null;
  }

  function changeVolume(e) {
    playerController.setVolume(Number(e.target.value) / 100);
  }

  function seekTo(e) {
    const val = Number(e.target.value);
    playerController.seek(val);
  }

  function applyAppearance(s) {
    if (typeof document === 'undefined') return;
    const theme = s.theme === 'light' ? 'light' : 'dark';
    const design = ['glass', 'glass_plus'].includes(s.design) ? s.design : 'normal';
    const palette = s.palette === 'custom' ? 'custom' : 'base';
    const accent = palette === 'custom' ? (s.customAccent || '#7c5cff') : '#7c5cff';

    document.body.dataset.theme = theme;
    document.body.dataset.design = design;
    document.body.dataset.palette = palette;
    document.body.style.setProperty('--accent', accent);
    document.body.style.setProperty('--accent-rgb', hexToRgb(accent));
  }

  function hexToRgb(hex) {
    const clean = String(hex).replace('#', '').trim();
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const num = parseInt(full, 16);
    if (isNaN(num)) return '124, 92, 255';
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
  }

  function updateVolumeStyle() {
     if (volumeInputEl) {
        volumeInputEl.style.setProperty('--fill-percent', `${volume * 100}%`);
     }
  }
  
  // --- Перетаскивание файлов и папок из проводника в окно ---
  let dropActive = false;
  let dragDepth = 0;
  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  const onDragEnter = (e) => { if (hasFiles(e)) { dragDepth++; dropActive = true; } };
  const onDragLeave = (e) => { if (hasFiles(e)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropActive = false; } };
  const onDragOver = (e) => { if (hasFiles(e)) e.preventDefault(); };
  const onDropEnd = () => { dragDepth = 0; dropActive = false; };

  async function handleDroppedPaths(paths) {
    if (!Array.isArray(paths) || paths.length === 0) return;
    try {
      const found = await AddPaths(paths);
      const added = addTracksDedup(found || []);
      if (added > 0) showToast(`Добавлено треков: ${added}`);
      else if ((found || []).length > 0) showToast('Эти треки уже есть в списке');
      else showToast('Поддерживаемых аудиофайлов не найдено');
    } catch (err) {
      console.error('Ошибка при добавлении перетащенных файлов:', err);
      showToast('Не удалось добавить файлы');
    }
  }

  onMount(() => {
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDropEnd);
    window.addEventListener('dragend', onDropEnd);
    try { OnFileDrop((x, y, paths) => { onDropEnd(); handleDroppedPaths(paths); }, false); } catch (e) { console.warn('OnFileDrop недоступен:', e); }
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDropEnd);
      window.removeEventListener('dragend', onDropEnd);
      try { OnFileDropOff(); } catch (e) {}
    };
  });

  // Event listener to close Now Playing modal
  onMount(() => {
    const handler = () => showNowPlaying = false;
    window.addEventListener('close-now-playing', handler);
    return () => window.removeEventListener('close-now-playing', handler);
  });

</script>

<BackgroundFX active={bgActive} />
{#if $settings.neonFrame}
  <div class="neon-frame" aria-hidden="true"></div>
{/if}

<div class="layout" inert={showSplash}>
  <aside class="sidebar">
    <div class="logo-block">
      <div class="logo"><AriaMark size={30} glow={false} /><span class="logo-rest">ria</span></div>
      <div class="app-version">v{APP_VERSION}</div>
    </div>
    <nav class="nav">
      <button class:active={page === 'player'} on:click={() => (page = 'player')}>Плеер</button>
      <button class:active={page === 'playlists'} on:click={() => (page = 'playlists')}>Плейлисты</button>
      <button class:active={page === 'settings'} on:click={() => (page = 'settings')}>Настройки</button>
      <button class:active={page === 'about'} on:click={() => (page = 'about')}>О приложении</button>
    </nav>
    <div class="sidebar-foot">
      <button class="updates-btn" on:click={() => (showUpdates = true)} title="Что нового">
        Обновления{#if hasNewVersion}<span class="dot"></span>{/if}
      </button>
    </div>
  </aside>

  <main class="content" use:autohideScroll>
    {#key page}
      <div class="page-wrap" in:fade={{ duration: 340, delay: 140 }} out:fade={{ duration: 160 }}>
    {#if page === 'player'}
      <PlayerPage streamBase={streamBase} />
    {:else if page === 'playlists'}
      <PlaylistsPage streamBase={streamBase} on:open={() => (page = 'player')} />
    {:else if page === 'settings'}
      <SettingsPage />
    {:else if page === 'about'}
      <AboutPage />
    {/if}
  </div>
    {/key}
  </main>

  <footer class="player-bar">
    <!-- Left Info -->
    <!-- Added role and tabindex to satisfy A11y checker -->
    <div 
      class="track-info" 
      on:dblclick={() => showNowPlaying = true} 
      style="cursor:pointer;"
      role="button"
      tabindex="0"
      aria-label="Открыть режим Now Playing"
    >
      <div class="cover">
        <CoverImage
          src={$currentTrack?.coverPath && streamBase ? `${streamBase}/cover?path=${encodeURIComponent($currentTrack.coverPath)}` : ''}
          placeholder={$currentTrack ? '🎵' : '🎶'}
        />
      </div>
      <div class="info-text">
        <div class="title"><Marquee text={$currentTrack ? $currentTrack.title : 'Ничего не играет'} /></div>
        <div class="subtitle"><Marquee text={$currentTrack ? ($currentTrack.artist || 'Локальный файл') : ''} /></div>
      </div>
    </div>

    <!-- Center Controls -->
    <div class="player-controls">
      <div class="controls">
        <button class="mode-btn" class:active={$repeatMode !== 'off'} on:click={() => repeatMode.update(v => v==='off'?'all':v==='all'?'one':'off')} title={$repeatMode === 'one' ? 'Повтор: один трек' : $repeatMode === 'all' ? 'Повтор: весь список' : 'Повтор выключен'}>
          <RepeatIcon mode={$repeatMode} />
        </button>
        <button class="nav-btn" on:click={() => playerController.prev()} title="Предыдущий">⏮</button>
        <button class="play-btn" on:click={() => playerController.togglePlay()} title={$isPlaying ? 'Пауза' : 'Играть'}>
          <PlayPauseIcon playing={$isPlaying} />
        </button>
        <button class="nav-btn" on:click={() => playerController.next()} title="Следующий">⏭</button>
        <button class="mode-btn" class:active={$shuffleEnabled} on:click={() => shuffleEnabled.update(v=>!v)} title={$shuffleEnabled ? 'Перемешивание включено' : 'Перемешивание выключено'}>
          <ShuffleIcon />
        </button>
      </div>
      
      <div class="progress-bar">
        <span class="time">{formatTime(currentTime)}</span>
        <input bind:this={progressInputEl} type="range" min="0" max="100" step="0.1" value={duration > 0 ? (currentTime/duration)*100 : 0} on:input={seekTo} />
        <span class="time">{formatTime(duration)}</span>
      </div>
    </div>

    <!-- Right Volume -->
    <div class="volume">
      <span class="vol-icon"><VolumeIcon {volume} /></span>
      <input bind:this={volumeInputEl} type="range" min="0" max="100" value={volume*100} on:input={changeVolume} />
    </div>
  </footer>
</div>

{#if dropActive}
  <div class="drop-overlay" transition:fade={{ duration: 160 }}>
    <div class="drop-box">
      <div class="drop-icon">⬇</div>
      <div class="drop-title">Отпустите, чтобы добавить</div>
      <div class="drop-sub">Аудиофайлы или папки с музыкой</div>
    </div>
  </div>
{/if}

{#if $toast}
  <div class="toast" transition:fade={{ duration: 200 }}>{$toast}</div>
{/if}

{#if showUpdates}
  <UpdatesModal on:close={closeUpdates} />
{/if}

{#if showSplash}
  <Splash on:done={() => (showSplash = false)} />
{/if}

<!-- Hidden Audio -->
<audio bind:this={audioElement}></audio>

<!-- Fullscreen Modal -->
{#if showNowPlaying}
  <NowPlayingPage streamBaseUrl={streamBase} />
{/if}

<style>
  /* ... Все те же глобальные стили тем и ползунков, что были раньше ... */
  :global(:root) { --bg:#0f0f12; --surface:#15151a; --text:#f2f2f5; --muted:#9aa0aa; --border:rgba(255,255,255,0.08); --accent:#7c5cff; --accent-rgb:124,92,255; --panel-bg:var(--surface); --item-bg:rgba(255,255,255,0.04); --item-border:rgba(255,255,255,0.07); --blur:0px; }
  :global(body) { margin:0; background:var(--bg); color:var(--text); font-family:sans-serif; overflow:hidden; }
  :global(input[type='range']) { -webkit-appearance:none; width:100%; height:6px; border-radius:3px; background:linear-gradient(to right, var(--accent) var(--fill-percent,0%), var(--item-border) var(--fill-percent,0%)); cursor:pointer; outline:none;}
  :global(input[type='range']::-webkit-slider-thumb) { -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:#fff; box-shadow:0 0 0 2px var(--accent);}
  
  .neon-frame { position:fixed; inset:0; z-index:50; pointer-events:none; border-radius:0;
    box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb),0.55), inset 0 0 14px rgba(var(--accent-rgb),0.40), inset 0 0 42px rgba(var(--accent-rgb),0.16);
    transition: box-shadow 0.4s ease; }
  :global(.autohide-scroll) { scrollbar-width: none; }
  :global(.autohide-scroll::-webkit-scrollbar) { width: 6px; height: 6px; }
  :global(.autohide-scroll::-webkit-scrollbar-track) { background: transparent; }
  :global(.autohide-scroll::-webkit-scrollbar-thumb) { background: transparent; border-radius: 3px; transition: background-color 0.6s ease; }
  :global(.autohide-scroll.scroll-active::-webkit-scrollbar-thumb) { background: rgba(var(--accent-rgb),0.28); transition-duration: 0.15s; }
  .drop-overlay { position:fixed; inset:0; z-index:2000; display:flex; align-items:center; justify-content:center; pointer-events:none;
    background: color-mix(in srgb, var(--bg) 55%, transparent); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
  .drop-box { padding:38px 56px; text-align:center; border-radius:26px; color:var(--text);
    border:2px dashed rgba(var(--accent-rgb),0.7); background: rgba(var(--accent-rgb),0.10);
    box-shadow: 0 0 40px rgba(var(--accent-rgb),0.25); }
  .drop-icon { font-size:40px; color:var(--accent); animation: dropBob 1.1s ease-in-out infinite alternate; }
  @keyframes dropBob { from { transform: translateY(-4px); } to { transform: translateY(5px); } }
  .drop-title { font-size:20px; font-weight:700; margin-top:6px; }
  .drop-sub { font-size:13px; color:var(--muted); margin-top:4px; }
  .toast { position:fixed; left:50%; bottom:110px; transform:translateX(-50%); z-index:2500; padding:10px 18px; border-radius:999px;
    background: var(--panel-bg, #1b1b21); border:1px solid rgba(var(--accent-rgb),0.45); color:var(--text); font-size:14px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.35); -webkit-backdrop-filter: blur(var(--blur)); backdrop-filter: blur(var(--blur)); pointer-events:none; }
  .layout { position:relative; z-index:1; width:100vw; height:100vh; display:grid; grid-template-columns:230px 1fr; grid-template-rows:1fr 90px; }
  .sidebar { grid-column:1; grid-row:1/span 2; padding:20px 14px; background:var(--panel-bg); border-right:1px solid var(--border); backdrop-filter:blur(var(--blur)); display:flex; flex-direction:column;}
  .logo-block { margin-bottom:30px; }
  .app-version { margin:4px 0 0 2px; font-size:11px; letter-spacing:1px; color:var(--muted); opacity:.8; }
  .logo { display:flex; align-items:center; font-size:30px; font-weight:700; line-height:30px; color:var(--text); letter-spacing:0.5px;}
  .logo-rest { margin-left:2px; }
  .sidebar-foot { margin-top:auto; }
  .updates-btn { width:100%; display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border:1px solid var(--border); border-radius:10px; background:transparent; color:var(--muted); font-size:13px; cursor:pointer; transition:0.15s ease; }
  .updates-btn:hover { color:var(--text); border-color:rgba(var(--accent-rgb),0.4); }
  .updates-btn .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 8px var(--accent); }
  .nav { display:flex; flex-direction:column; gap:6px;}
  .nav button { padding:12px; border:none; background:transparent; color:var(--muted); text-align:left; cursor:pointer; border-radius:8px;}
  .nav button.active { background:rgba(var(--accent-rgb),0.1); color:var(--text);}
  .content { grid-column:2; grid-row:1; overflow:auto; padding:24px; display:grid; grid-template-rows:minmax(0,1fr); grid-template-columns:minmax(0,1fr);}
  .page-wrap { grid-area:1/1; min-width:0; min-height:0;}
  .player-bar { grid-column:2; grid-row:2; display:grid; grid-template-columns:1fr 2fr 1fr; align-items:center; padding:12px 24px; background:var(--panel-bg); border-top:1px solid var(--border); backdrop-filter:blur(var(--blur));}
  .track-info { overflow:hidden; display:flex; align-items:center; gap:12px; min-width:0;}
  .cover { position:relative; font-size:24px; width:56px; height:56px; min-width:56px; flex:0 0 56px; border-radius:8px; background:var(--item-bg); overflow:hidden; display:flex; align-items:center; justify-content:center;}
  .cover img { width:100%; height:100%; object-fit:cover;}
  .info-text { min-width:0; flex:1 1 auto; overflow:hidden;}
  .title { font-weight:600;}
  .subtitle { font-size:12px; color:var(--muted); min-height:15px;}
  .player-controls { display:flex; flex-direction:column; align-items:center; gap:8px;}
  .controls { display:flex; gap:16px; align-items:center;}
  .nav-btn { background:none; border:none; color:var(--muted); cursor:pointer; font-size:14px;}
  .mode-btn { background:none; border:none; color:var(--muted); cursor:pointer; font-size:19px; padding:4px; display:flex; transition:color .25s ease, transform .15s ease;}
  .mode-btn:hover { color:var(--text); }
  .mode-btn:active { transform:scale(0.9); }
  .mode-btn.active { color:var(--accent);}
  .play-btn { font-size:20px; width:44px; height:44px; border-radius:50%; background:var(--accent); color:white; border:none; font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center;}
  .progress-bar { width:100%; display:flex; align-items:center; gap:10px;}
  .time { font-size:11px; color:var(--muted); min-width:36px; text-align:center;}
  .volume { display:flex; align-items:center; justify-content:flex-end; gap:10px;}
  .vol-icon { font-size:20px; width:22px; height:22px; display:flex; align-items:center; justify-content:center; color:var(--muted);}
  .volume input { width:100px;}
</style>