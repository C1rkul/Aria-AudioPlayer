<script>
  import { fade } from 'svelte/transition';
  export let src = '';
  export let placeholder = '🎵';
  export let duration = 380;
</script>

<div class="cover-box">
  {#key src}
    <div class="layer" in:fade={{ duration }} out:fade={{ duration }}>
      {#if src}
        <img {src} alt="" />
      {:else}
        <span class="ph">{placeholder}</span>
      {/if}
    </div>
  {/key}
</div>

<style>
  .cover-box { position: relative; width: 100%; height: 100%; }
  .layer { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ph { opacity: 0.55; font-size: 1em; line-height: 1; }
</style>
