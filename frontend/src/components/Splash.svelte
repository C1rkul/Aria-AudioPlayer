<script>
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import AriaMark from './AriaMark.svelte';

  const dispatch = createEventDispatcher();

  let markIn = false;     // 1) буква A проявляется по центру
  let spread = false;     // 2) A отъезжает влево, одновременно появляются «ria»
  let showCredit = false; // 3) подпись медленно проявляется
  let wordW = 0;          // ширина слова «ria» — на столько A смещена вправо, пока она одна

  onMount(() => {
    const timers = [];
    let cancelled = false;

    (async () => {
      // ждём шрифт и первую раскладку, чтобы ширина «ria» была измерена до старта (иначе будет скачок)
      try { await document.fonts?.ready; } catch {}
      await tick();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled) return;

      markIn = true;
      timers.push(setTimeout(() => (spread = true), 1500));
      timers.push(setTimeout(() => (showCredit = true), 3000));
      timers.push(setTimeout(() => dispatch('done'), 5300));
    })();

    return () => { cancelled = true; timers.forEach(clearTimeout); };
  });
</script>

<div class="splash" out:fade|global={{ duration: 800 }} role="presentation">
  <div class="logo">
    <div class="mark" class:in={markIn} class:spread style="--shift:{(wordW + 4) / 2}px">
      <AriaMark size={72} />
    </div>
    <span class="word" bind:clientWidth={wordW}>
      {#each 'ria' as ch, i}<span class="ch" class:show={spread} style="transition-delay:{i * 130}ms">{ch}</span>{/each}
    </span>
  </div>
  <div class="credit" class:show={showCredit}>made by C1RKUL &amp; Claude x Qwen</div>
</div>

<style>
  .splash {
    position: fixed; inset: 0; z-index: 3000;
    display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--bg, #0f0f12) 62%, transparent);
    -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px);
    cursor: wait; user-select: none;
  }
  .logo { display: flex; align-items: center; color: var(--text, #fff); }

  /* слово занимает место сразу (буквы невидимы), поэтому раскладка не прыгает;
     пока A одна, она сдвинута вправо на половину слова и выглядит отцентрованной */
  .mark {
    opacity: 0; will-change: transform, opacity;
    transform: translateX(var(--shift)) scale(0.88);
    transition: opacity 1s ease, transform 1.1s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .mark.in { opacity: 1; transform: translateX(var(--shift)) scale(1); }
  .mark.spread { transform: translateX(0) scale(1); transition-duration: 1s, 1.2s; }

  .word { display: inline-flex; margin-left: 4px; font-size: 70px; font-weight: 700; line-height: 72px; letter-spacing: 1px; }
  .ch { opacity: 0; transform: translateX(-16px); will-change: transform, opacity; transition: opacity 0.9s ease, transform 1s cubic-bezier(0.22, 1, 0.36, 1); }
  .ch.show { opacity: 1; transform: translateX(0); }

  .credit {
    position: absolute; left: 0; right: 0; bottom: 40px; text-align: center;
    font-size: 14px; letter-spacing: 1.5px; color: var(--muted, #9aa0aa);
    opacity: 0; transform: translateY(8px);
    transition: opacity 1.8s ease, transform 1.8s ease;
  }
  .credit.show { opacity: 1; transform: translateY(0); }
</style>
