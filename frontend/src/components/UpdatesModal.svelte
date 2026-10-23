<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { entries } from '../lib/updates.js';
  import { APP_VERSION } from '../lib/version.js';

  const dispatch = createEventDispatcher();
  const SECTIONS = [['added', 'Добавлено'], ['changed', 'Изменено'], ['fixed', 'Исправлено']];

  let showAll = false;
  $: current = entries.find((e) => e.version === APP_VERSION) || entries[0];
  $: older = entries.filter((e) => e !== current);

  function close() { dispatch('close'); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  let boxEl;
  onMount(() => boxEl?.focus());
</script>

<svelte:window on:keydown={onKey} />

<div class="backdrop" on:click|self={close} transition:fade={{ duration: 200 }} role="presentation">
  <div class="box" bind:this={boxEl} tabindex="-1" role="dialog" aria-modal="true" aria-label="Что нового"
    in:scale={{ start: 0.94, duration: 260, easing: cubicOut }} out:scale={{ start: 0.96, duration: 160 }}>
    <div class="head">
      <div>
        <div class="kicker">Что нового</div>
        <h2>Aria {current.version}</h2>
        {#if current.title}<div class="sub">{current.title}{current.date ? ' · ' + current.date : ''}</div>{/if}
      </div>
      <button class="x" on:click={close} title="Закрыть">✕</button>
    </div>

    <div class="body">
      {#each SECTIONS as [key, label]}
        {#if current[key]?.length}
          <h3>{label}</h3>
          <ul>{#each current[key] as item}<li>{item}</li>{/each}</ul>
        {/if}
      {/each}

      {#if older.length}
        <button class="more" on:click={() => (showAll = !showAll)}>
          {showAll ? 'Скрыть прошлые версии' : 'Прошлые версии'} {showAll ? '▴' : '▾'}
        </button>
        {#if showAll}
          {#each older as e (e.version)}
            <div class="old">
              <h4>{e.version}{e.date ? ' · ' + e.date : ''}{e.title ? ' — ' + e.title : ''}</h4>
              {#each SECTIONS as [key, label]}
                {#if e[key]?.length}
                  <div class="old-label">{label}</div>
                  <ul>{#each e[key] as item}<li>{item}</li>{/each}</ul>
                {/if}
              {/each}
            </div>
          {/each}
        {/if}
      {/if}
    </div>

    <div class="foot">
      <span class="net">Автообновление по сети появится позже</span>
      <button class="ok" on:click={close}>Понятно</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 2400; display: flex; align-items: center; justify-content: center; padding: 24px;
    background: color-mix(in srgb, var(--bg, #0f0f12) 60%, transparent); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
  .box { width: min(560px, 100%); max-height: min(620px, 100%); display: flex; flex-direction: column; border-radius: 22px; outline: none;
    background: var(--panel-bg, #1b1b21); border: 1px solid rgba(var(--accent-rgb), 0.35); color: var(--text); box-shadow: 0 24px 70px rgba(0,0,0,0.5); text-align: left; }
  .head { display: flex; justify-content: space-between; gap: 12px; padding: 22px 24px 10px; }
  .kicker { font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--accent); font-weight: 700; }
  h2 { margin: 4px 0 2px; font-size: 24px; }
  .sub { color: var(--muted); font-size: 14px; }
  .x { width: 32px; height: 32px; border: 0; border-radius: 10px; background: transparent; color: var(--muted); font-size: 15px; }
  .x:hover { background: rgba(127,127,127,0.2); color: var(--text); }
  .body { padding: 4px 24px 12px; overflow-y: auto; scrollbar-width: thin; }
  h3 { margin: 14px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); }
  ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; line-height: 1.45; font-size: 14px; }
  .more { margin-top: 16px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--muted); font-size: 13px; }
  .more:hover { color: var(--text); border-color: rgba(var(--accent-rgb), 0.5); }
  .old { margin-top: 12px; padding: 12px 14px; border-radius: 14px; background: rgba(127,127,127,0.08); }
  h4 { margin: 0 0 6px; font-size: 14px; }
  .old-label { margin: 8px 0 3px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 24px 20px; }
  .net { font-size: 12px; color: var(--muted); }
  .ok { padding: 10px 22px; border: 0; border-radius: 12px; background: var(--accent); color: #fff; font-weight: 600; }
  .ok:hover { filter: brightness(1.1); }
</style>
