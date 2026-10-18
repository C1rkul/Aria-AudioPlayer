<script>
  import { onMount, tick } from 'svelte';
  export let text = '';

  let box, inner;
  let shift = 0;      // на сколько px нужно прокрутить
  let overflow = false;

  async function measure() {
    await tick();
    if (!box || !inner) return;
    const diff = inner.scrollWidth - box.clientWidth;
    overflow = diff > 1;
    shift = overflow ? diff : 0;
  }

  $: text, measure();

  onMount(() => {
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  });
</script>

<div class="marquee" bind:this={box}>
  <span
    class="inner"
    class:scroll={overflow}
    bind:this={inner}
    style="--shift:-{shift}px; --dur:{Math.max(6, shift / 25 + 4)}s"
  >{text}</span>
</div>

<style>
  .marquee { overflow: hidden; white-space: nowrap; width: 100%; }
  .inner { display: inline-block; }
  .inner.scroll { animation: marquee var(--dur) ease-in-out infinite alternate; animation-delay: 1s; }
  @keyframes marquee {
    0%, 12% { transform: translateX(0); }
    88%, 100% { transform: translateX(var(--shift)); }
  }
</style>
