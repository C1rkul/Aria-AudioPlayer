<script>
  import { APP_NAME, APP_VERSION } from '../lib/version.js';
</script>

<section class="page">
  <div class="body">
    <h2>О приложении</h2>

    <p><strong>{APP_NAME}</strong> — аудио-плеер на Go + Wails v2.</p>

    <div class="tech">
      <span class="badge">Go</span>
      <span class="badge">Wails v2</span>
      <span class="badge">Svelte</span>
      <span class="badge">Vite</span>
    </div>

    <p class="version">Версия: {APP_VERSION}</p>
  </div>

  <footer class="credit">made by C1RKUL &amp; Claude x Qwen</footer>
</section>

<style>
  .page { min-height: 100%; height: 100%; display: flex; flex-direction: column; }
  .body { max-width: 760px; }

  h2 { margin-top: 0; color: var(--text); font-size: 28px; }
  p { color: var(--muted); line-height: 1.6; }
  p strong { color: var(--text); }

  .tech { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
  .badge { padding: 7px 11px; border-radius: 999px; border: 1px solid var(--border); background: var(--item-bg); color: var(--text); font-size: 13px; }
  .version { margin-top: 18px; color: var(--text); font-weight: 600; }

  /* подпись всегда внизу по центру */
  .credit { margin-top: auto; padding: 24px 0 4px; text-align: center; color: var(--muted); font-size: 13px; letter-spacing: 1.2px; }
</style>
