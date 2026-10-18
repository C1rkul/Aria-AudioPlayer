<script>
  import { autohideScroll } from '../lib/autohide-scroll.js';
  import { AddLocalFiles, AddLocalFolder, OpenLocalFolderDialog, SaveTracks } from '../../wailsjs/go/main/App';
  import { tracks, currentIndex, persistTracks } from '../stores/player.js';
  import { playerController } from '../lib/player-controller.js';

  export let streamBase = '';

  let tab = 'local';
  let isScanning = false;
  
  // STATE FOR SEARCH
  let searchQuery = ''; 

  function coverUrl(path) {
    if (!path || !streamBase) return '';
    return `${streamBase}/cover?path=${encodeURIComponent(path)}`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function subtitleFor(track) {
    const parts = [];
    if (track.artist) parts.push(track.artist);
    if (track.album) parts.push(track.album);
    if (parts.length > 0) return parts.join(' — ');
    return track.path;
  }

  // FILTERED TRACKS LOGIC
  $: filteredTracks = $tracks.filter(track => {
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.toLowerCase();
    const title = (track.title || '').toLowerCase();
    const artist = (track.artist || '').toLowerCase();
    const album = (track.album || '').toLowerCase();
    
    return title.includes(query) || artist.includes(query) || album.includes(query);
  });

  async function addLocalFiles() {
    try {
      const newTracks = await AddLocalFiles();
      if (newTracks && newTracks.length > 0) {
        const updated = [...$tracks, ...newTracks];
        tracks.set(updated);
        persistTracks(updated);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function addLocalFolder() {
    if (isScanning) return;
    try {
      isScanning = true;
      const folderPath = await OpenLocalFolderDialog();
      if (!folderPath) { isScanning = false; return; }

      const newTracks = await AddLocalFolder(folderPath);
      if (newTracks && newTracks.length > 0) {
        const updated = [...$tracks, ...newTracks];
        tracks.set(updated);
        persistTracks(updated);
      }
    } catch (err) {
      console.error('Ошибка при добавлении папки:', err);
    } finally {
      isScanning = false;
    }
  }

  function playTrack(originalIndex) {
    // ВАЖНО: Мы играем трек из исходного массива $tracks, 
    // но индекс берем из отфильтрованного view, если он совпадает.
    // Однако проще всего: найти ID трека в оригинальном массиве и установить currentIndex.
    
    // Так как мы рендерим filteredTracks, нам нужно знать, какой это трек в оригинальном списке.
    // Но текущая реализация использует index из each loop.
    // Чтобы избежать путаницы с индексами при фильтрации, давайте менять playTrack:
    
    const trackToPlay = filteredTracks[originalIndex];
    if (!trackToPlay) return;
    
    const realIndex = $tracks.findIndex(t => t.id === trackToPlay.id);
    if (realIndex === -1) return;
    if (realIndex === $currentIndex) playerController.togglePlay();
    else currentIndex.set(realIndex);
  }

  function removeTrack(filteredIndex) {
    const trackToRemove = filteredTracks[filteredIndex];
    if (!trackToRemove) return;

    const realIndex = $tracks.findIndex(t => t.id === trackToRemove.id);
    if (realIndex === -1) return;

    const updated = $tracks.filter((_, i) => i !== realIndex);
    
    let ci = $currentIndex;
    if (realIndex === ci) ci = -1;
    else if (realIndex < ci) ci -= 1;

    tracks.set(updated);
    currentIndex.set(ci);
    persistTracks(updated);
  }
</script>

<div class="player-page">
  <div class="tabs">
    <button class:active={tab === 'local'} on:click={() => (tab = 'local')}>
      Локальные
    </button>
    <button class:active={tab === 'external'} on:click={() => (tab = 'external')}>
      Внешние
    </button>
  </div>

  {#if tab === 'local'}
    <section class="panel">
      <div class="toolbar">
        <button on:click={addLocalFiles} disabled={isScanning}>Добавить файлы</button>
        <button on:click={addLocalFolder} disabled={isScanning}>
          {isScanning ? 'Сканирование...' : 'Добавить папку'}
        </button>
        
        <!-- SEARCH INPUT -->
        <div class="search-box">
          <input 
            type="text" 
            placeholder="Поиск по названию, артисту..." 
            bind:value={searchQuery}
          />
          {#if searchQuery}
             <button class="clear-search" on:click={() => searchQuery = ''}>✕</button>
          {/if}
        </div>
      </div>

      {#if $tracks.length === 0}
        <div class="empty">
          Локальные треки появятся здесь
        </div>
      {:else if filteredTracks.length === 0 && searchQuery}
         <div class="empty">
           Ничего не найдено по запросу "<strong>{searchQuery}</strong>"
         </div>
      {:else}
        <div class="track-list" use:autohideScroll>
          {#each filteredTracks as track, index (track.id)}
            <div
              class="track-item"
              class:active={$currentIndex !== -1 && $tracks[$currentIndex]?.id === track.id}
              on:click={() => playTrack(index)}
              on:keypress={(e) => e.key === 'Enter' && playTrack(index)}
              role="button"
              tabindex="0"
            >
              <div class="track-number">{index + 1}</div>
              <div class="track-cover">
                {#if track.coverPath && streamBase}
                  <img src={coverUrl(track.coverPath)} alt="" />
                {:else}
                  🎵
                {/if}
              </div>
              <div class="track-main">
                <div class="track-title">{track.title}</div>
                <div class="track-subtitle">{subtitleFor(track)}</div>
              </div>
              <div class="track-duration">
                {formatDuration(track.duration)}
              </div>
              <button
                class="remove-btn"
                on:click|stopPropagation={() => removeTrack(index)}
                title="Удалить трек"
              >
                ✕
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    <section class="coming-soon">
      <h1>COMING SOON</h1>
      <p>Внешние источники скоро появятся</p>
    </section>
  {/if}
</div>

<style>
  /* ... предыдущие стили ... */
  .player-page { height: 100%; display: flex; flex-direction: column; gap: 16px; }
  .tabs { display: flex; gap: 8px; }
  .tabs button { padding: 9px 14px; border: 1px solid transparent; border-radius: 999px; background: var(--chip-bg); color: var(--muted); transition: 0.15s ease; }
  .tabs button:hover { color: var(--text); border-color: rgba(var(--accent-rgb), 0.22); background: linear-gradient(rgba(var(--accent-rgb), 0.08), rgba(var(--accent-rgb), 0.08)), var(--chip-bg); }
  .tabs button.active { background: linear-gradient(rgba(var(--accent-rgb), 0.18), rgba(var(--accent-rgb), 0.18)), var(--chip-bg); border-color: rgba(var(--accent-rgb), 0.34); color: var(--text); }
  .panel { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; }
  
  /* TOOLBAR WITH SEARCH */
  .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .toolbar button { padding: 10px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--button-bg); color: var(--text); transition: 0.15s ease; }
  .toolbar button:hover:not(:disabled) { border-color: rgba(var(--accent-rgb), 0.35); background: linear-gradient(rgba(var(--accent-rgb), 0.12), rgba(var(--accent-rgb), 0.12)), var(--button-bg); }
  .toolbar button:disabled { opacity: 0.5; cursor: not-allowed; }
  
  .search-box { position: relative; flex-grow: 1; min-width: 200px; max-width: 400px; }
  .search-box input { 
    width: 100%; 
    padding: 10px 30px 10px 12px; 
    border: 1px solid var(--border); 
    border-radius: 12px; 
    background: var(--input-bg, var(--item-bg)); 
    color: var(--text); 
    outline: none;
    box-sizing: border-box;
  }
  .search-box input:focus { border-color: rgba(var(--accent-rgb), 0.4); }
  .clear-search {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px;
    font-size: 14px;
  }
  .clear-search:hover { color: var(--text); }

  .empty { padding: 34px; border: 1px dashed var(--border); border-radius: 18px; color: var(--muted); text-align: center; background: var(--item-bg); }
  .track-list { overflow: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }
  .track-item { padding: 10px 12px; border-radius: 14px; background: var(--item-bg); border: 1px solid var(--item-border); transition: 0.15s ease; display: grid; grid-template-columns: 28px 44px 1fr auto 28px; align-items: center; gap: 12px; color: var(--text); }
  .track-item:hover { background: linear-gradient(rgba(var(--accent-rgb), 0.10), rgba(var(--accent-rgb), 0.10)), var(--item-bg); border-color: rgba(var(--accent-rgb), 0.28); cursor: pointer; }
  .track-item.active { background: linear-gradient(rgba(var(--accent-rgb), 0.16), rgba(var(--accent-rgb), 0.16)), var(--item-bg); border-color: rgba(var(--accent-rgb), 0.4); }
  .track-number { color: var(--muted); font-size: 13px; text-align: center; }
  .track-item.active .track-number { color: var(--text); }
  .track-cover { width: 44px; height: 44px; border-radius: 8px; background: var(--surface-2, rgba(255,255,255,0.05)); border: 1px solid var(--item-border); display: flex; align-items: center; justify-content: center; overflow: hidden; font-size: 18px; flex-shrink: 0; }
  .track-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .track-main { min-width: 0; }
  .track-title { font-weight: 600; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
  .track-subtitle { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track-duration { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .remove-btn { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-size: 14px; display: flex; align-items: center; justify-content: center; opacity: 0; transition: 0.15s ease; flex-shrink: 0; }
  .track-item:hover .remove-btn { opacity: 1; }
  .remove-btn:hover { background: #ff4d4f; color: white; }
  .coming-soon { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 320px; border: 1px dashed var(--panel-border); border-radius: 22px; background: var(--panel-bg); backdrop-filter: blur(var(--blur)); text-align: center; color: var(--text); }
  .coming-soon h1 { margin: 0; font-size: 42px; letter-spacing: 2px; }
  .coming-soon p { margin-top: 10px; color: var(--muted); }
</style>