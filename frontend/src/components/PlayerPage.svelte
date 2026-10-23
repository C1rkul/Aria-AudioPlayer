<script>
  import { autohideScroll } from '../lib/autohide-scroll.js';
  import { AddLocalFiles, AddLocalFolder, OpenLocalFolderDialog, SaveTracks } from '../../wailsjs/go/main/App';
  import { tracks, currentIndex, persistTracks, addTracksDedup, moveTrack } from '../stores/player.js';
  import { forgetTrack, playlists, createPlaylist, renamePlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist, moveInPlaylist } from '../stores/playlists.js';
  import { showToast } from '../stores/toast.js';
  import { fly } from 'svelte/transition';
  import { cubicOut, cubicIn } from 'svelte/easing';
  import { onDestroy } from 'svelte';
  import { playerController } from '../lib/player-controller.js';

  export let streamBase = '';

  // tab: 'local' (Все песни) | 'external' | 'pl:<id>' (плейлист)
  import { pendingPlayerTab } from '../stores/ui.js';
  let tab = 'local';
  // открыть вкладку, которую запросила другая страница (например, «Плейлисты»)
  { const want = $pendingPlayerTab; if (want) { tab = want; pendingPlayerTab.set(null); } }
  let dir = 1;
  $: tabOrder = ['local', 'external', ...$playlists.map((p) => 'pl:' + p.id)];
  function setTab(t) {
    if (t === tab) return;
    const a = tabOrder.indexOf(tab), b = tabOrder.indexOf(t);
    dir = b >= a ? 1 : -1;
    closeMenu();
    searchQuery = '';
    tab = t;
  }
  $: activePl = tab.startsWith('pl:') ? $playlists.find((p) => 'pl:' + p.id === tab) || null : null;
  // плейлист удалили (или его нет) — возвращаемся в «Все песни»
  function checkTab() { if (tab.startsWith('pl:') && !$playlists.some((p) => 'pl:' + p.id === tab)) { dir = -1; tab = 'local'; } }
  $: $playlists, checkTab();

  let editingName = false;
  let confirmDelete = false;
  let confirmTimer;

  function newPlaylist(withTrackId) {
    const pl = createPlaylist('');
    if (withTrackId) addToPlaylist(pl.id, [withTrackId]);
    setTab('pl:' + pl.id);
    editingName = true;
    return pl;
  }
  function commitName(e) {
    const v = e.currentTarget.value;
    if (activePl) renamePlaylist(activePl.id, v);
    editingName = false;
  }
  function focusSelect(node) { node.focus(); node.select(); }
  function askDelete() {
    if (!confirmDelete) {
      confirmDelete = true;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirmDelete = false), 3000);
      return;
    }
    confirmDelete = false;
    const id = activePl.id;
    dir = -1;
    tab = 'local';
    deletePlaylist(id);
  }

  // --- меню трека («⋯») ---
  let menu = null; // { id, x, y }
  function openMenu(e, track) {
    const r = e.currentTarget.getBoundingClientRect();
    const w = 240, h = 120 + $playlists.length * 34;
    menu = { id: track.id, x: Math.min(r.right - w, window.innerWidth - w - 8), y: Math.min(r.bottom + 4, window.innerHeight - h - 8) };
  }
  function closeMenu() { menu = null; }
  function menuPlayNext() { playerController.playNext(menu.id); showToast('Будет играть следом'); closeMenu(); }
  function menuAddQueue() { playerController.addToQueue(menu.id); showToast('Добавлено в очередь'); closeMenu(); }
  function menuToPlaylist(pl) {
    const n = addToPlaylist(pl.id, [menu.id]);
    showToast(n ? `Добавлено в «${pl.name}»` : `Уже в «${pl.name}»`);
    closeMenu();
  }
  function menuNewPlaylist() { const id = menu.id; closeMenu(); newPlaylist(id); }
  const onWinKey = (e) => { if (e.key === 'Escape') closeMenu(); };
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
  $: baseTracks = activePl
    ? activePl.trackIds.map((id) => $tracks.find((t) => t.id === id)).filter(Boolean)
    : $tracks;
  $: filteredTracks = baseTracks.filter(track => {
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.toLowerCase();
    const title = (track.title || '').toLowerCase();
    const artist = (track.artist || '').toLowerCase();
    const album = (track.album || '').toLowerCase();
    
    return title.includes(query) || artist.includes(query) || album.includes(query);
  });

  function reportAdded(found) {
    const added = addTracksDedup(found || []);
    if (added > 0) showToast(`Добавлено треков: ${added}`);
    else if ((found || []).length > 0) showToast('Эти треки уже есть в списке');
  }

  async function addLocalFiles() {
    try { reportAdded(await AddLocalFiles()); } catch (err) { console.error(err); }
  }

  async function addLocalFolder() {
    if (isScanning) return;
    try {
      isScanning = true;
      const folderPath = await OpenLocalFolderDialog();
      if (!folderPath) return;
      reportAdded(await AddLocalFolder(folderPath));
    } catch (err) {
      console.error('Ошибка при добавлении папки:', err);
    } finally {
      isScanning = false;
    }
  }

  // --- Перетаскивание треков для смены порядка (pointer events) ---
  let listEl;
  let drag = null;       // { from, to, dy, h, startY, startScroll, lastY, active }
  let noAnim = false;
  let suppressClick = false;
  let scrollTimer = null;

  function dragUpdate() {
    if (!drag) return;
    const dy = drag.lastY - drag.startY + (listEl.scrollTop - drag.startScroll);
    if (!drag.active && Math.abs(dy) < 6) return;
    drag.active = true;
    drag.dy = dy;
    const to = Math.round(drag.from + dy / drag.h);
    drag.to = Math.max(0, Math.min(filteredTracks.length - 1, to));
    drag = drag;
  }
  function onRowDown(e, index) {
    // список берём из DOM: bind:this обнуляется, когда уезжает старая вкладка
    listEl = e.currentTarget.closest('.track-list');
    if (searchQuery.trim() || e.button !== 0 || e.target.closest('.remove-btn, .more-btn') || !listEl) return;
    drag = { from: index, to: index, dy: 0, h: e.currentTarget.offsetHeight + 8,
      startY: e.clientY, startScroll: listEl.scrollTop, lastY: e.clientY, active: false };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragCancel);
    scrollTimer = setInterval(() => {
      if (!drag || !drag.active) return;
      const r = listEl.getBoundingClientRect();
      if (drag.lastY < r.top + 40) listEl.scrollTop -= 10;
      else if (drag.lastY > r.bottom - 40) listEl.scrollTop += 10;
      dragUpdate();
    }, 16);
  }
  function onDragMove(e) { if (drag) { drag.lastY = e.clientY; dragUpdate(); } }
  function stopDragListeners() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragCancel);
    clearInterval(scrollTimer);
  }
  function finishDrag(commit) {
    stopDragListeners();
    const d = drag;
    drag = null;
    if (!d || !d.active) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    noAnim = true;
    if (commit && d.to !== d.from) {
      if (activePl) moveInPlaylist(activePl.id, d.from, d.to);
      else moveTrack(d.from, d.to);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => (noAnim = false)));
  }
  function onDragEnd() { finishDrag(true); }
  function onDragCancel() { finishDrag(false); }
  onDestroy(stopDragListeners);

  function rowStyle(index, d) {
    if (!d || !d.active) return '';
    if (index === d.from) return `transform:translateY(${d.dy}px);z-index:5;transition:none;box-shadow:0 10px 28px rgba(0,0,0,.35);`;
    if (d.from < d.to && index > d.from && index <= d.to) return `transform:translateY(${-d.h}px);`;
    if (d.from > d.to && index < d.from && index >= d.to) return `transform:translateY(${d.h}px);`;
    return '';
  }

  function playTrack(originalIndex) {
    if (suppressClick) return;
    const trackToPlay = filteredTracks[originalIndex];
    if (!trackToPlay) return;
    const realIndex = $tracks.findIndex(t => t.id === trackToPlay.id);
    if (realIndex === -1) return;
    if (realIndex === $currentIndex) { playerController.togglePlay(); return; }
    // очередью становится то, что видно в списке: вся библиотека или результат поиска
    const searching = !!searchQuery.trim();
    playerController.playFrom(searching ? 'search' : (activePl ? activePl.id : 'all'), filteredTracks.map(t => t.id), trackToPlay.id);
  }

  function removeTrack(filteredIndex) {
    const trackToRemove = filteredTracks[filteredIndex];
    if (!trackToRemove) return;
    if (activePl) { removeFromPlaylist(activePl.id, trackToRemove.id); return; }

    const realIndex = $tracks.findIndex(t => t.id === trackToRemove.id);
    if (realIndex === -1) return;

    forgetTrack(trackToRemove.id);
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
    <button class:active={tab === 'local'} on:click={() => setTab('local')}>Все песни</button>
    <button class:active={tab === 'external'} on:click={() => setTab('external')}>Внешние</button>
    {#each $playlists as pl (pl.id)}
      <button class="pl-tab" class:active={tab === 'pl:' + pl.id} on:click={() => setTab('pl:' + pl.id)} title={pl.name}>♫ {pl.name}</button>
    {/each}
    <button class="add-tab" on:click={() => newPlaylist()} title="Новый плейлист">+</button>
  </div>

  <div class="tab-stage">
  {#key tab}
  <div class="tab-pane"
    in:fly={{ x: dir * 70, duration: 340, delay: 120, easing: cubicOut, opacity: 0 }}
    out:fly={{ x: -dir * 70, duration: 180, easing: cubicIn, opacity: 0 }}>
  {#if tab !== 'external'}
    <section class="panel">
      <div class="toolbar">
        {#if activePl}
          {#if editingName}
            <input class="pl-name-input" value={activePl.name} maxlength="60" use:focusSelect
              on:blur={commitName} on:keydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = activePl.name; e.currentTarget.blur(); } }} />
          {:else}
            <button class="pl-title" on:click={() => (editingName = true)} title="Переименовать">{activePl.name} <span class="pl-count">· {activePl.trackIds.length}</span> ✎</button>
          {/if}
          <button class="danger" class:armed={confirmDelete} on:click={askDelete}>{confirmDelete ? 'Точно удалить?' : 'Удалить плейлист'}</button>
        {:else}
          <button on:click={addLocalFiles} disabled={isScanning}>Добавить файлы</button>
          <button on:click={addLocalFolder} disabled={isScanning}>
            {isScanning ? 'Сканирование...' : 'Добавить папку'}
          </button>
        {/if}
        
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

      {#if activePl && activePl.trackIds.length === 0}
        <div class="empty">Плейлист пуст. Добавляйте треки через «⋯» в разделе «Все песни».</div>
      {:else if $tracks.length === 0}
        <div class="empty">
          Локальные треки появятся здесь
        </div>
      {:else if filteredTracks.length === 0 && searchQuery}
         <div class="empty">
           Ничего не найдено по запросу "<strong>{searchQuery}</strong>"
         </div>
      {:else}
        <div class="track-list" class:noanim={noAnim} class:reorderable={!searchQuery.trim()} use:autohideScroll>
          {#each filteredTracks as track, index (track.id)}
            <div
              class="track-item"
              class:dragging={drag && drag.active && drag.from === index}
              style={rowStyle(index, drag)}
              on:pointerdown={(e) => onRowDown(e, index)}
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
              <button class="more-btn" on:click|stopPropagation={(e) => openMenu(e, track)} title="Ещё">⋯</button>
              <button
                class="remove-btn"
                on:click|stopPropagation={() => removeTrack(index)}
                title={activePl ? 'Убрать из плейлиста' : 'Удалить трек'}
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
  {/key}
  </div>
</div>

<svelte:window on:keydown={onWinKey} on:resize={closeMenu} />

{#if menu}
  <div class="menu-backdrop" on:click={closeMenu} on:contextmenu|preventDefault={closeMenu} role="presentation"></div>
  <div class="track-menu" style="left:{menu.x}px;top:{menu.y}px" transition:fly={{ y: -6, duration: 140 }}>
    <button on:click={menuPlayNext}>Играть следом</button>
    <button on:click={menuAddQueue}>Добавить в очередь</button>
    <div class="menu-sep"></div>
    {#each $playlists as pl (pl.id)}
      <button on:click={() => menuToPlaylist(pl)}>
        <span class="menu-pl">♫ {pl.name}</span>{#if pl.trackIds.includes(menu.id)}<span class="menu-check">✓</span>{/if}
      </button>
    {/each}
    <button on:click={menuNewPlaylist}>+ Новый плейлист</button>
  </div>
{/if}

<style>
  /* ... предыдущие стили ... */
  .player-page { height: 100%; display: flex; flex-direction: column; gap: 16px; }
  .tabs { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button { flex: 0 0 auto; }
  .tabs .pl-tab { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tabs .add-tab { width: 38px; padding: 9px 0; text-align: center; font-weight: 700; }
  .pl-title { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
  .pl-count { color: var(--muted); font-weight: 400; }
  .pl-name-input { padding: 10px 12px; border: 1px solid rgba(var(--accent-rgb), 0.5); border-radius: 12px; background: var(--input-bg, var(--item-bg)); color: var(--text); outline: none; min-width: 220px; }
  .toolbar .danger { color: var(--muted); }
  .toolbar .danger:hover:not(:disabled), .toolbar .danger.armed { border-color: #ff4d4f; color: #ff4d4f; }
  .more-btn { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-size: 18px; line-height: 1; display: flex; align-items: center; justify-content: center; opacity: 0; transition: 0.15s ease; }
  .track-item:hover .more-btn, .more-btn:focus-visible { opacity: 1; }
  .more-btn:hover { background: rgba(var(--accent-rgb), 0.25); color: var(--text); }
  .menu-backdrop { position: fixed; inset: 0; z-index: 1500; }
  .track-menu { position: fixed; z-index: 1501; width: 240px; padding: 6px; border-radius: 14px; background: var(--panel-bg, #1b1b21); border: 1px solid rgba(var(--accent-rgb), 0.3); box-shadow: 0 14px 38px rgba(0,0,0,0.4); -webkit-backdrop-filter: blur(var(--blur)); backdrop-filter: blur(var(--blur)); display: flex; flex-direction: column; max-height: 60vh; overflow: auto; }
  .track-menu button { display: flex; justify-content: space-between; gap: 8px; text-align: left; padding: 8px 10px; border: 0; border-radius: 9px; background: transparent; color: var(--text); font-size: 13px; }
  .track-menu button:hover { background: rgba(var(--accent-rgb), 0.18); }
  .menu-pl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu-check { color: var(--accent); }
  .menu-sep { height: 1px; margin: 4px 6px; background: var(--border); }
  .tabs button { padding: 9px 14px; border: 1px solid transparent; border-radius: 999px; background: var(--chip-bg); color: var(--muted); transition: 0.15s ease; }
  .tabs button:hover { color: var(--text); border-color: rgba(var(--accent-rgb), 0.22); background: linear-gradient(rgba(var(--accent-rgb), 0.08), rgba(var(--accent-rgb), 0.08)), var(--chip-bg); }
  .tabs button.active { background: linear-gradient(rgba(var(--accent-rgb), 0.18), rgba(var(--accent-rgb), 0.18)), var(--chip-bg); border-color: rgba(var(--accent-rgb), 0.34); color: var(--text); }
  .tab-stage { flex: 1; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr); grid-template-columns: minmax(0, 1fr); overflow-x: clip; }
  .tab-pane { grid-area: 1 / 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
  .track-list.noanim .track-item { transition: none; }
  .track-item { position: relative; touch-action: pan-y; }
  .track-item.dragging { cursor: grabbing; }
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
  .track-item { padding: 10px 12px; border-radius: 14px; background: var(--item-bg); border: 1px solid var(--item-border); transition: 0.15s ease; display: grid; grid-template-columns: 28px 44px 1fr auto 28px 28px; align-items: center; gap: 12px; color: var(--text); }
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