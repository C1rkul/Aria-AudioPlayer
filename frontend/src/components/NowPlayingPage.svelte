<script>
  import { currentTrack, isPlaying, repeatMode, shuffleEnabled } from '../stores/player.js';
  import { fly } from 'svelte/transition';
  import { cubicOut, cubicIn } from 'svelte/easing';
  import CoverImage from './CoverImage.svelte';
  import RepeatIcon from './RepeatIcon.svelte';
  import ShuffleIcon from './ShuffleIcon.svelte';
  import { playerController } from '../lib/player-controller.js';
  import { getSourceProvider } from '../lib/sources/index.js';
  import { onMount } from 'svelte';
  import { settings } from '../stores/settings.js';
  import BackgroundFX from './BackgroundFX.svelte';
  import PlayPauseIcon from './PlayPauseIcon.svelte';
  import VolumeIcon from './VolumeIcon.svelte';
  import { updateSettings } from '../stores/settings.js';
  import { fetchLyrics } from '../lib/lyrics.js';

  export let streamBaseUrl = '';

  // --- тайминг и громкость ---
  const { currentTime, duration } = playerController;
  $: volume = $settings.defaultVolume ?? 0.5;
  $: progress = $duration > 0 ? ($currentTime / $duration) * 100 : 0;

  function fmt(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  }
  function onSeek(e) { playerController.seek(Number(e.target.value)); }
  function onVolume(e) {
    const v = Number(e.target.value) / 100;
    playerController.setTargetVolume(v);
    updateSettings({ defaultVolume: v });
  }

  // --- текст трека (заготовка под внешний API) ---
  let lyrics = { status: 'disabled', text: '' };
  let lyricsToken = 0;
  $: loadLyrics($currentTrack);
  async function loadLyrics(track) {
    const token = ++lyricsToken;
    if (!track) { lyrics = { status: 'disabled', text: '' }; return; }
    const res = await fetchLyrics(track, $settings.lyricsApiUrl);
    if (token === lyricsToken) lyrics = res;
  }
  const LYRICS_HINTS = {
    disabled: 'Текст трека появится здесь, когда будет подключён API для поиска текстов.',
    'no-api': 'Укажите ссылку на API в настройках, чтобы искать текст.',
    none: 'Текст для этого трека не найден.',
    error: 'Не удалось загрузить текст.'
  };

  let canvas;
  let raf;

  // Состояние выезда страницы: тяжёлые вещи (аудио-анализатор, цвет обложки) стартуют только после него
  let introDone = false;
  let closing = false;
  let vizStarted = false;

  $: if (introDone && canvas && !vizStarted) { vizStarted = true; startViz(); }

  function startViz() {
    const analyser = playerController.getAnalyser();
    const ctx = canvas.getContext('2d');
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const bars = 48;

    function draw() {
      raf = requestAnimationFrame(draw);
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (!analyser) return;
      if (playerController.audioCtx?.state === 'suspended') playerController.audioCtx.resume();
      analyser.getByteFrequencyData(data);
      const rgb = getComputedStyle(document.body).getPropertyValue('--accent-rgb').trim() || '124,92,255';
      const gap = 3, bw = (w - gap * (bars - 1)) / bars;
      const usable = Math.floor(data.length * 0.75); // верхние частоты почти пустые
      for (let i = 0; i < bars; i++) {
        const v = data[Math.floor((i / bars) * usable)] / 255;
        const bh = Math.max(3, v * h);
        ctx.fillStyle = `rgba(${rgb}, ${0.35 + v * 0.65})`;
        ctx.beginPath();
        ctx.roundRect(i * (bw + gap), h - bh, bw, bh, 2);
        ctx.fill();
      }
    }
    draw();
  }

  onMount(() => () => cancelAnimationFrame(raf));

  let coverUrl = '';

  // --- Адаптивный фон: цвет берётся из обложки ---
  const DARK_BG = '#0b0b0d';
  let adaptiveColor = DARK_BG;
  let colorToken = 0;

  $: adaptive = !!$settings.adaptiveBackground;
  // цвет считаем только когда страница уже выехала и пока не начала уезжать (при закрытии цвет «замораживается»)
  $: if (adaptive && introDone && !closing) updateAdaptiveColor(coverUrl);

  function updateAdaptiveColor(url) {
    const token = ++colorToken;
    if (!url) { if (!closing) adaptiveColor = DARK_BG; return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (token !== colorToken || closing) return;
      try {
        const n = 24;
        const c = document.createElement('canvas');
        c.width = c.height = n;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, n, n);
        const d = x.getImageData(0, 0, n, n).data;
        let r = 0, g = 0, b = 0, wsum = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2];
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          const sat = mx ? (mx - mn) / mx : 0;
          const light = (mx + mn) / 510;
          // насыщенные и не слишком тёмные/светлые пиксели весят больше
          const w = 0.05 + sat * sat * (1 - Math.abs(light - 0.5) * 1.4);
          r += R * w; g += G * w; b += B * w; wsum += w;
        }
        r /= wsum; g /= wsum; b /= wsum;
        // затемняем, чтобы белый текст оставался читаемым
        const k = Math.min(1, 95 / Math.max(r, g, b, 1));
        adaptiveColor = `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
      } catch (e) {
        adaptiveColor = DARK_BG;
      }
    };
    img.onerror = () => { if (token === colorToken && !closing) adaptiveColor = DARK_BG; };
    img.src = url;
  }
  let title = '';
  let artist = '';
  let album = '';

  // Реактивное обновление инфо при смене трека
  $: if ($currentTrack) {
    const provider = getSourceProvider($currentTrack);
    coverUrl = provider.getCoverUrl($currentTrack, streamBaseUrl) || '';
    title = $currentTrack.title || 'Unknown Title';
    artist = $currentTrack.artist || 'Unknown Artist';
    album = $currentTrack.album || 'Unknown Album';
  } else {
    coverUrl = '';
    title = 'Нет активного трека';
    artist = '';
    album = '';
  }

  function handleBackgroundClick() {
    // Закрываем модалку
    window.dispatchEvent(new CustomEvent('close-now-playing'));
  }
  
  function handleKeydown(event) {
    if (event.key === 'Escape') {
      handleBackgroundClick();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- Added role and tabindex for accessibility compliance -->
<div 
  class="now-playing-overlay"
  class:adaptive
  on:introend={() => (introDone = true)}
  on:outrostart={() => (closing = true)}
  in:fly|global={{ y: 720, duration: 650, easing: cubicOut, opacity: 1 }}
  out:fly|global={{ y: 720, duration: 480, easing: cubicIn, opacity: 1 }}
  style={adaptive ? `background-color:${adaptiveColor}` : ''}
  on:click|self={handleBackgroundClick}
  role="dialog"
  aria-modal="true"
  aria-label="Режим Now Playing"
  tabindex="-1"
>
  {#if !adaptive}
    <BackgroundFX />
  {/if}
  <div class="np-container" class:designed={!adaptive && $settings.design !== 'normal'}>
    <div class="np-main">
      <div class="np-artwork">
        <CoverImage src={coverUrl} placeholder="🎵" duration={450} />
      </div>

      <div class="np-info">
        <h1>{title}</h1>
        <p class="artist">{artist}</p>
        <p class="album">{album}</p>
      </div>

      <canvas class="visualizer" bind:this={canvas} width="480" height="64"></canvas>

      <div class="np-seek">
        <span class="np-time">{fmt($currentTime)}</span>
        <input
          type="range" min="0" max="100" step="0.1"
          aria-label="Перемотка"
          value={progress}
          style="--fill-percent:{progress}%"
          on:input={onSeek}
        />
        <span class="np-time">{fmt($duration)}</span>
      </div>

      <div class="np-controls">
        <button class="mode" class:on={$shuffleEnabled} on:click={() => shuffleEnabled.update((v) => !v)}
                title={$shuffleEnabled ? 'Перемешивание включено' : 'Перемешивание выключено'}>
          <ShuffleIcon />
        </button>
        <button on:click={() => playerController.prev()} title="Предыдущий">⏮</button>
        <button
          class="main-play"
          on:click={() => playerController.togglePlay()}
          title={$isPlaying ? 'Пауза' : 'Играть'}
        >
          <PlayPauseIcon playing={$isPlaying} />
        </button>
        <button on:click={() => playerController.next()} title="Следующий">⏭</button>
        <button class="mode" class:on={$repeatMode !== 'off'}
                on:click={() => repeatMode.update((v) => (v === 'off' ? 'all' : v === 'all' ? 'one' : 'off'))}
                title={$repeatMode === 'one' ? 'Повтор: один трек' : $repeatMode === 'all' ? 'Повтор: весь список' : 'Повтор выключен'}>
          <RepeatIcon mode={$repeatMode} />
        </button>
      </div>

      <div class="np-volume">
        <span class="np-vol-icon"><VolumeIcon {volume} /></span>
        <input
          type="range" min="0" max="100"
          aria-label="Громкость"
          value={Math.round(volume * 100)}
          style="--fill-percent:{volume * 100}%"
          on:input={onVolume}
        />
        <span class="np-time">{Math.round(volume * 100)}%</span>
      </div>
    </div>

    <aside class="np-lyrics">
      <h2>Текст</h2>
      <div class="lyrics-body">
        {#if lyrics.status === 'found'}
          <pre>{lyrics.text}</pre>
        {:else}
          <p class="lyrics-empty">{LYRICS_HINTS[lyrics.status] || LYRICS_HINTS.disabled}</p>
        {/if}
      </div>
    </aside>

    <button class="close-btn" on:click={handleBackgroundClick} title="Закрыть">✕</button>
  </div>
</div>

<style>
  .now-playing-overlay {
    position: fixed;
    inset: 0;
    background: var(--bg, #0f0f12);
    color: var(--text, #fff);
    transition: background-color 0.8s ease;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .np-container {
    width: 100%;
    max-width: 980px;
    padding: 32px 36px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 36px;
    align-items: stretch;
    text-align: center;
    color: var(--text, #fff);
    position: relative;
    z-index: 1;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: 28px;
  }

  .np-container.designed {
    background: var(--panel-bg);
    border-color: var(--panel-border);
    backdrop-filter: blur(var(--blur));
    -webkit-backdrop-filter: blur(var(--blur));
    box-shadow: var(--shadow);
  }

  /* Адаптивный режим: без дизайна и эффектов, поверх цвета обложки — мягкое затемнение */
  .now-playing-overlay.adaptive { color: #fff; }
  .now-playing-overlay.adaptive::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 100%);
    pointer-events: none;
  }
  .now-playing-overlay.adaptive .np-info .artist { color: rgba(255,255,255,0.75); }
  .now-playing-overlay.adaptive .np-info .album { color: rgba(255,255,255,0.5); }
  .now-playing-overlay.adaptive .np-controls button,
  .now-playing-overlay.adaptive .close-btn { color: #fff; }

  .np-artwork {
    width: 240px;
    height: 240px;
    margin: 0 auto 20px;
    font-size: 80px;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    background: #222;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .np-artwork img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .art-placeholder {
    font-size: 80px;
    opacity: 0.5;
  }

  .np-info h1 {
    font-size: 28px;
    margin: 0 0 8px;
    font-weight: 700;
  }

  .np-info .artist {
    font-size: 18px;
    color: var(--muted, #aaa);
    margin: 0 0 4px;
  }

  .np-info .album {
    font-size: 14px;
    color: var(--muted, #666);
    opacity: 0.8;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .visualizer {
    display: block;
    width: 100%;
    height: 56px;
    margin: 14px 0 6px;
  }

  .np-main { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
  .np-info h1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .np-seek, .np-volume { display: flex; align-items: center; gap: 10px; }
  .np-seek { margin: 6px 0 14px; }
  .np-volume { margin: 16px auto 0; width: 70%; }
  .np-time { font-size: 12px; min-width: 38px; color: var(--muted, #aaa); font-variant-numeric: tabular-nums; }
  .np-vol-icon { font-size: 20px; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; color: var(--muted, #aaa); }

  .np-lyrics {
    display: flex; flex-direction: column; min-height: 0; align-self: stretch; width: 100%;
    border: 1px solid var(--panel-border, rgba(255,255,255,0.1));
    border-radius: 18px; padding: 16px 18px; box-sizing: border-box; text-align: left;
    background: rgba(127,127,127,0.07);
  }
  .np-lyrics h2 { margin: 0 0 10px; font-size: 14px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--muted, #aaa); font-weight: 600; }
  .lyrics-body { overflow-y: auto; min-height: 220px; flex: 1; scrollbar-width: thin; }
  .lyrics-body pre { margin: 0; white-space: pre-wrap; font: inherit; line-height: 1.7; font-size: 16px; }
  .lyrics-empty { margin: 0; color: var(--muted, #aaa); font-size: 14px; line-height: 1.6; border: 1px dashed rgba(127,127,127,0.35); border-radius: 12px; padding: 16px; }
  .now-playing-overlay.adaptive .np-lyrics { background: rgba(0,0,0,0.22); border-color: rgba(255,255,255,0.12); }
  .now-playing-overlay.adaptive .lyrics-empty, .now-playing-overlay.adaptive .np-time, .now-playing-overlay.adaptive .np-vol-icon { color: rgba(255,255,255,0.7); }

  .np-controls .mode { font-size: 22px; opacity: 0.5; display: flex; position: relative; transition: opacity .25s ease, color .25s ease; }
  .np-controls .mode.on { opacity: 1; color: var(--accent, #7c5cff); }
  .np-controls .mode.on::after { content: ''; position: absolute; left: 50%; bottom: -8px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: currentColor; }
  .now-playing-overlay.adaptive .np-controls .mode.on { color: #fff; }

  .np-controls {
    display: flex;
    justify-content: center;
    gap: 26px;
    align-items: center;
  }

  .np-controls button {
    background: none;
    border: none;
    color: var(--text, white);
    font-size: 24px;
    cursor: pointer;
    transition: transform 0.1s;
  }

  .np-controls button:hover {
    transform: scale(1.1);
  }

  .np-controls .main-play {
    color: #fff !important;
    background: var(--accent, #7c5cff);
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: var(--accent, #7c5cff);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px !important;
    box-shadow: 0 4px 15px rgba(var(--accent-rgb, 124,92,255), 0.4);
  }

  .close-btn {
    position: absolute;
    top: 20px;
    right: 20px;
    background: none;
    border: none;
    color: var(--muted, #888);
    font-size: 24px;
    cursor: pointer;
  }
  
  .close-btn:hover {
    color: var(--text, white);
  }
</style>