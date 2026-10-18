<script>
  // Логотип «A» (две ноги и перекладина). Статичный — анимацию делает родитель.
  export let size = 64;
  export let glow = true;
</script>

<svg viewBox="0 0 32 32" width={size} height={size} class:glow aria-hidden="true">
  <path d="M6 27 L16 5 L26 27" />
  <path d="M11.4 19.5 L20.6 19.5" />
</svg>

<style>
  svg { display: block; overflow: visible; color: var(--accent, #7c5cff); }
  svg.glow { filter: drop-shadow(0 0 6px rgba(var(--accent-rgb, 124, 92, 255), 0.55)); }
  path { fill: none; stroke: currentColor; stroke-width: 3.8; stroke-linecap: round; stroke-linejoin: round; }
</style>
