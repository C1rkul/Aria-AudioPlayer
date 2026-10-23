<script>
  import { settings, defaultSettings, updateSettings } from '../stores/settings.js';
  import RangeField from './RangeField.svelte';
  import { clearTrackRefs } from '../stores/playlists.js';
  import { fly } from 'svelte/transition';
  import { cubicOut, cubicIn } from 'svelte/easing';
  import { playerController } from '../lib/player-controller.js';
  const volumeStore = playerController.volume;
  const TAB_ORDER = { general: 0, nowplaying: 1 };
  let dir = 1;
  function setTab(t) { if (t === tab) return; dir = TAB_ORDER[t] > TAB_ORDER[tab] ? 1 : -1; tab = t; }
  import { tracks, currentIndex } from '../stores/player.js';
  import { SaveTracks, SaveSettings, OpenDataFolder } from '../../wailsjs/go/main/App';

  const LYRICS_PLACEHOLDER = 'https://api.example.com/lyrics?artist={artist}&title={title}';
  let clearing = false;
  const BG_INFO = {
    none: {
      title: 'None',
      text: 'None — без фонового эффекта: чистый фон выбранной темы. Меньше всего нагружает компьютер.'
    },
    particle: {
      title: 'Particle',
      text: 'Particle («частицы») — плавающие точки в цвет акцента, которые соединяются линиями, когда оказываются рядом. «Количество точек» — сколько частиц на экране: чем их больше, тем гуще сеть линий и выше нагрузка.'
    },
    babble: {
      title: 'Babble',
      text: 'Babble (от bubble — «пузыри») — большие светящиеся цветные пузыри, которые медленно дрейфуют по экрану и плавно меняют оттенок. «Количество пузырей» — сколько их одновременно: больше пузырей — ярче и насыщеннее фон.'
    },
    matrix: {
      title: 'Matrix',
      text: 'Matrix («цифровой дождь») — падающие колонки символов, как в фильме «Матрица». «Скорость» — как быстро символы падают вниз. «Плотность символов» — доля колонок экрана, в которых идёт дождь: меньше — реже и спокойнее.'
    },
    aurora: {
      title: 'Aurora',
      text: 'Aurora («северное сияние») — мягкие светящиеся туманности, которые плавно плывут и переливаются разными цветами. «Количество туманностей» — сколько облаков одновременно: больше — богаче и ярче переливы.'
    }
  };
  $: bgInfo = BG_INFO[$settings.background] || BG_INFO.none;

  let tab = 'general'; // 'general' | 'nowplaying'

  async function clearTracks() {
    clearing = true;

    try {
      tracks.set([]);
      currentIndex.set(-1);
      clearTrackRefs();
      await SaveTracks([]);
    } catch (err) {
      console.error('Не удалось очистить треки:', err);
    } finally {
      clearing = false;
    }
  }

  async function resetSettings() {
    const d = { ...defaultSettings };

    settings.set(d);

    try {
      const saved = await SaveSettings(d);
      if (saved) {
        settings.set({ ...defaultSettings, ...saved });
      }
    } catch (err) {
      console.error('Не удалось сбросить настройки:', err);
    }
  }

  async function openDataFolder() {
    try {
      await OpenDataFolder();
    } catch (err) {
      console.error('Не удалось открыть папку:', err);
    }
  }
</script>

