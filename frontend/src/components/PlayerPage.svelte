<script>
  import { fmt, tr, tt } from '../lib/i18n.js';
  import { autohideScroll } from '../lib/autohide-scroll.js';
  import NoteIcon from './NoteIcon.svelte';
  import GearIcon from './GearIcon.svelte';
  import TagInspector from './TagInspector.svelte';
  import { AddLocalFiles, AddLocalFolder, OpenLocalFolderDialog, SaveTracks, GetWatchFolders, RemoveLocalFolder } from '../../wailsjs/go/main/App';
  import { tracks, currentIndex, currentTrack, isPlaying, persistTracks, addTracksDedup, moveTrack } from '../stores/player.js';
  import { forgetTrack, playlists, createPlaylist, renamePlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist, moveInPlaylist } from '../stores/playlists.js';
  import { showToast } from '../stores/toast.js';
  import { fly } from 'svelte/transition';
  import { cubicOut, cubicIn } from 'svelte/easing';
  import { onDestroy } from 'svelte';
  import { playerController } from '../lib/player-controller.js';
  import { applyLibraryList } from '../lib/library-sync.js';

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
  function menuPlayNext() { playerController.playNext(menu.id); showToast(tr('Будет играть следом')); closeMenu(); }
  function menuAddQueue() { playerController.addToQueue(menu.id); showToast(tr('Добавлено в очередь')); closeMenu(); }
  function menuToPlaylist(pl) {
    const n = addToPlaylist(pl.id, [menu.id]);
    showToast(n ? fmt(tr('Добавлено в «{0}»'), pl.name) : fmt(tr('Уже в «{0}»'), pl.name));
    closeMenu();
  }
  function menuNewPlaylist() { const id = menu.id; closeMenu(); newPlaylist(id); }
  const onWinKey = (e) => {
    if (e.key !== 'Escape') return;
    if (removeTarget) cancelRemove();
    else if (foldersOpen) foldersOpen = false;
    else if (menu) closeMenu();
    else if (inspectorOpen) inspectorOpen = false;
    else closeMenu();
  };
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
    if (added > 0) showToast(fmt(tr('Добавлено треков: {0}'), added));
    else if ((found || []).length > 0) showToast(tr('Эти треки уже есть в списке'));
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
      refreshWatchFolders();
    } catch (err) {
      console.error(tr('Ошибка при добавлении папки:'), err);
    } finally {
      isScanning = false;
    }
  }

  // --- Папки библиотеки (шестерёнка рядом с «Добавить папку») ---
  let foldersOpen = false;
  let watchFolders = [];
  let removeTarget = null;
  let removeCount = 0;
  let removeTimer;

  async function refreshWatchFolders() {
    try { watchFolders = (await GetWatchFolders()) || []; } catch (e) { console.error(e); }
  }
  function toggleFolders() {
    foldersOpen = !foldersOpen;
    if (foldersOpen) refreshWatchFolders();
  }
  function cancelRemove() { removeTarget = null; clearTimeout(removeTimer); }
  function folderBase(p) {
    const parts = String(p).split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }
  function underPath(p, root) {
    const norm = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '');
    const P = norm(p), R = norm(root);
    return P === R || P.startsWith(R + '/');
  }
  function countTracksIn(root) {
    let n = 0;
    for (const t of $tracks) if (t.path && underPath(t.path, root)) n++;
    return n;
  }
  function askRemoveFolder(f) {
    removeTarget = f;
    removeCount = countTracksIn(f);
    // уведомление сверху: что именно будет удалено
    showToast(fmt(tr('Папка «{0}»: будут удалены все её треки ({1})'), folderBase(f), removeCount), 4000);
    clearTimeout(removeTimer);
    removeTimer = setTimeout(() => (removeTarget = null), 6000);
  }
  async function confirmRemoveFolder() {
    const f = removeTarget;
    cancelRemove();
    if (!f) return;
    const before = $tracks.length;
    try {
      const list = await RemoveLocalFolder(f, $tracks);
      applyLibraryList(Array.isArray(list) ? list : []);
      await refreshWatchFolders();
      showToast(fmt(tr('Папка удалена, треков убрано: {0}'), Math.max(0, before - (list || []).length)), 3000);
    } catch (err) {
      console.error(tr('Не удалось удалить папку:'), err);
      showToast(tr('Не удалось удалить папку'));
    }
  }
  // клик мимо шестерёнки — закрыть список папок
  const onWinClick = (e) => {
    if (foldersOpen && e.target && e.target.closest && !e.target.closest('.folders-wrap')) foldersOpen = false;
  };

  // --- Выделение треков для тегера ---
  let selection = [];     // id выделенных (в порядке выделения)
  let selAnchor = null;   // индекс в filteredTracks для Shift-диапазона
  let inspectorOpen = false;
  $: selectedTracks = selection.map((id) => $tracks.find((t) => t.id === id)).filter(Boolean);
  $: blockedPath = $isPlaying && $currentTrack ? $currentTrack.path : '';

  function rowClick(e, index) {
    if (suppressClick) return;
    const track = filteredTracks[index];
    if (!track) return;
    if (e.ctrlKey || e.metaKey) {
      const i = selection.indexOf(track.id);
      if (i >= 0) selection = selection.filter((x) => x !== track.id);
      else selection = [...selection, track.id];
      selAnchor = index;
      inspectorOpen = true;
      return;
    }
    if (e.shiftKey) {
      if (selAnchor == null) { selection = [track.id]; selAnchor = index; return; }
      const a = Math.min(selAnchor, index), b = Math.max(selAnchor, index);
      selection = filteredTracks.slice(a, b + 1).map((t) => t.id);
      inspectorOpen = true;
      return;
    }
    selection = [];
    selAnchor = index;
    playTrack(index);
  }
  function selectAllVisible() { selection = filteredTracks.map((t) => t.id); selAnchor = filteredTracks.length - 1; }
  function clearSelection() { selection = []; selAnchor = null; }
  function pickTracks(ids) {
    selection = ids.filter((id) => $tracks.some((t) => t.id === id));
    selAnchor = null;
    inspectorOpen = true;
  }
  function menuEditTags() {
    selection = [menu.id];
    selAnchor = filteredTracks.findIndex((t) => t.id === menu.id);
    inspectorOpen = true;
    closeMenu();
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
    <button class:active={tab === 'local'} on:click={() => setTab('local')}>{tt('Все песни')}</button>
    <button class:active={tab === 'external'} on:click={() => setTab('external')}>{tt('Внешние')}</button>
    {#each $playlists as pl (pl.id)}
      <button class="pl-tab" class:active={tab === 'pl:' + pl.id} on:click={() => setTab('pl:' + pl.id)} title={pl.name}>♫ {pl.name}</button>
    {/each}
    <button class="add-tab" on:click={() => newPlaylist()} title="{tt('Новый плейлист')}">+</button>
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
            <button class="pl-title" on:click={() => (editingName = true)} title="{tt('Переименовать')}">{activePl.name} <span class="pl-count">· {activePl.trackIds.length}</span> ✎</button>
          {/if}
          <button class="danger" class:armed={confirmDelete} on:click={askDelete}>{confirmDelete ? tt('Точно удалить?') : tt('Удалить плейлист')}</button>
        {:else}
          <button on:click={addLocalFiles} disabled={isScanning}>{tt('Добавить файлы')}</button>
          <button on:click={addLocalFolder} disabled={isScanning}>
            {isScanning ? tt('Сканирование...') : tt('Добавить папку')}
          </button>
          <button class="tags-btn" class:has-sel={selection.length > 0} on:click={() => (inspectorOpen = true)} title="{tt('Теги')}">
            {tt('Теги')}{#if selection.length > 0}<span class="tags-count">{selection.length}</span>{/if}
          </button>
          <div class="folders-wrap">
            <button class="folders-btn" class:open={foldersOpen} on:click={toggleFolders}
                    title="{tt('Папки библиотеки')}" aria-label="{tt('Папки библиотеки')}">
              <GearIcon size={16} />
            </button>
            {#if foldersOpen}
              <div class="folders-pop" role="dialog" aria-label="{tt('Папки библиотеки')}">
                <div class="folders-pop-head">{tt('Папки библиотеки')}</div>
                {#if watchFolders.length === 0}
                  <div class="folders-empty">{tt('Нет подключённых папок — добавьте через «Добавить папку»')}</div>
                {:else}
                  {#each watchFolders as f (f)}
                    <div class="folders-row">
                      <span class="folders-name" title={f}>
                        <b>{folderBase(f)}</b><small>{f}</small>
                      </span>
                      <button class="folders-del" title="{tt('Удалить папку и её треки')}"
                              on:click={() => askRemoveFolder(f)} aria-label="{tt('Удалить папку и её треки')}">
                        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                          <path d="M3.5 3.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                        </svg>
                      </button>
                    </div>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
        {/if}
        
        <!-- SEARCH INPUT -->
        <div class="search-box">
          <input 
            type="text" 
            placeholder="{tt('Поиск по названию, артисту...')}" 
            bind:value={searchQuery}
          />
          {#if searchQuery}
             <button class="clear-search" on:click={() => searchQuery = ''}>✕</button>
          {/if}
        </div>
      </div>

      {#if activePl && activePl.trackIds.length === 0}
        <div class="empty">{tt('Плейлист пуст. Добавляйте треки через «⋯» в разделе «Все песни».')}</div>
      {:else if $tracks.length === 0}
        <div class="empty"
          >{tt('Локальные треки появятся здесь')}
        </div>
      {:else if filteredTracks.length === 0 && searchQuery}
         <div class="empty">
           {tt('Ничего не найдено по запросу')} "<strong>{searchQuery}</strong>"
         </div>
      {:else}
        {#if inspectorOpen}
          <TagInspector
            {selectedTracks}
            allTracks={$tracks}
            {blockedPath}
            on:close={() => (inspectorOpen = false)}
            on:apply={(e) => applyLibraryList(e.detail)}
            on:pick={(e) => pickTracks(e.detail)}
            on:selectAll={selectAllVisible}
          />
        {/if}
        <div class="track-list" class:noanim={noAnim} class:reorderable={!searchQuery.trim()} use:autohideScroll>
          {#each filteredTracks as track, index (track.id)}
            <div
              class="track-item"
              class:dragging={drag && drag.active && drag.from === index}
              style={rowStyle(index, drag)}
              on:pointerdown={(e) => onRowDown(e, index)}
              class:active={$currentIndex !== -1 && $tracks[$currentIndex]?.id === track.id}
              class:selected={selection.includes(track.id)}
              on:click={(e) => rowClick(e, index)}
              on:keypress={(e) => e.key === 'Enter' && playTrack(index)}
              role="button"
              tabindex="0"
            >
              <div class="track-number">{index + 1}</div>
              <div class="track-cover">
                {#if track.coverPath && streamBase}
                  <img src={coverUrl(track.coverPath)} alt="" />
                {:else}
                  <NoteIcon />
                {/if}
              </div>
              <div class="track-main">
                <div class="track-title">{track.title}</div>
                <div class="track-subtitle">{subtitleFor(track)}</div>
              </div>
              <div class="track-duration">
                {formatDuration(track.duration)}
              </div>
              <button class="more-btn" on:click|stopPropagation={(e) => openMenu(e, track)} title="{tt('Ещё')}">⋯</button>
              <button
                class="remove-btn"
                on:click|stopPropagation={() => removeTrack(index)}
                title={activePl ? tt('Убрать из плейлиста') : tt('Удалить трек')}
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
      <p>{tt('Внешние источники скоро появятся')}</p>
    </section>
  {/if}
  </div>
  {/key}
  </div>
</div>

<svelte:window on:keydown={onWinKey} on:resize={closeMenu} on:click={onWinClick} />

{#if menu}
  <div class="menu-backdrop" on:click={closeMenu} on:contextmenu|preventDefault={closeMenu} role="presentation"></div>

  <div class="track-menu" style="left:{menu.x}px;top:{menu.y}px" transition:fly={{ y: -6, duration: 140 }}>
    <button on:click={menuPlayNext}>{tt('Играть следом')}</button>
    <button on:click={menuAddQueue}>{tt('Добавить в очередь')}</button>
    <button on:click={menuEditTags}>{tt('Редактировать теги')}</button>
    <div class="menu-sep"></div>
    {#each $playlists as pl (pl.id)}
      <button on:click={() => menuToPlaylist(pl)}>
        <span class="menu-pl">♫ {pl.name}</span>{#if pl.trackIds.includes(menu.id)}<span class="menu-check">✓</span>{/if}
      </button>
    {/each}
    <button on:click={menuNewPlaylist}>{tt('+ Новый плейлист')}</button>
  </div>
{/if}

{#if removeTarget}
  <div class="fconfirm-back" on:click={cancelRemove} on:contextmenu|preventDefault={cancelRemove} role="presentation">
    <div class="fconfirm" on:click|stopPropagation role="dialog" aria-modal="true" aria-label="{tt('Удалить папку?')}">
      <h4>{tt('Удалить папку?')}</h4>
      <p>{fmt(tt('«{0}» будет убрана из библиотеки вместе со всеми её треками: {1} шт.'), folderBase(removeTarget), removeCount)}</p>
      <div class="fconfirm-actions">
        <button on:click={cancelRemove}>{tt('Отмена')}</button>
        <button class="danger" on:click={confirmRemoveFolder}>{tt('Удалить папку')}</button>
      </div>
    </div>
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
  .track-menu { position: fixed; z-index: 1501; width: 240px; padding: 6px; border-radius: 14px; background: var(--menu-bg, #1b1b21); border: 1px solid rgba(var(--accent-rgb), 0.3); box-shadow: 0 14px 38px rgba(0,0,0,0.4); display: flex; flex-direction: column; max-height: 60vh; overflow: auto; }
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
  .panel { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; }
  
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
  /* --- Папки библиотеки --- */
  .tags-btn { display: inline-flex; align-items: center; gap: 6px; }
  .tags-btn.has-sel { border-color: rgba(var(--accent-rgb), 0.55) !important; background: linear-gradient(rgba(var(--accent-rgb), 0.18), rgba(var(--accent-rgb), 0.18)), var(--button-bg) !important; }
  .tags-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: rgba(var(--accent-rgb), 0.45); color: #fff; font-size: 11px; font-weight: 700; }
  .track-item.selected { border-color: rgba(var(--accent-rgb), 0.65); background: rgba(var(--accent-rgb), 0.14); }
  .folders-wrap { position: relative; display: inline-flex; }
  .folders-wrap .folders-btn { display: inline-flex; align-items: center; justify-content: center; padding: 9px; border: 1px solid var(--border); border-radius: 12px; background: var(--button-bg); color: var(--text); cursor: pointer; transition: 0.15s ease; }
  .folders-wrap .folders-btn:hover, .folders-wrap .folders-btn.open { border-color: rgba(var(--accent-rgb), 0.35); background: linear-gradient(rgba(var(--accent-rgb), 0.12), rgba(var(--accent-rgb), 0.12)), var(--button-bg); }
  .folders-pop { position: absolute; top: calc(100% + 8px); left: 0; z-index: 1200; min-width: 300px; max-width: min(420px, 80vw); padding: 8px; border: 1px solid var(--border); border-radius: 14px; background: var(--menu-bg, #1b1b21); box-shadow: 0 14px 40px rgba(0, 0, 0, 0.4); }
  .folders-pop-head { font-size: 11px; font-weight: 600; color: var(--muted, #aaa); padding: 4px 8px 8px; text-transform: uppercase; letter-spacing: 0.05em; }
  .folders-empty { font-size: 13px; color: var(--muted, #aaa); padding: 8px; line-height: 1.5; }
  .folders-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 10px; }
  .folders-row:hover { background: rgba(127, 127, 127, 0.1); }
  .folders-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .folders-name b { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .folders-name small { font-size: 11px; color: var(--muted, #aaa); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
  .folders-wrap .folders-del { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--muted, #aaa); cursor: pointer; transition: 0.15s ease; }
  .folders-wrap .folders-del:hover { border-color: rgba(230, 57, 70, 0.5); color: #e63946; background: rgba(230, 57, 70, 0.12); }
  .fconfirm-back { position: fixed; inset: 0; z-index: 3500; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
  .fconfirm { width: min(430px, calc(100vw - 40px)); padding: 20px; border: 1px solid var(--border); border-radius: 16px; background: var(--menu-bg, #1b1b21); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5); }
  .fconfirm h4 { margin: 0 0 10px; font-size: 16px; }
  .fconfirm p { margin: 0 0 18px; font-size: 14px; line-height: 1.5; color: var(--muted, #ccc); }
  .fconfirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
  .fconfirm-actions button { padding: 8px 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--button-bg); color: var(--text); cursor: pointer; transition: 0.15s ease; }
  .fconfirm-actions button:hover { border-color: rgba(var(--accent-rgb), 0.4); }
  .fconfirm-actions button.danger { border-color: rgba(230, 57, 70, 0.55); background: rgba(230, 57, 70, 0.16); color: #ff7b88; }
  .fconfirm-actions button.danger:hover { background: rgba(230, 57, 70, 0.3); }
</style>