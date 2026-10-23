<script>
  // «Предыдущий/Следующий»: треугольник + планка, заливка — как у PlayPauseIcon.
  export let back = false; // true — «предыдущий» (знак отзеркален)
</script>

<svg
  class="skip"
  viewBox="0 0 24 24"
  width="1em"
  height="1em"
  fill="currentColor"
  aria-hidden="true"
>
  <g transform={back ? 'translate(24 0) scale(-1 1)' : undefined}>
    <path d="M5 5.5 L14.2 12 L5 18.5 Z" />
    <rect x="16.6" y="5.5" width="2.6" height="13" rx="1.3" />
  </g>
</svg>

<style>
  .skip {
    display: block;
    overflow: visible;
  }
</style>