<section class="settings-page">
  <h2>Настройки</h2>

  <div class="tabs">
    <button class="chip" class:active={tab === 'general'} on:click={() => setTab('general')}>Основные</button>
    <button class="chip" class:active={tab === 'nowplaying'} on:click={() => setTab('nowplaying')}>Большой экран</button>
  </div>

  <div class="tab-stage">
  {#key tab}
  <div class="tab-pane"
    in:fly={{ x: dir * 70, duration: 340, delay: 120, easing: cubicOut, opacity: 0 }}
    out:fly={{ x: -dir * 70, duration: 180, easing: cubicIn, opacity: 0 }}>
  {#if tab === 'nowplaying'}
  <div class="grid">
    <div class="card">
      <h3>Адаптивный фон</h3>
      <div class="switch-row">
        <span>Подстраивать фон под цвет обложки</span>
        <label class="switch">
          <input
            type="checkbox"
            role="switch"
            aria-label="Адаптивный фон"
            checked={$settings.adaptiveBackground}
            on:change={(e) => updateSettings({ adaptiveBackground: e.currentTarget.checked })}
          />
          <span class="slider"></span>
        </label>
      </div>
      <p class="hint">
        Работает только на большом экране (Now Playing). При включении дизайн и фоновые эффекты
        (Particle, Matrix и т.д.) там отключаются, а фон окрашивается в цвет обложки.
        Если у трека нет обложки, фон тёмный.
      </p>
    </div>

    <div class="card">
      <h3>API для поиска текста</h3>
      <div class="field">
        <label for="lyrics-api">Ссылка на API</label>
        <input
          id="lyrics-api"
          type="text"
          disabled
          value={$settings.lyricsApiUrl || ''}
          placeholder={LYRICS_PLACEHOLDER}
        />
      </div>
      <p class="hint placeholder">Поиск текста через внешний API — в процессе разработки. Поле пока недоступно.</p>
    </div>
  </div>
  {:else}
  <div class="grid">
    <div class="card">
      <h3>Тема</h3>
      <div class="button-group">
        <button
          class="chip"
          class:active={$settings.theme === 'dark'}
          on:click={() => updateSettings({ theme: 'dark' })}
        >
          Тёмная
        </button>

        <button
          class="chip"
          class:active={$settings.theme === 'light'}
          on:click={() => updateSettings({ theme: 'light' })}
        >
          Светлая
        </button>
      </div>
      <div class="switch-row neon-row">
        <span>Неоновая обводка экрана</span>
        <label class="switch">
          <input
            type="checkbox"
            role="switch"
            aria-label="Неоновая обводка экрана"
            checked={$settings.neonFrame}
            on:change={(e) => updateSettings({ neonFrame: e.currentTarget.checked })}
          />
          <span class="slider"></span>
        </label>
      </div>
    </div>

    <div class="card">
      <h3>Дизайн</h3>
      <div class="button-group">
        <button
          class="chip"
          class:active={$settings.design === 'normal'}
          on:click={() => updateSettings({ design: 'normal' })}
        >
          Обычный
        </button>

        <button
          class="chip"
          class:active={$settings.design === 'glass'}
          on:click={() => updateSettings({ design: 'glass' })}
        >
          Glassmorphism
        </button>

        <button
          class="chip"
          class:active={$settings.design === 'glass_plus'}
          on:click={() => updateSettings({ design: 'glass_plus' })}
        >
          Glassmorphism+
        </button>
      </div>

      <p class="hint">
        Glassmorphism+ — монолитный основной фон и стеклянные панели.
      </p>
    </div>

    <div class="card">
      <h3>Фон</h3>
      <div class="button-group">
        <button
          class="chip"
          class:active={$settings.background === 'none'}
          on:click={() => updateSettings({ background: 'none' })}
        >
          None
        </button>

        <button
          class="chip"
          class:active={$settings.background === 'particle'}
          on:click={() => updateSettings({ background: 'particle' })}
        >
          Particle
        </button>

        <button
          class="chip"
          class:active={$settings.background === 'babble'}
          on:click={() => updateSettings({ background: 'babble' })}
        >
          Babble
        </button>

        <button
          class="chip"
          class:active={$settings.background === 'matrix'}
          on:click={() => updateSettings({ background: 'matrix' })}
        >
          Matrix
        </button>

        <button
          class="chip"
          class:active={$settings.background === 'aurora'}
          on:click={() => updateSettings({ background: 'aurora' })}
        >
          Aurora
        </button>
      </div>

      {#if $settings.background === 'particle'}
        <RangeField id="bg-particle" label="Количество точек" min={10} max={200} step={5}
          value={$settings.particleCount} on:change={(e) => updateSettings({ particleCount: e.detail })} />
      {:else if $settings.background === 'babble'}
        <RangeField id="bg-babble" label="Количество пузырей" min={5} max={60} step={1}
          value={$settings.babbleCount} on:change={(e) => updateSettings({ babbleCount: e.detail })} />
      {:else if $settings.background === 'matrix'}
        <RangeField id="bg-matrix-speed" label="Скорость" min={0.3} max={3} step={0.1}
          value={$settings.matrixSpeed} format={(v) => '×' + Number(v).toFixed(1)}
          on:change={(e) => updateSettings({ matrixSpeed: e.detail })} />
        <RangeField id="bg-matrix-density" label="Плотность символов" min={10} max={100} step={5}
          value={$settings.matrixDensity} format={(v) => v + '%'}
          on:change={(e) => updateSettings({ matrixDensity: e.detail })} />
      {:else if $settings.background === 'aurora'}
        <RangeField id="bg-aurora" label="Количество туманностей" min={1} max={12} step={1}
          value={$settings.auroraCount} on:change={(e) => updateSettings({ auroraCount: e.detail })} />
      {/if}

      <p class="hint bg-hint">{bgInfo.text}</p>
    </div>

    <div class="card">
      <h3>Палитра</h3>

      <div class="button-group">
        <button
          class="chip"
          class:active={$settings.palette === 'base'}
          on:click={() => updateSettings({ palette: 'base' })}
        >
          Базовая
        </button>

        <button
          class="chip"
          class:active={$settings.palette === 'custom'}
          on:click={() => updateSettings({ palette: 'custom' })}
        >
          Своя
        </button>
      </div>

      {#if $settings.palette === 'custom'}
        <div class="color-row">
          <label for="accent-color">Accent цвет</label>
          <input
            id="accent-color"
            type="color"
            value={$settings.customAccent || '#7c5cff'}
            on:input={(e) => updateSettings({ customAccent: e.target.value, palette: 'custom' })}
          />
          <code>{$settings.customAccent || '#7c5cff'}</code>
        </div>
      {/if}
    </div>

    <div class="card">
      <h3>Плеер</h3>

      <RangeField id="default-volume" label="Громкость по умолчанию" min={0} max={100} step={1}
        value={Math.round($volumeStore * 100)} format={(v) => v + '%'}
        on:change={(e) => playerController.setVolume(e.detail / 100)} />

      <div class="switch-row restore-row">
        <span>Восстанавливать последний трек при запуске</span>
        <label class="switch">
          <input
            type="checkbox"
            role="switch"
            aria-label="Восстанавливать последний трек при запуске"
            checked={$settings.restoreLastTrack}
            on:change={(e) => updateSettings({ restoreLastTrack: e.currentTarget.checked })}
          />
          <span class="slider"></span>
        </label>
      </div>
    </div>

    <div class="card">
      <h3>Кроссфейд</h3>

      <div class="switch-row restore-row">
        <span>Плавный переход между треками</span>
        <label class="switch">
          <input
            type="checkbox"
            role="switch"
            aria-label="Кроссфейд при переключении треков"
            checked={$settings.crossfadeEnabled}
            on:change={(e) => updateSettings({ crossfadeEnabled: e.currentTarget.checked })}
          />
          <span class="slider"></span>
        </label>
      </div>

      {#if $settings.crossfadeEnabled}
        <RangeField
          id="crossfade-duration"
          label="Длительность перехода"
          min={1}
          max={12}
          step={0.5}
          value={$settings.crossfadeDuration ?? 5}
          format={(v) => `${v} с`}
          on:change={(e) => updateSettings({ crossfadeDuration: e.detail })}
        />
        <p class="hint">Старый трек плавно затухает, новый плавно вступает — при автоматическом переходе к следующему треку и в конце очереди (затихание). Любые ручные переключения — всегда мгновенные.</p>
      {/if}
    </div>

    <div class="card">
      <h3>Данные</h3>

      <div class="field">
        <label for="data-folder">Папка сохранения</label>
        <input
          id="data-folder"
          type="text"
          readonly
          value={$settings.dataFolder || 'Documents/audioplayer'}
        />
      </div>

      <div class="button-group">
        <button class="chip" on:click={openDataFolder}>
          Открыть папку
        </button>

        <button
          class="chip danger"
          on:click={clearTracks}
          disabled={$tracks.length === 0 || clearing}
        >
          {clearing ? 'Очистка...' : 'Очистить список треков'}
        </button>
      </div>
    </div>

    <div class="card">
      <h3>Система</h3>

      <div class="button-group">
        <button class="chip danger" on:click={resetSettings}>
          Сбросить настройки
        </button>
      </div>
    </div>
  </div>
  {/if}
  </div>
  {/key}
  </div>

  <p class="note">Новые функции позже. Идет работа.</p>
</section>

<style>
  .tab-stage { display: grid; grid-template-columns: minmax(0, 1fr); overflow-x: clip; }
  .tab-pane { grid-area: 1 / 1; min-width: 0; }
  .settings-page {
    width: 100%;
    max-width: 1100px;
  }

  h2 {
    margin: 0 0 18px 0;
    color: var(--text);
    font-size: 28px;
  }

  h3 {
    margin: 0 0 14px 0;
    color: var(--text);
    font-size: 17px;
  }

  .switch-row { display:flex; align-items:center; justify-content:space-between; gap:14px; color:var(--text); }
  .switch { position:relative; width:46px; height:26px; flex-shrink:0; display:inline-block; }
  .switch input { opacity:0; width:0; height:0; position:absolute; }
  .slider { position:absolute; inset:0; border-radius:999px; background:var(--chip-bg); border:1px solid var(--border); cursor:pointer; transition:background-color .3s ease, border-color .3s ease; }
  .slider::before { content:''; position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.35); transition:transform .3s cubic-bezier(.4,0,.2,1); }
  .switch input:checked + .slider { background:var(--accent); border-color:var(--accent); }
  .switch input:checked + .slider::before { transform:translateX(20px); }
  .switch input:focus-visible + .slider { outline:2px solid var(--accent); outline-offset:2px; }

  .neon-row { margin-top: 16px; }
  .restore-row { margin-top: 18px; }
  .bg-hint { min-height: 5.2em; }
  .field input:disabled { opacity: .55; cursor: not-allowed; }

  .tabs {
    display: flex;
    gap: 8px;
    margin: 0 0 16px 0;
  }

  .placeholder {
    margin: 0;
    padding: 14px;
    border: 1px dashed var(--panel-border);
    border-radius: 12px;
    text-align: center;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
  }

  .card {
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 18px;
    padding: 18px;
    backdrop-filter: blur(var(--blur));
    box-shadow: var(--shadow);
  }

  .button-group {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip {
    padding: 9px 13px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--chip-bg);
    color: var(--muted);
    transition: 0.15s ease;
  }

  .chip:hover:not(:disabled) {
    color: var(--text);
    border-color: rgba(var(--accent-rgb), 0.28);
    background: rgba(var(--accent-rgb), 0.08);
  }

  .chip.active {
    color: var(--text);
    border-color: rgba(var(--accent-rgb), 0.38);
    background: rgba(var(--accent-rgb), 0.16);
  }

  .chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .danger {
    color: #ff6b6d;
    border-color: rgba(255, 77, 79, 0.25);
    background: rgba(255, 77, 79, 0.10);
  }

  .danger:hover:not(:disabled) {
    color: #fff;
    background: rgba(255, 77, 79, 0.85);
    border-color: rgba(255, 77, 79, 0.9);
  }

  .hint {
    margin: 12px 0 0 0;
    font-size: 12px;
    color: var(--muted);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 14px;
  }

  .field label {
    font-size: 13px;
    color: var(--muted);
  }

  .field input[type='text'] {
    width: 100%;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--item-bg);
    color: var(--text);
    outline: none;
    box-sizing: border-box;
  }

  .color-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
    flex-wrap: wrap;
  }

  .color-row label {
    color: var(--muted);
    font-size: 13px;
  }

  .color-row input[type='color'] {
    width: 44px;
    height: 34px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--item-bg);
    cursor: pointer;
    padding: 2px;
  }

  .color-row code {
    color: var(--muted);
    font-size: 12px;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text);
    font-size: 14px;
    cursor: pointer;
  }

  .checkbox-row input {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
  }

  .note {
    margin-top: 28px;
    text-align: center;
    color: var(--muted);
    font-size: 14px;
  }
</style>