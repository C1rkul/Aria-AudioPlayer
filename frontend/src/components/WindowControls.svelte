<script>
  // Кнопки окна (фреймлесс): только «закрыть» и «свернуть».
  // «Развернуть» убрано — функция пока не работает.
  import { WindowMinimise, Quit } from '../../wailsjs/runtime/runtime';
</script>

<div class="win-controls">
  <button class="wc-btn" on:click={() => Quit()} title="Закрыть" aria-label="Закрыть окно">
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.75 2.75L9.25 9.25M9.25 2.75L2.75 9.25" />
    </svg>
  </button>

  <button class="wc-btn" on:click={() => WindowMinimise()} title="Свернуть" aria-label="Свернуть окно">
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.5H10" />
    </svg>
  </button>
</div>

<style>
  /* Компактный кластер: только глифы, без рамок, подложек и «ящичков» между ними */
  .win-controls {
    display: flex;
    align-items: center;
    gap: 0;
    height: 100%;
    /* кнопки внутри drag-зоны обязаны выйти из неё, иначе клик начнёт таскать окно */
    --wails-draggable: no-drag;
  }

  .wc-btn {
    width: auto;
    min-width: 24px;
    height: 30px;
    padding: 0 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent; /* без прямоугольников-подложек даже при наведении */
    color: var(--muted);
    padding-top: 0;
    cursor: default;
    transition: color 0.15s ease, transform 0.15s ease;
  }

  .wc-btn svg {
    display: block;
    /* лёгкая тень — чтобы глифы оставались видны на ярком адаптивном фоне Now Playing */
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45));
  }

  .wc-btn svg path {
    stroke: currentColor;
    stroke-width: 1.5;
    fill: none;
    stroke-linecap: round;
  }

  /* наведение — только цвет под акцент, без рамок и заливок */
  .wc-btn:hover {
    color: var(--accent);
  }

  .wc-btn:active {
    color: var(--text);
    transform: scale(0.92);
  }

  .wc-btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
    border-radius: 4px;
  }
</style>
