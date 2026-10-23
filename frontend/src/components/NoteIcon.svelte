<script>
  // Нота — замена эмодзи 🎵/♫ в обложках и заглушках.
  // Стиль feather (stroke, round caps) — как Volume/Repeat/Shuffle.
</script>

<svg
  class="note"
  viewBox="0 0 24 24"
  width="1em"
  height="1em"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M9 18V5l12-2v13" />
  <circle cx="6" cy="18" r="3" />
  <circle cx="18" cy="16" r="3" />
</svg>

<style>
  .note {
    display: block;
    overflow: visible;
    /* в текстовых контекстах (inline-блок) — по центру родителя */
    margin: 0 auto;
  }
</style>
