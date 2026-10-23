<script>
  // Логотип «A» с перекладиной-эквалайзером: три столбика плавно «играют»,
  // как полоски визуализатора. Столбики наследуют --accent (акцент темы/палитры).
  // animate=false — статичная версия (например, если захотите останавливать на паузе).
  export let size = 64;
  export let glow = true;
  export let animate = true;
</script>

<svg viewBox="0 0 32 32" width={size} height={size} class:glow class:paused={!animate} aria-hidden="true">
  <!-- ноги «A» -->
  <path class="leg" d="M6 27 L16 5 L26 27" />
  <!-- перекладина-эквалайзер: столбики стоят на общей базовой линии y=22.8 -->
  <path class="bar b1" d="M12.3 22.8 V17" />
  <path class="bar b2" d="M16 22.8 V14" />
  <path class="bar b3" d="M19.7 22.8 V16" />
</svg>

<style>
  svg { display: block; overflow: visible; color: var(--accent, #7c5cff); }
  svg.glow { filter: drop-shadow(0 0 6px rgba(var(--accent-rgb, 124, 92, 255), 0.55)); }
  path {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .leg { stroke-width: 3.8; }

  /* столбики растут от базовой линии вверх */
  .bar {
    stroke-width: 2.6;
    transform-box: fill-box;
    transform-origin: 50% 100%;
    animation: aria-eq-1 0.7s ease-in-out infinite;
  }
  .b2 { animation: aria-eq-2 0.9s ease-in-out infinite; animation-delay: -0.3s; }
  .b3 { animation: aria-eq-3 0.8s ease-in-out infinite; animation-delay: -0.5s; }

  svg.paused .bar { animation: none; }

  /* лёгкий «дыхательный» ритм: разные амплитуда и длительность дают нерегулярный бой */
  @keyframes aria-eq-1 {
    0%, 100% { transform: scaleY(0.55); }
    50% { transform: scaleY(1); }
  }
  @keyframes aria-eq-2 {
    0%, 100% { transform: scaleY(1); }
    45% { transform: scaleY(0.5); }
  }
  @keyframes aria-eq-3 {
    0%, 100% { transform: scaleY(0.65); }
    55% { transform: scaleY(0.95); }
  }

  /* уважение к системной настройке «уменьшить движение» */
  @media (prefers-reduced-motion: reduce) {
    .bar { animation: none; }
  }
</style>
