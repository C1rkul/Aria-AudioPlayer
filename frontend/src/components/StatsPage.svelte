<script>
  import { onDestroy } from 'svelte';
  import { stats, resetStats } from '../stores/stats.js';
  import { tracks } from '../stores/player.js';
  import { playlists } from '../stores/playlists.js';
  import CoverImage from './CoverImage.svelte';

  export let streamBase = '';

  let sortBy = 'sec'; // 'sec' — по времени, 'plays' — по числу прослушиваний

  // «Живое» время сеанса уже приходит из стора (обновляется раз в секунду)
  $: lib = $tracks;
  $: libSeconds = lib.reduce((sum, t) => sum + (t.duration > 0 ? t.duration : 0), 0);
  $: byId = new Map(lib.map((t) => [t.id, t]));
  $: plById = new Map($playlists.map((p) => [p.id, p]));

  $: topTracks = Object.entries($stats.tracks)
    .map(([id, s]) => {
      const t = byId.get(id);
      return {
        id, sec: s.sec, plays: s.plays,
        title: t?.title || s.title || 'Unknown Title',
        artist: t ? t.artist : s.artist,
        coverPath: t?.coverPath || '',
        removed: !t
      };
    })
    .filter((r) => r.sec >= 1 || r.plays > 0)
    .sort((a, b) => cmp(a, b, sortBy))
    .slice(0, 10);

  $: topPlaylists = Object.entries($stats.playlists)
    .map(([id, s]) => {
      const p = plById.get(id);
      return { id, sec: s.sec, plays: s.plays, name: p?.name || s.name || 'Плейлист', removed: !p, count: p ? p.trackIds.length : null };
    })
    .filter((r) => r.sec >= 1 || r.plays > 0)
    .sort((a, b) => cmp(a, b, sortBy))
    .slice(0, 10);

  $: maxTrack = Math.max(1, ...topTracks.map((r) => (sortBy === 'sec' ? r.sec : r.plays)));
  $: maxPl = Math.max(1, ...topPlaylists.map((r) => (sortBy === 'sec' ? r.sec : r.plays)));

  function cmp(a, b, by) {
    return by === 'sec' ? b.sec - a.sec || b.plays - a.plays : b.plays - a.plays || b.sec - a.sec;
  }

  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (d) return `${d} д ${h} ч ${m} мин`;
    if (h) return `${h} ч ${m} мин`;
    if (m) return `${m} мин ${s} с`;
    return `${s} с`;
  }
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function coverUrl(path) {
    return streamBase && path ? `${streamBase}/cover?path=${encodeURIComponent(path)}` : '';
  }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString('ru-RU'); } catch (e) { return ''; }
  }

  let armed = false;
  let armTimer;
  function onReset() {
    if (!armed) {
      armed = true;
      armTimer = setTimeout(() => (armed = false), 3000);
      return;
    }
    clearTimeout(armTimer);
    armed = false;
    resetStats();
  }
  onDestroy(() => clearTimeout(armTimer));
</script>

