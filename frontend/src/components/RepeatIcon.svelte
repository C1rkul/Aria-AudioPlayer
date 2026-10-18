<script>
  export let mode = 'off'; // 'off' | 'all' | 'one'
</script>

<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="17 1 21 5 17 9" />
  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
  <polyline points="7 23 3 19 7 15" />
  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  <text x="12" y="15.2" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none"
        class="one" class:show={mode === 'one'}>1</text>
</svg>

<style>
  svg { display: block; overflow: visible; }
  .one { opacity: 0; transform: scale(0.5); transform-origin: 12px 12px; transition: opacity 0.3s ease, transform 0.3s ease; }
  .one.show { opacity: 1; transform: scale(1); }
</style>
