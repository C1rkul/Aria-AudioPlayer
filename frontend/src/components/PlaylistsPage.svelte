<script>
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { tracks } from '../stores/player.js';
  import { playlists, createPlaylist, renamePlaylist, deletePlaylist } from '../stores/playlists.js';
  import { pendingPlayerTab } from '../stores/ui.js';
  import { playerController } from '../lib/player-controller.js';

  export let streamBase = '';
  const dispatch = createEventDispatcher();

  let editingId = null;
  let armedId = null;
  let armTimer;
  onDestroy(() => clearTimeout(armTimer));

  $: byId = new Map($tracks.map((t) => [t.id, t]));
  $: cards = $playlists.map((pl) => {
    const list = pl.trackIds.map((id) => byId.get(id)).filter(Boolean);
    const seconds = list.reduce((sum, t) => sum + (t.duration > 0 ? t.duration : 0), 0);
    return { pl, list, covers: list.filter((t) => t.coverPath).slice(0, 4), seconds };
  });

  function coverUrl(path) {
    return streamBase && path ? `${streamBase}/cover?path=${encodeURIComponent(path)}` : '';
  }
  function fmtTotal(sec) {
    if (!sec) return '';
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${Math.max(1, m)} мин`;
  }
  function plural(n) {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return 'трек';
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'трека';
    return 'треков';
  }

  function open(id) {
    pendingPlayerTab.set('pl:' + id);
    dispatch('open');
  }
  function play(card) {
    if (!card.list.length) return;
    playerController.playFrom(card.pl.id, card.list.map((t) => t.id), card.list[0].id);
  }
  function create() {
    const pl = createPlaylist('');
    editingId = pl.id;
  }
  function commit(e, id) {
    renamePlaylist(id, e.currentTarget.value);
    editingId = null;
  }
  function focusSelect(node) { node.focus(); node.select(); }
  function askDelete(id) {
    if (armedId !== id) {
      armedId = id;
      clearTimeout(armTimer);
      armTimer = setTimeout(() => (armedId = null), 3000);
      return;
    }
    armedId = null;
    deletePlaylist(id);
  }
</script>

<section class="pl-page">
  <div class="head">
    <h2>Плейлисты</h2>
    <button class="new-btn" on:click={create}>+ Новый плейлист</button>
  </div>

  {#if cards.length === 0}
    <div class="empty" in:fade={{ duration: 250 }}>
      <div class="empty-icon">♫</div>
      <p>У вас пока нет плейлистов</p>
      <button class="new-btn" on:click={create}>Создать первый</button>
    </div>
  {:else}
    <div class="grid">
      {#each cards as card, i (card.pl.id)}
        <div class="card" role="button" tabindex="0"
          on:click={() => editingId !== card.pl.id && open(card.pl.id)}
          on:keypress={(e) => e.key === 'Enter' && editingId !== card.pl.id && open(card.pl.id)}
          animate:flip={{ duration: 300, easing: cubicOut }}
          in:fly={{ y: 18, duration: 380, delay: Math.min(i, 8) * 45, easing: cubicOut }}
          out:scale={{ start: 0.92, duration: 220 }}>
          <div class="mosaic" class:single={card.covers.length === 1}>
            {#if card.covers.length === 0}
              <div class="ph">♫</div>
            {:else}
              {#each card.covers as t (t.id)}
                <img src={coverUrl(t.coverPath)} alt="" />
              {/each}
            {/if}
            <button class="play" title="Играть" disabled={!card.list.length}
              on:click|stopPropagation={() => play(card)}>▶</button>
          </div>
          <div class="info">
            {#if editingId === card.pl.id}
              <input class="name-input" value={card.pl.name} maxlength="60" use:focusSelect
                on:click|stopPropagation
                on:blur={(e) => commit(e, card.pl.id)}
                on:keydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = card.pl.name; e.currentTarget.blur(); } }} />
            {:else}
              <div class="name" title={card.pl.name}>{card.pl.name}</div>
            {/if}
            <div class="meta">{card.list.length} {plural(card.list.length)}{card.seconds ? ' · ' + fmtTotal(card.seconds) : ''}</div>
          </div>
          <div class="actions">
            <button title="Переименовать" on:click|stopPropagation={() => (editingId = card.pl.id)}>✎</button>
            <button class="del" class:armed={armedId === card.pl.id} title="Удалить плейлист"
              on:click|stopPropagation={() => askDelete(card.pl.id)}>{armedId === card.pl.id ? 'Точно?' : '🗑'}</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .pl-page { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 18px; min-height: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h2 { margin: 0; color: var(--text); font-size: 28px; }
  .new-btn { padding: 10px 16px; border: 1px solid rgba(var(--accent-rgb), 0.4); border-radius: 12px; background: linear-gradient(rgba(var(--accent-rgb), 0.16), rgba(var(--accent-rgb), 0.16)), var(--button-bg); color: var(--text); transition: 0.15s ease; }
  .new-btn:hover { border-color: rgba(var(--accent-rgb), 0.7); }
  .grid { flex: 1; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 16px; align-content: start; padding: 4px 4px 12px 0; }
  .card { position: relative; padding: 12px; border-radius: 18px; background: var(--item-bg); border: 1px solid var(--item-border); color: var(--text); cursor: pointer; transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease; }
  .card:hover { border-color: rgba(var(--accent-rgb), 0.4); transform: translateY(-2px); }
  .mosaic { position: relative; aspect-ratio: 1; border-radius: 12px; overflow: hidden; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 2px; background: var(--surface-2, rgba(255,255,255,0.05)); }
  .mosaic.single { grid-template-columns: 1fr; grid-template-rows: 1fr; }
  .mosaic img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ph { grid-column: 1 / -1; grid-row: 1 / -1; display: flex; align-items: center; justify-content: center; font-size: 44px; color: var(--muted); }
  .play { position: absolute; right: 8px; bottom: 8px; width: 40px; height: 40px; border-radius: 50%; border: 0; background: var(--accent); color: #fff; font-size: 15px; display: flex; align-items: center; justify-content: center; opacity: 0; transform: translateY(6px); transition: 0.18s ease; box-shadow: 0 6px 16px rgba(0,0,0,0.35); }
  .card:hover .play:not(:disabled) { opacity: 1; transform: none; }
  .play:disabled { display: none; }
  .info { margin-top: 10px; min-width: 0; }
  .name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { margin-top: 3px; font-size: 12px; color: var(--muted); }
  .name-input { width: 100%; box-sizing: border-box; padding: 4px 8px; border: 1px solid rgba(var(--accent-rgb), 0.5); border-radius: 8px; background: var(--input-bg, var(--item-bg)); color: var(--text); outline: none; font-weight: 700; font-size: inherit; }
  .actions { position: absolute; top: 18px; right: 18px; display: flex; gap: 6px; opacity: 0; transition: 0.18s ease; }
  .card:hover .actions, .actions:focus-within { opacity: 1; }
  .actions button { min-width: 30px; height: 30px; padding: 0 8px; border: 0; border-radius: 9px; background: rgba(0,0,0,0.55); color: #fff; font-size: 13px; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
  .actions button:hover { background: rgba(var(--accent-rgb), 0.8); }
  .actions .del:hover, .actions .del.armed { background: #ff4d4f; }
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border: 1px dashed var(--panel-border, var(--border)); border-radius: 22px; color: var(--muted); }
  .empty-icon { font-size: 54px; opacity: 0.6; }
  .empty p { margin: 0 0 8px; }
</style>
