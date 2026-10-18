<script>
  export let playing = false;
  // Обе формы состоят из двух четырёхугольников — поэтому path плавно морфится
  const PLAY  = 'M7 5 L12 7.92 L12 16.08 L7 19 Z M12 7.92 L19 12 L19 12 L12 16.08 Z';
  const PAUSE = 'M6.5 5 L10 5 L10 19 L6.5 19 Z M14 5 L17.5 5 L17.5 19 L14 19 Z';
</script>

<svg class="pp" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
  <path d={playing ? PAUSE : PLAY} style="d: path('{playing ? PAUSE : PLAY}')" fill="currentColor" />
</svg>

<style>
  .pp { display: block; overflow: visible; }
  .pp path { transition: d 0.45s cubic-bezier(0.4, 0, 0.2, 1); }
</style>
