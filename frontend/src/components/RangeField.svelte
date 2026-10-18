<script>
  import { createEventDispatcher } from 'svelte';

  export let id = '';
  export let label = '';
  export let min = 0;
  export let max = 100;
  export let step = 1;
  export let value = 0;
  export let format = (v) => String(v);

  const dispatch = createEventDispatcher();
  $: pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  function onInput(e) {
    dispatch('change', Number(e.currentTarget.value));
  }
</script>

<div class="range-field">
  <label for={id}>
    <span>{label}</span>
    <span class="val">{format(value)}</span>
  </label>
  <input {id} type="range" {min} {max} {step} {value} style="--fill-percent:{pct}%" on:input={onInput} />
</div>

<style>
  .range-field { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
  label { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; color: var(--text); font-size: 14px; }
  .val { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 13px; }
  input[type='range'] { margin: 0; }
</style>
