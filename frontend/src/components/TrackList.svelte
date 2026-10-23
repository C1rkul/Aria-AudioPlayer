<script>
  // Компактный список треков: клик — играть, перетаскивание — смена порядка, ✕ — убрать.
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { autohideScroll } from '../lib/autohide-scroll.js';
  import NoteIcon from './NoteIcon.svelte';

  export let items = [];          // массив треков
  export let activeId = null;     // играющий трек
  export let streamBase = '';
  export let reorderable = false;
  export let removable = false;
  export let emptyText = 'Пусто';

  const dispatch = createEventDispatcher();

  function coverUrl(path) {
    return streamBase && path ? `${streamBase}/cover?path=${encodeURIComponent(path)}` : '';
  }
  function fmt(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return '';
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  }

  // --- перетаскивание (pointer events) ---
  let listEl;
  let drag = null;
  let noAnim = false;
  let suppressClick = false;
  let timer = null;

  function update() {
    if (!drag) return;
    const dy = drag.lastY - drag.startY + (listEl.scrollTop - drag.startScroll);
    if (!drag.active && Math.abs(dy) < 6) return;
    drag.active = true;
    drag.dy = dy;
    drag.to = Math.max(0, Math.min(items.length - 1, Math.round(drag.from + dy / drag.h)));
    drag = drag;
  }
  function down(e, i) {
    listEl = e.currentTarget.closest('.tl');
    if (!reorderable || e.button !== 0 || e.target.closest('.rm') || !listEl) return;
    drag = { from: i, to: i, dy: 0, h: e.currentTarget.offsetHeight + 4, startY: e.clientY, startScroll: listEl.scrollTop, lastY: e.clientY, active: false };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    timer = setInterval(() => {
      if (!drag || !drag.active) return;
      const r = listEl.getBoundingClientRect();
      if (drag.lastY < r.top + 36) listEl.scrollTop -= 8;
      else if (drag.lastY > r.bottom - 36) listEl.scrollTop += 8;
      update();
    }, 16);
  }
  function move(e) { if (drag) { drag.lastY = e.clientY; update(); } }
  function stop() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    clearInterval(timer);
  }
  function finish(commit) {
    stop();
    const d = drag;
    drag = null;
    if (!d || !d.active) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    noAnim = true;
    if (commit && d.to !== d.from) dispatch('move', { from: d.from, to: d.to });
    requestAnimationFrame(() => requestAnimationFrame(() => (noAnim = false)));
  }
  const up = () => finish(true);
  const cancel = () => finish(false);
  onDestroy(stop);

  function style(i, d) {
    if (!d || !d.active) return '';
    if (i === d.from) return `transform:translateY(${d.dy}px);z-index:5;transition:none;box-shadow:0 8px 22px rgba(0,0,0,.4);`;
    if (d.from < d.to && i > d.from && i <= d.to) return `transform:translateY(${-d.h}px);`;
    if (d.from > d.to && i < d.from && i >= d.to) return `transform:translateY(${d.h}px);`;
    return '';
  }

  function play(id) { if (!suppressClick) dispatch('play', id); }

  // при показе списка прокручиваем к играющему треку
  function toActive(node) {
    requestAnimationFrame(() => node.querySelector('.row.active')?.scrollIntoView({ block: 'center' }));
  }
</script>

{#if items.length === 0}
  <p class="tl-empty">{emptyText}</p>
{:else}
  <div class="tl" class:noanim={noAnim} use:autohideScroll use:toActive>
    {#each items as t, i (t.id)}
      <div class="row" class:active={t.id === activeId} class:dragging={drag && drag.active && drag.from === i}
        style={style(i, drag)} role="button" tabindex="0"
        on:pointerdown={(e) => down(e, i)}
        on:click={() => play(t.id)}
        on:keypress={(e) => e.key === 'Enter' && play(t.id)}>
        <span class="n">{i + 1}</span>
                <span class="cv">{#if t.coverPath && streamBase}<img src={coverUrl(t.coverPath)} alt="" draggable="false" />{:else}<NoteIcon />{/if}</span>
        <span class="tx"><span class="ti">{t.title}</span><span class="ar">{t.artist || ''}</span></span>
        <span class="du">{fmt(t.duration)}</span>
        {#if removable}<button class="rm" title="Убрать" on:click|stopPropagation={() => dispatch('remove', t.id)}>✕</button>{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .tl { height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 4px; text-align: left; }
  .tl.noanim .row { transition: none; }
  .row { position: relative; display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; transition: transform 0.18s ease, background 0.15s ease; touch-action: pan-y; flex: 0 0 auto; }
  .row:hover { background: rgba(127,127,127,0.14); }
  .row.active { background: rgba(var(--accent-rgb), 0.2); border-color: rgba(var(--accent-rgb), 0.4); }
  .row.dragging { background: var(--item-bg, #222); cursor: grabbing; }
  .n { width: 20px; text-align: center; font-size: 12px; color: var(--muted, #aaa); flex: 0 0 auto; }
  .cv { width: 36px; height: 36px; border-radius: 7px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: rgba(127,127,127,0.18); flex: 0 0 auto; font-size: 15px; }
  .cv img { width: 100%; height: 100%; object-fit: cover; }
  .tx { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .ti { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ar { font-size: 12px; color: var(--muted, #aaa); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .du { font-size: 12px; color: var(--muted, #aaa); font-variant-numeric: tabular-nums; flex: 0 0 auto; }
  .rm { width: 24px; height: 24px; border: 0; border-radius: 7px; background: transparent; color: var(--muted, #aaa); opacity: 0; transition: 0.15s ease; flex: 0 0 auto; }
  .row:hover .rm { opacity: 1; }
  .rm:hover { background: #ff4d4f; color: #fff; }
  .tl-empty { margin: 0; color: var(--muted, #aaa); font-size: 14px; line-height: 1.6; border: 1px dashed rgba(127,127,127,0.35); border-radius: 12px; padding: 16px; }
</style>
