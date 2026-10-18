<script>
  export let volume = 0.5; // 0..1
  $: muted = volume <= 0;
  $: w1 = volume > 0;
  $: w2 = volume >= 0.34;
  $: w3 = volume >= 0.67;
</script>

<svg class="vol" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 9.5 H7.5 L12 5.5 V18.5 L7.5 14.5 H4 Z" fill="currentColor" stroke="none" />
  <path class="wave" class:on={w1} d="M15.2 9.6 Q16.8 12 15.2 14.4" />
  <path class="wave" class:on={w2} d="M17.6 7.4 Q20.6 12 17.6 16.6" />
  <path class="wave" class:on={w3} d="M20 5.2 Q24.4 12 20 18.8" />
  <g class="mute" class:on={muted}>
    <path d="M15.5 9.5 L21 15" />
    <path d="M21 9.5 L15.5 15" />
  </g>
</svg>

<style>
  .vol { display: block; overflow: visible; }
  .wave, .mute { opacity: 0; transform-origin: 12px 12px; transition: opacity 0.4s ease, transform 0.4s ease; }
  .wave { transform: translateX(-3px) scale(0.85); }
  .wave.on { opacity: 1; transform: translateX(0) scale(1); }
  .mute { transform: scale(0.6); transform-box: fill-box; transform-origin: center; }
  .mute.on { opacity: 1; transform: scale(1); }
</style>
