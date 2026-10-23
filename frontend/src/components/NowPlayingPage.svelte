<script>
  import { currentTrack, isPlaying, repeatMode, shuffleEnabled, tracks } from '../stores/player.js';
  import { playlists, queue, ALL_ID, moveInPlaylist, removeFromPlaylist } from '../stores/playlists.js';
  import TrackList from './TrackList.svelte';
  import { slide } from 'svelte/transition';
  import { updateSettings } from '../stores/settings.js';
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
  import { fetchLyrics } from '../lib/lyrics.js';

  export let streamBaseUrl = '';

  // --- тайминг и громкость ---
  const { currentTime, duration } = playerController;
  const volumeStore = playerController.volume;
  $: volume = $volumeStore;
  $: progress = $duration > 0 ? ($currentTime / $duration) * 100 : 0;

  function fmt(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  }
  function onSeek(e) { playerController.seek(Number(e.target.value)); }
  function onVolume(e) {
    const v = Number(e.target.value) / 100;
    playerController.setVolume(v);
  }

  // --- текст трека (заготовка под внешний API) ---
  // --- правая панель: Текст / Очередь / Плейлист ---
  const PANELS = ['lyrics', 'queue', 'playlist', 'tune'];
  const PANEL_NAMES = { lyrics: 'Текст', queue: 'Очередь', playlist: 'Плейлист', tune: 'Настройки' };
  const speedStore = playerController.speed;
  const pitchStore = playerController.pitch;
  const linkedStore = playerController.tempoLinked;
  const TEMPO_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const fmtX = (n) => n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + '×';
  $: pitch = $pitchStore;
  $: linked = $linkedStore;

  // --- визуализатор: пресеты ---
  const VIZ_PRESETS = [['base', 'Обычный'], ['circle', 'Круглый'], ['big', 'Большой']];
  $: vizPreset = $settings.vizPreset || 'base';
  $: vizBars = Math.min(128, Math.max(8, $settings.vizBars || 48));
  $: vizSpin = !!$settings.vizSpin;
  let rootEl;
  const EQ_BANDS = ['60', '170', '310', '600', '1k', '3k', '6k', '12k', '14k', '16k'];
  $: speed = $speedStore;
  let panel = 'lyrics';
  let panelDir = 1;
  function setPanel(p) {
    if (p === panel) return;
    panelDir = PANELS.indexOf(p) >= PANELS.indexOf(panel) ? 1 : -1;
    panel = p;
  }

  $: byId = new Map($tracks.map((t) => [t.id, t]));
  $: activeId = $currentTrack?.id ?? null;

  $: queueIds = $queue.sourceId === ALL_ID ? $tracks.map((t) => t.id) : $queue.trackIds.filter((id) => byId.has(id));
  $: queueItems = queueIds.map((id) => byId.get(id));
  $: queueSource = $queue.sourceId === ALL_ID ? 'Все песни'
    : $playlists.find((p) => p.id === $queue.sourceId)?.name
      ?? ($queue.sourceId === 'search' ? 'Результаты поиска' : 'Своя очередь');
  function queuePlay(e) {
    const id = e.detail;
    if (id === activeId) playerController.togglePlay();
    else playerController.playFrom($queue.sourceId, queueIds, id);
  }

  let plPick = null;
  $: plDefault = $playlists.some((p) => p.id === $queue.sourceId) ? $queue.sourceId
    : ($playlists.find((p) => p.trackIds.includes(activeId))?.id ?? $playlists[0]?.id ?? null);
  $: plId = plPick && $playlists.some((p) => p.id === plPick) ? plPick : plDefault;
  $: plObj = $playlists.find((p) => p.id === plId) || null;
  $: plItems = plObj ? plObj.trackIds.map((id) => byId.get(id)).filter(Boolean) : [];
  function plPlay(e) {
    const id = e.detail;
    if (id === activeId) playerController.togglePlay();
    else playerController.playFrom(plId, plItems.map((t) => t.id), id);
  }

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

  let raf;

  // Состояние выезда страницы: тяжёлые вещи (аудио-анализатор, цвет обложки) стартуют только после него
  let introDone = false;
  let closing = false;
  let vizStarted = false;

  $: if (introDone && rootEl && !vizStarted) { vizStarted = true; startViz(); }

  function startViz() {
    const analyser = playerController.getAnalyser();
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    function draw() {
      raf = requestAnimationFrame(draw);
      const cv = rootEl && rootEl.querySelector('canvas.viz');
      if (!cv) return;
      const ctx = cv.getContext('2d');
      if (vizPreset === 'big') {
        const cw = cv.clientWidth, ch = cv.clientHeight;
        if (cw && ch && (cv.width !== cw || cv.height !== ch)) { cv.width = cw; cv.height = ch; }
      }
      const w = cv.width, h = cv.height;
      ctx.clearRect(0, 0, w, h);
      if (!analyser) return;
      if (playerController.audioCtx?.state === 'suspended') playerController.audioCtx.resume();
      analyser.getByteFrequencyData(data);
      const rgb = getComputedStyle(document.body).getPropertyValue('--accent-rgb').trim() || '124,92,255';
      const usable = Math.floor(data.length * 0.75); // верхние частоты почти пустые
      const bars = vizBars;
      const lvl = (t) => data[Math.min(usable - 1, Math.floor(t * usable))] / 255;

      if (vizPreset === 'circle') {
        // колонки по кругу вокруг обложки; частоты отражены, чтобы на стыке не было скачка
        const cx = w / 2, cy = h / 2, r0 = 124;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(2, Math.min(9, (2 * Math.PI * r0) / bars * 0.55));
        for (let i = 0; i < bars; i++) {
          const t = i < bars / 2 ? i / (bars / 2) : (bars - i) / (bars / 2);
          const v = lvl(t);
          const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
          const len = 4 + v * 48;
          ctx.strokeStyle = `rgba(${rgb}, ${0.35 + v * 0.65})`;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
          ctx.stroke();
        }
      } else if (vizPreset === 'big') {
        // большой фоновый визуализатор: басы в центре, высокие по краям
        const gap = 3, bw = Math.max(2, (w - gap * (bars - 1)) / bars);
        for (let i = 0; i < bars; i++) {
          const t = Math.abs((2 * i) / Math.max(1, bars - 1) - 1);
          const v = lvl(t);
          const bh = Math.max(4, Math.pow(v, 1.25) * h * 0.95);
          ctx.fillStyle = `rgba(${rgb}, ${0.18 + v * 0.32})`;
          ctx.beginPath();
          ctx.roundRect(i * (bw + gap), h - bh, bw, bh, Math.min(6, bw / 2));
          ctx.fill();
        }
      } else {
        const gap = 3, bw = Math.max(1, (w - gap * (bars - 1)) / bars);
        for (let i = 0; i < bars; i++) {
          const v = lvl(i / bars);
          const bh = Math.max(3, v * h);
          ctx.fillStyle = `rgba(${rgb}, ${0.35 + v * 0.65})`;
          ctx.beginPath();
          ctx.roundRect(i * (bw + gap), h - bh, bw, bh, Math.min(2, bw / 2));
          ctx.fill();
        }
      }
    }
    draw();
  }

  onMount(() => () => cancelAnimationFrame(raf));
  // при закрытии замораживаем визуализатор — страница уезжает без лишней работы
  $: if (closing) cancelAnimationFrame(raf);

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
  class:closing
  bind:this={rootEl}
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
    <BackgroundFX active={!closing} />
  {/if}
  {#if vizPreset === 'big'}
    <canvas class="viz viz-big" width="800" height="400"></canvas>
  {/if}
  <div class="np-container" class:designed={!adaptive && $settings.design !== 'normal'}>
    <div class="np-main">
      <div class="art-stage" class:circle={vizPreset === 'circle'}>
        {#if vizPreset === 'circle'}
          <canvas class="viz viz-ring" class:spin={vizSpin} width="400" height="400"></canvas>
        {/if}
        <div class="np-artwork" class:round={vizPreset === 'circle'}>
          <CoverImage src={coverUrl} placeholder="🎵" duration={450} />
        </div>
      </div>

      <div class="np-info">
        <h1>{title}</h1>
        <p class="artist">{artist}</p>
        <p class="album">{album}</p>
      </div>

      {#if vizPreset === 'base'}
        <canvas class="visualizer viz" width="480" height="64"></canvas>
      {/if}

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
      <div class="panel-tabs">
        {#each PANELS as p}
          <button class:active={panel === p} on:click={() => setPanel(p)}>{PANEL_NAMES[p]}</button>
        {/each}
      </div>
      <div class="panel-body">
        {#key panel}
          <div class="pane"
            in:fly|global={{ x: panelDir * 40, duration: 280, delay: 100, easing: cubicOut, opacity: 0 }}
            out:fly|global={{ x: -panelDir * 40, duration: 150, easing: cubicIn, opacity: 0 }}>
            {#if panel === 'lyrics'}
              <div class="lyrics-scroll">
                {#if lyrics.status === 'found'}
                  <pre>{lyrics.text}</pre>
                {:else}
                  <p class="lyrics-empty">{LYRICS_HINTS[lyrics.status] || LYRICS_HINTS.disabled}</p>
                {/if}
              </div>
            {:else if panel === 'queue'}
              <div class="pane-sub">Источник: {queueSource} · {queueItems.length}</div>
              <div class="pane-list">
                <TrackList items={queueItems} {activeId} streamBase={streamBaseUrl} reorderable removable
                  emptyText="Очередь пуста. Запустите трек из списка."
                  on:play={queuePlay}
                  on:move={(e) => playerController.moveInQueue(e.detail.from, e.detail.to)}
                  on:remove={(e) => playerController.removeFromQueue(e.detail)} />
              </div>
            {:else if panel === 'tune'}
              <div class="tune">
                <div class="tune-card">
                  <div class="tune-head">
                    <h3>Скорость и тон</h3>
                    <button class="link-btn" class:on={linked} on:click={() => playerController.setTempoLinked(!linked)}
                      title={linked ? 'Связаны: меняются вместе. Нажмите, чтобы разделить' : 'Раздельно. Нажмите, чтобы связать'}>
                      {linked ? '🔗 Связаны' : '⛓ Раздельно'}
                    </button>
                  </div>
                  <div class="tune-row"><span>Скорость</span><span class="tune-val">{fmtX(speed)}</span></div>
                  <div class="chips">
                    {#each TEMPO_PRESETS as v}
                      <button class:active={Math.abs(speed - v) < 0.001} on:click={() => playerController.setSpeed(v)}>{fmtX(v)}</button>
                    {/each}
                  </div>
                  <div class="tune-row"><span>Тон</span><span class="tune-val">{fmtX(pitch)}</span></div>
                  <div class="chips">
                    {#each TEMPO_PRESETS as v}
                      <button class:active={Math.abs(pitch - v) < 0.001} on:click={() => playerController.setPitch(v)}>{fmtX(v)}</button>
                    {/each}
                  </div>
                  <p class="tune-note">
                    {linked ? 'Связаны: меняются вместе, как у пластинки — тон растёт и падает вместе со скоростью.' : 'Раздельно: скорость меняется без изменения тона, а тон — без изменения скорости.'}
                    Сбрасывается при перезапуске.
                  </p>
                </div>

                <div class="tune-card">
                  <div class="tune-head"><h3>Визуализатор</h3><span class="tune-val">{vizBars}</span></div>
                  <div class="chips no-top">
                    {#each VIZ_PRESETS as [id, name]}
                      <button class:active={vizPreset === id} on:click={() => updateSettings({ vizPreset: id })}>{name}</button>
                    {/each}
                  </div>
                  <div class="tune-row"><span>Количество колонок</span></div>
                  <input type="range" min="8" max="128" step="1" aria-label="Количество колонок"
                    value={vizBars} style="--fill-percent:{((vizBars - 8) / 120) * 100}%"
                    on:input={(e) => updateSettings({ vizBars: Number(e.currentTarget.value) })} />
                  {#if vizPreset === 'circle'}
                    <div transition:slide={{ duration: 220 }}>
                      <button class="spin-btn" class:on={vizSpin} on:click={() => updateSettings({ vizSpin: !vizSpin })}>
                        ↻ Вращение по часовой: {vizSpin ? 'вкл' : 'выкл'}
                      </button>
                    </div>
                  {/if}
                </div>

                <div class="tune-card soon">
                  <div class="tune-head"><h3>Эквалайзер</h3><span class="badge">в разработке</span></div>
                  <div class="eq">
                    {#each EQ_BANDS as f}
                      <div class="eq-band"><div class="eq-bar"><span></span></div><small>{f}</small></div>
                    {/each}
                  </div>
                </div>

              </div>
            {:else}
              {#if $playlists.length === 0}
                <p class="lyrics-empty">Плейлистов пока нет. Создайте плейлист на вкладке «Плеер» или на странице «Плейлисты».</p>
              {:else}
                <div class="pl-chips">
                  {#each $playlists as pl (pl.id)}
                    <button class:active={pl.id === plId} on:click={() => (plPick = pl.id)} title={pl.name}>{pl.name}</button>
                  {/each}
                </div>
                <div class="pane-list">
                  <TrackList items={plItems} {activeId} streamBase={streamBaseUrl} reorderable removable
                    emptyText="В плейлисте пока нет треков."
                    on:play={plPlay}
                    on:move={(e) => moveInPlaylist(plId, e.detail.from, e.detail.to)}
                    on:remove={(e) => removeFromPlaylist(plId, e.detail)} />
                </div>
              {/if}
            {/if}
          </div>
        {/key}
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
    will-change: transform;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .now-playing-overlay.closing, .now-playing-overlay.closing :global(*) { transition: none !important; animation-play-state: paused !important; }

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

  .art-stage { position: relative; width: 240px; height: 240px; margin: 0 auto 20px; transition: margin 0.4s ease; }
  .art-stage.circle { margin: 34px auto 54px; }
  .viz-ring { position: absolute; left: 50%; top: 50%; width: 400px; height: 400px; margin: -200px 0 0 -200px; pointer-events: none; }
  .viz-ring.spin { animation: vizspin 28s linear infinite; }
  @keyframes vizspin { to { transform: rotate(360deg); } }
  .viz-big { position: absolute; left: 0; right: 0; bottom: 0; width: 100%; height: 72%; pointer-events: none; z-index: 0; }
  .np-artwork {
    position: relative;
    transition: border-radius 0.45s ease;
    width: 100%;
    height: 100%;
    margin: 0;
    font-size: 80px;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    background: #222;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .np-artwork.round { border-radius: 50%; }

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
  .panel-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
  .panel-tabs button { padding: 6px 12px; border: 1px solid transparent; border-radius: 999px; background: rgba(127,127,127,0.14); color: var(--muted, #aaa); font-size: 13px; transition: 0.15s ease; }
  .panel-tabs button:hover { color: var(--text, #fff); }
  .panel-tabs button.active { background: rgba(var(--accent-rgb), 0.28); border-color: rgba(var(--accent-rgb), 0.5); color: var(--text, #fff); }
  .panel-body { position: relative; flex: 1; min-height: 240px; overflow: hidden; }
  .pane { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
  .tune { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 4px; scrollbar-width: thin; }
  .tune-card { padding: 12px 14px; border-radius: 14px; border: 1px solid rgba(127,127,127,0.25); background: rgba(127,127,127,0.07); text-align: left; }
  .tune-card.soon { border-style: dashed; opacity: 0.7; }
  .tune-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .tune-head h3 { margin: 0; font-size: 14px; }
  .tune-val { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--accent); }
  .tune-card input[type=range] { width: 100%; }
  .tune .chips { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .tune .chips button { padding: 4px 10px; border: 1px solid rgba(127,127,127,0.3); border-radius: 999px; background: transparent; color: var(--muted, #aaa); font-size: 12px; }
  .tune .chips button.active { border-color: rgba(var(--accent-rgb), 0.6); background: rgba(var(--accent-rgb), 0.2); color: var(--text, #fff); }
  .tune-row { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 13px; color: var(--muted, #aaa); }
  .tune .chips.no-top { margin-top: 0; margin-bottom: 4px; }
  .link-btn, .spin-btn { padding: 4px 10px; border: 1px solid rgba(127,127,127,0.35); border-radius: 999px; background: transparent; color: var(--muted, #aaa); font-size: 12px; transition: 0.15s ease; }
  .link-btn.on, .spin-btn.on { border-color: rgba(var(--accent-rgb), 0.6); background: rgba(var(--accent-rgb), 0.2); color: var(--text, #fff); }
  .spin-btn { margin-top: 10px; }
  .tune-note { margin: 8px 0 0; font-size: 12px; color: var(--muted, #aaa); line-height: 1.5; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(127,127,127,0.2); color: var(--muted, #aaa); }
  .eq { display: flex; justify-content: space-between; gap: 4px; height: 64px; }
  .eq-band { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
  .eq-bar { flex: 1; width: 4px; border-radius: 2px; background: rgba(127,127,127,0.3); position: relative; }
  .eq-bar span { position: absolute; left: -3px; right: -3px; top: 50%; height: 6px; margin-top: -3px; border-radius: 3px; background: rgba(127,127,127,0.7); }
  .eq-band small { font-size: 9px; color: var(--muted, #aaa); }
  .lyrics-scroll { flex: 1; overflow-y: auto; scrollbar-width: thin; }
  .pane-sub { font-size: 12px; color: var(--muted, #aaa); margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pane-list { flex: 1; min-height: 0; }
  .pl-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin-bottom: 8px; flex: 0 0 auto; }
  .pl-chips::-webkit-scrollbar { display: none; }
  .pl-chips button { flex: 0 0 auto; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 10px; border: 1px solid rgba(127,127,127,0.3); border-radius: 999px; background: transparent; color: var(--muted, #aaa); font-size: 12px; }
  .pl-chips button.active { border-color: rgba(var(--accent-rgb), 0.6); background: rgba(var(--accent-rgb), 0.2); color: var(--text, #fff); }
  .lyrics-scroll pre { margin: 0; white-space: pre-wrap; font: inherit; line-height: 1.7; font-size: 16px; }
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