<section class="page">
  <h2>Статистика</h2>

  <div class="cards">
    <div class="card"><div class="val">{fmtDur($stats.totalSec)}</div><div class="lbl">Всего прослушано</div></div>
    <div class="card"><div class="val">{fmtDur($stats.sessionSec)}</div><div class="lbl">С последнего запуска</div></div>
    <div class="card"><div class="val">{$stats.launches}</div><div class="lbl">{plural($stats.launches, 'запуск', 'запуска', 'запусков')} приложения</div></div>
    <div class="card"><div class="val">{lib.length}</div><div class="lbl">{plural(lib.length, 'трек', 'трека', 'треков')} в библиотеке</div></div>
    <div class="card"><div class="val">{fmtDur(libSeconds)}</div><div class="lbl">Общая длительность музыки</div></div>
    <div class="card"><div class="val">{$stats.plays}</div><div class="lbl">{plural($stats.plays, 'прослушивание', 'прослушивания', 'прослушиваний')} треков</div></div>
  </div>

  <div class="toolbar">
    <div class="seg" role="tablist">
      <button class:active={sortBy === 'sec'} on:click={() => (sortBy = 'sec')}>По времени</button>
      <button class:active={sortBy === 'plays'} on:click={() => (sortBy = 'plays')}>По числу прослушиваний</button>
    </div>
    <span class="since">Статистика ведётся с {fmtDate($stats.firstLaunch)}</span>
  </div>

  <div class="lists">
    <div class="block">
      <h3>Топ-10 треков</h3>
      {#if topTracks.length === 0}
        <p class="empty">Пока пусто — включите что-нибудь, и здесь появится рейтинг.</p>
      {:else}
        <ol>
          {#each topTracks as r, i (r.id)}
            <li>
              <span class="rank">{i + 1}</span>
              <div class="cov"><CoverImage src={coverUrl(r.coverPath)} placeholder="🎵" duration={0} /></div>
              <div class="meta">
                <div class="name">{r.title}{#if r.removed}<span class="tag">удалён</span>{/if}</div>
                <div class="sub">{r.artist || 'Неизвестный исполнитель'}</div>
                <div class="bar"><i style="width:{((sortBy === 'sec' ? r.sec : r.plays) / maxTrack) * 100}%"></i></div>
              </div>
              <div class="nums">
                <div class="n1">{sortBy === 'sec' ? fmtDur(r.sec) : `${r.plays} ${plural(r.plays, 'раз', 'раза', 'раз')}`}</div>
                <div class="n2">{sortBy === 'sec' ? `${r.plays} ${plural(r.plays, 'раз', 'раза', 'раз')}` : fmtDur(r.sec)}</div>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </div>

    <div class="block">
      <h3>Топ-10 плейлистов</h3>
      {#if topPlaylists.length === 0}
        <p class="empty">Плейлисты считаются, когда трек запущен из плейлиста.</p>
      {:else}
        <ol>
          {#each topPlaylists as r, i (r.id)}
            <li>
              <span class="rank">{i + 1}</span>
              <div class="cov ico">♫</div>
              <div class="meta">
                <div class="name">{r.name}{#if r.removed}<span class="tag">удалён</span>{/if}</div>
                <div class="sub">{r.count === null ? '—' : `${r.count} ${plural(r.count, 'трек', 'трека', 'треков')}`}</div>
                <div class="bar"><i style="width:{((sortBy === 'sec' ? r.sec : r.plays) / maxPl) * 100}%"></i></div>
              </div>
              <div class="nums">
                <div class="n1">{sortBy === 'sec' ? fmtDur(r.sec) : `${r.plays} ${plural(r.plays, 'раз', 'раза', 'раз')}`}</div>
                <div class="n2">{sortBy === 'sec' ? `${r.plays} ${plural(r.plays, 'раз', 'раза', 'раз')}` : fmtDur(r.sec)}</div>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  </div>

  <div class="foot">
    <button class="reset" class:armed on:click={onReset}>{armed ? 'Нажмите ещё раз для сброса' : 'Сбросить статистику'}</button>
  </div>
</section>

<style>
  .page { max-width: 1100px; }
  h2 { margin-top: 0; color: var(--text); font-size: 28px; }
  h3 { margin: 0 0 12px; color: var(--text); font-size: 17px; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 22px; }
  .card { padding: 16px 18px; border-radius: 14px; border: 1px solid var(--item-border); background: var(--item-bg); }
  .val { font-size: 24px; font-weight: 700; color: var(--text); line-height: 1.2; }
  .lbl { margin-top: 4px; font-size: 13px; color: var(--muted); }

  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .seg { display: inline-flex; padding: 3px; border-radius: 999px; border: 1px solid var(--border); background: var(--item-bg); }
  .seg button { border: none; background: transparent; color: var(--muted); padding: 6px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; transition: background .2s ease, color .2s ease; }
  .seg button.active { background: var(--accent); color: #fff; }
  .since { font-size: 12px; color: var(--muted); }

  .lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; }
  .block { padding: 16px 18px; border-radius: 14px; border: 1px solid var(--item-border); background: var(--item-bg); min-width: 0; }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  li { display: flex; align-items: center; gap: 12px; }
  .rank { width: 20px; text-align: center; font-weight: 700; color: var(--muted); font-size: 14px; }
  li:nth-child(-n+3) .rank { color: var(--accent); }
  .cov { width: 44px; height: 44px; flex: none; border-radius: 8px; overflow: hidden; position: relative; background: rgba(127,127,127,0.15); }
  .cov.ico { display: flex; align-items: center; justify-content: center; font-size: 20px; color: var(--accent); }
  .meta { flex: 1; min-width: 0; }
  .name { color: var(--text); font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tag { margin-left: 8px; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 500; color: var(--muted); border: 1px solid var(--border); }
  .bar { margin-top: 5px; height: 4px; border-radius: 999px; background: rgba(127,127,127,0.18); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 999px; background: var(--accent); transition: width .4s ease; }
  .nums { text-align: right; flex: none; }
  .n1 { color: var(--text); font-size: 13px; font-weight: 600; }
  .n2 { color: var(--muted); font-size: 12px; }
  .empty { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }

  .foot { margin-top: 22px; }
  .reset { padding: 8px 14px; border-radius: 10px; border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 13px; cursor: pointer; transition: .15s ease; }
  .reset:hover { color: var(--text); }
  .reset.armed { border-color: #e5484d; color: #e5484d; }
</style>
