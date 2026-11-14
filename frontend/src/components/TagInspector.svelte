<script>
  import { tt, tr, fmt } from '../lib/i18n.js';
  import { createEventDispatcher } from 'svelte';
  import { GetTagDetails, WriteTags, UndoLastTags, TagDiagnostics, PickCoverImage, SetTrackCover } from '../../wailsjs/go/main/App';
  import { showToast } from '../stores/toast.js';

  /** Инспектор тегов: правка выделенных треков + вкладка «Проблемы» с авто-чинкой. */
  export let selectedTracks = [];
  export let allTracks = [];
  export let blockedPath = ''; // файл, который сейчас играет — в запись не идёт

  const dispatch = createEventDispatcher();

  const FIELDS = ['title', 'artist', 'album', 'year', 'genre', 'track'];

  let tab = 'edit'; // edit | issues
  let details = null;
  let loading = false;
  let writeBusy = false;
  let coverBusy = false;
  let form = { title: '', artist: '', album: '', year: '', genre: '', track: '' };
  let issues = [];
  let issuesLoaded = false;
  let issuesLoading = false;
  let lastErrors = [];

  $: count = selectedTracks.length;
  $: refreshForm(selectedTracks);
  $: blockedSelected = !!blockedPath && selectedTracks.some((t) => t.path === blockedPath);

  async function refreshForm(tracks) {
    lastErrors = [];
    if (tracks.length === 1) {
      loading = true;
      details = null;
      try {
        details = await GetTagDetails(tracks[0].path);
        form = {
          title: details.title || '',
          artist: details.artist || '',
          album: details.album || '',
          year: details.year || '',
          genre: details.genre || '',
          track: details.track || '',
        };
      } catch (e) {
        form = { title: '', artist: '', album: '', year: '', genre: '', track: '' };
      }
      loading = false;
    } else {
      details = null;
      // в мультирежиме пустое поле = «не трогать»
      form = { title: '', artist: '', album: '', year: '', genre: '', track: '' };
    }
  }

  function setTab(t) {
    tab = t;
    if (t === 'issues') refreshIssues();
  }

  // ---------- запись ----------

  function baseName(p) {
    const parts = String(p || '').split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }

  function buildEdits() {
    const edits = [];
    let blocked = 0;
    for (const t of selectedTracks) {
      if (blockedPath && t.path === blockedPath) { blocked++; continue; }
      const f = {};
      if (count === 1) {
        for (const k of FIELDS) f[k] = form[k];
      } else {
        for (const k of FIELDS) if ((form[k] || '').trim() !== '') f[k] = form[k];
        if (Object.keys(f).length === 0) { showToast(tr('Заполните хотя бы одно поле')); return null; }
      }
      edits.push({ path: t.path, fields: f });
    }
    if (blocked > 0 && edits.length === 0) {
      showToast(fmt(tr('Сначала переключите этот трек: {0}'), baseName(blockedPath)), 3500);
      return null;
    }
    return edits;
  }

  function applyResult(res, sent) {
    lastErrors = (res && res.errors) || [];
    const ok = Math.max(0, sent - lastErrors.length);
    if (lastErrors.length > 0) {
      showToast(fmt(tr('Ошибок при записи: {0}'), lastErrors.length), 3500);
    } else {
      showToast(fmt(tr('Записано файлов: {0}'), ok));
    }
    if (res && Array.isArray(res.tracks)) dispatch('apply', res.tracks);
    if (tab === 'issues') refreshIssues();
  }

  async function write() {
    if (writeBusy || count === 0) return;
    const edits = buildEdits();
    if (!edits || edits.length === 0) return;
    writeBusy = true;
    try {
      const res = await WriteTags(edits, allTracks);
      applyResult(res, edits.length);
    } catch (e) {
      console.error(e);
      showToast(tr('Не удалось записать теги'));
    }
    writeBusy = false;
  }

  async function undo() {
    if (writeBusy) return;
    writeBusy = true;
    try {
      const res = await UndoLastTags(allTracks);
      lastErrors = (res && res.errors) || [];
      if (res && Array.isArray(res.tracks)) dispatch('apply', res.tracks);
      if (lastErrors.length > 0) showToast(fmt(tr('Ошибок при записи: {0}'), lastErrors.length), 3500);
      else showToast(tr('Последняя пачка откачена'));
      if (tab === 'issues') refreshIssues();
      if (selectedTracks.length === 1) {
        try { details = await GetTagDetails(selectedTracks[0].path); } catch (e) { /* догрузит refreshForm */ }
      }
    } catch (e) {
      showToast(tr('История правок пуста'));
    }
    writeBusy = false;
  }

  // ---------- обложка ----------
  async function changeCover() {
    if (writeBusy || coverBusy || count !== 1) return;
    const img = await PickCoverImage();
    if (!img) return;
    await setCover(false, img);
  }

  async function removeCover() {
    if (writeBusy || coverBusy || count !== 1) return;
    await setCover(true, '');
  }

  async function setCover(remove, img) {
    const tr0 = selectedTracks[0];
    if (!tr0) return;
    if (blockedPath && tr0.path === blockedPath) {
      showToast(fmt(tr('Сначала переключите этот трек: {0}'), baseName(blockedPath)), 3500);
      return;
    }
    coverBusy = true;
    try {
      const res = await SetTrackCover(tr0.path, remove, img, allTracks);
      lastErrors = (res && res.errors) || [];
      if (res && Array.isArray(res.tracks)) dispatch('apply', res.tracks);
      if (lastErrors.length > 0) showToast(fmt(tr('Ошибок при записи: {0}'), lastErrors.length), 3500);
      else showToast(remove ? tr('Обложка удалена') : tr('Обложка обновлена'));
      try { details = await GetTagDetails(tr0.path); } catch (e) { /* догрузит refreshForm */ }
      if (tab === 'issues') refreshIssues();
    } catch (e) {
      console.error(e);
      const msg = (e && (e.message || String(e))) || '';
      showToast(msg ? tr('Не удалось записать обложку') + ': ' + msg : tr('Не удалось записать обложку'), 5000);
    }
    coverBusy = false;
  }

  // ---------- проблемы ----------

  async function refreshIssues() {
    if (issuesLoading) return;
    issuesLoading = true;
    try {
      issues = await TagDiagnostics(allTracks) || [];
      issuesLoaded = true;
    } catch (e) {
      console.error(e);
    }
    issuesLoading = false;
  }

  const ISSUE_ORDER = ['no-title', 'empty-artist', 'unknown-artist', 'no-cover', 'junk-field', 'lower-title'];

  $: issueCounts = (() => {
    const c = {};
    for (const i of issues) for (const code of i.issues) c[code] = (c[code] || 0) + 1;
    return c;
  })();
  $: tracksById = new Map(allTracks.map((t) => [t.id, t]));

  function trackWith(code) {
    const ids = new Set(issues.filter((i) => i.issues.includes(code)).map((i) => i.trackId));
    return allTracks.filter((t) => ids.has(t.id));
  }

  function cleanJunk(s) {
    if (!s) return s;
    return s.replace(/[\u200b\ufeff\u00ad]/g, '').replace(/\s+/g, ' ').trim();
  }

  function capitalize(s) {
    if (!s) return s;
    const i = s.search(/\S/);
    if (i < 0) return s;
    return s.slice(0, i) + s[i].toUpperCase() + s.slice(i + 1);
  }

  async function runFix(list, fieldsOf, what) {
    if (writeBusy || list.length === 0) return;
    const edits = [];
    let blocked = 0;
    for (const t of list) {
      if (blockedPath && t.path === blockedPath) { blocked++; continue; }
      edits.push({ path: t.path, fields: fieldsOf(t) });
    }
    if (edits.length === 0) {
      showToast(blocked > 0 ? fmt(tr('Сначала переключите этот трек: {0}'), baseName(blockedPath)) : tr('Нечего чинить'));
      return;
    }
    writeBusy = true;
    try {
      const res = await WriteTags(edits, allTracks);
      applyResult(res, edits.length);
      showToast(fmt(tr('Готово: {0}'), what));
    } catch (e) {
      console.error(e);
      showToast(tr('Не удалось записать теги'));
    }
    writeBusy = false;
  }

  const fixJunk = () => runFix(
    trackWith('junk-field'),
    (t) => ({
      title: cleanJunk(t.title) !== t.title ? cleanJunk(t.title) : t.title,
      artist: cleanJunk(t.artist) !== t.artist ? cleanJunk(t.artist) : t.artist,
      album: cleanJunk(t.album) !== t.album ? cleanJunk(t.album) : t.album,
    }),
    tr('лишние пробелы вычищены')
  );

  const fixCase = () => runFix(
    trackWith('lower-title'),
    (t) => ({ title: capitalize(t.title) }),
    tr('заглавные буквы проставлены')
  );

  function pick(id) {
    dispatch('pick', [id]);
    setTab('edit');
  }

  function issueLabel(code) {
    const map = {
      'no-title': 'название = имя файла',
      'empty-artist': 'пустой исполнитель',
      'unknown-artist': 'неизвестный исполнитель',
      'no-cover': 'нет обложки',
      'junk-field': 'лишние пробелы/символы',
      'lower-title': 'строчная первая буква',
    };
    return tt(map[code] || code);
  }
</script>

<aside class="tagedit" aria-label="{tt('Теги')}">
  <div class="te-head">
    <h3>{tt('Теги')}{#if count > 0}<span class="te-count">{count}</span>{/if}</h3>
    <div class="te-head-actions">
      {#if count > 0 && count < allTracks.length}
        <button class="te-ghost" on:click={() => dispatch('selectAll')}>{fmt(tt('выделить все ({0})'), allTracks.length)}</button>
      {/if}
      <button class="te-close" on:click={() => dispatch('close')} title="{tt('Закрыть')}">✕</button>
    </div>
  </div>

  <div class="te-tabs">
    <button class:active={tab === 'edit'} on:click={() => setTab('edit')}>{tt('Правка')}</button>
    <button class:active={tab === 'issues'} on:click={() => setTab('issues')}>
      {tt('Проблемы')}{#if issuesLoaded && issues.length > 0}<span class="te-count">{issues.length}</span>{/if}
    </button>
  </div>

  {#if tab === 'edit'}
    <div class="te-body">
      {#if count === 0}
        <p class="te-hint">{tt('Выделите треки: Ctrl+клик — добавить, Shift — диапазон. Правый клик — «Редактировать теги».')}</p>
      {:else}
        {#if blockedSelected}
          <div class="te-warn">{fmt(tt('Сейчас играет — его файл не будет записан: {0}'), baseName(blockedPath))}</div>
        {/if}
        {#if count > 1}
          <div class="te-hint">{tt('Мультирежим: пустые поля не трогаются.')}</div>
        {/if}
        {#if loading}
          <p class="te-hint">…</p>
        {:else}
          {#if count === 1 && details && !details.writable}
            <div class="te-warn">{tt('Этот формат — только чтение, запись недоступна')}</div>
          {/if}
          <label class="te-field">
            <span>{tt('Название')}</span>
            <input type="text" bind:value={form.title} placeholder={count > 1 ? tt('не трогать') : ''} />
          </label>
          <label class="te-field">
            <span>{tt('Исполнитель')}</span>
            <input type="text" bind:value={form.artist} placeholder={count > 1 ? tt('не трогать') : ''} />
          </label>
          <label class="te-field">
            <span>{tt('Альбом')}</span>
            <input type="text" bind:value={form.album} placeholder={count > 1 ? tt('не трогать') : ''} />
          </label>
          <div class="te-row">
            <label class="te-field">
              <span>{tt('Год')}</span>
              <input type="text" bind:value={form.year} placeholder={count > 1 ? tt('не трогать') : ''} />
            </label>
            <label class="te-field">
              <span>{tt('Номер трека')}</span>
              <input type="text" bind:value={form.track} placeholder={count > 1 ? tt('не трогать') : ''} />
            </label>
          </div>
          <label class="te-field">
            <span>{tt('Жанр')}</span>
            <input type="text" bind:value={form.genre} placeholder={count > 1 ? tt('не трогать') : ''} />
          </label>
          {#if count === 1 && details}
            <div class="te-cover">
              <div class="te-cover-thumb" class:empty={!details.cover}>
                {#if details.cover}
                  <img src={details.cover} alt="" />
                {:else}
                  <span>{tt('Нет обложки')}</span>
                {/if}
              </div>
              <div class="te-cover-meta">
                <span class="te-cover-label">{tt('Обложка')}</span>
                {#if details.writable}
                  <div class="te-cover-btns">
                    <button class="te-mini" on:click={changeCover} disabled={coverBusy || writeBusy}>{tt('Сменить')}</button>
                    <button class="te-mini danger" on:click={removeCover} disabled={coverBusy || writeBusy || !details.hasCover}>{tt('Удалить')}</button>
                  </div>
                {:else}
                  <span class="te-cover-ro">{tt('только чтение')}</span>
                {/if}
              </div>
            </div>
          {:else if count > 1}
            <div class="te-hint">{tt('Обложку можно менять для одного выделенного трека.')}</div>
          {/if}
        {/if}

        {#if lastErrors.length > 0}
          <div class="te-errors">
            <div class="te-errors-head">{tt('Не удалось записать:')}</div>
            {#each lastErrors as err (err.path)}
              <div class="te-error" title={err.path}><b>{baseName(err.path)}</b> — {err.error}</div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
    <div class="te-foot">
      <button class="te-ghost" disabled={writeBusy} on:click={undo}>{tt('Откатить последнее')}</button>
      <button class="te-primary" disabled={writeBusy || count === 0} on:click={write}>
        {writeBusy ? tt('Запись…') : fmt(tt('Записать в {0} файлов'), count)}
      </button>
    </div>
  {:else}
    <div class="te-body">
      {#if !issuesLoaded}
        <button class="te-ghost" disabled={issuesLoading} on:click={refreshIssues}>{issuesLoading ? tt('Сканирование…') : tt('Проверить теги')}</button>
      {:else if issues.length === 0}
        <p class="te-hint ok">✓ {tt('Проблем не найдено')}</p>
      {:else}
        <div class="te-fixes">
          {#if (issueCounts['junk-field'] || 0) > 0}
            <button class="te-ghost" disabled={writeBusy} on:click={fixJunk}>
              {fmt(tt('Чистка пробелов ({0})'), issueCounts['junk-field'])}
            </button>
          {/if}
          {#if (issueCounts['lower-title'] || 0) > 0}
            <button class="te-ghost" disabled={writeBusy} on:click={fixCase}>
              {fmt(tt('Сначала заглавная ({0})'), issueCounts['lower-title'])}
            </button>
          {/if}
          <button class="te-ghost" on:click={refreshIssues}>{tt('Обновить')}</button>
        </div>
        <div class="te-issue-list">
          {#each issues as it (it.trackId)}
            {@const t = tracksById.get(it.trackId)}
            <button class="te-issue" on:click={() => pick(it.trackId)}>
              <span class="te-issue-title">{t ? t.title : it.path}</span>
              <span class="te-issue-codes">
                {#each ISSUE_ORDER as code}
                  {#if it.issues.includes(code)}
                    <span class="te-badge" class:soft={code === 'no-cover'}>{issueLabel(code)}</span>
                  {/if}
                {/each}
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="te-foot">
      <button class="te-ghost" disabled={writeBusy} on:click={undo}>{tt('Откатить последнее')}</button>
    </div>
  {/if}
</aside>

<style>
  .tagedit {
    position: absolute; top: 0; right: 0; bottom: 0; z-index: 60;
    width: min(360px, 94%);
    display: flex; flex-direction: column;
    background: var(--menu-bg, #17171c);
    border-left: 1px solid var(--border, rgba(127,127,127,0.25));
    box-shadow: -14px 0 36px rgba(0, 0, 0, 0.4);
    border-radius: 0 0 0 14px;
  }
  .te-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px 8px; }
  .te-head h3 { margin: 0; font-size: 15px; display: flex; align-items: center; gap: 8px; }
  .te-count { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: rgba(var(--accent-rgb), 0.25); color: var(--text); font-size: 11px; font-weight: 700; }
  .te-head-actions { display: flex; align-items: center; gap: 6px; }
  .te-close { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--muted, #aaa); cursor: pointer; font-size: 14px; }
  .te-close:hover { background: rgba(127,127,127,0.18); color: var(--text); }
  .te-tabs { display: flex; gap: 6px; padding: 0 14px 10px; }
  .te-tabs button { flex: 1; padding: 7px 10px; border: 1px solid var(--border, rgba(127,127,127,0.25)); border-radius: 10px; background: transparent; color: var(--muted, #aaa); font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: 0.15s ease; }
  .te-tabs button.active { border-color: rgba(var(--accent-rgb), 0.55); background: rgba(var(--accent-rgb), 0.14); color: var(--text); }
  .te-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 14px 12px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; }
  .te-hint { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--muted, #aaa); }
  .te-hint.ok { color: #6fdc8c; font-size: 14px; }
  .te-warn { font-size: 12.5px; line-height: 1.5; padding: 8px 10px; border-radius: 10px; background: rgba(230, 160, 40, 0.14); border: 1px solid rgba(230, 160, 40, 0.4); color: #ffd899; }
  .te-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .te-field span { font-size: 11px; color: var(--muted, #aaa); text-transform: uppercase; letter-spacing: 0.04em; }
  .te-field input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border, rgba(127,127,127,0.3)); border-radius: 10px; background: rgba(127,127,127,0.14); color: var(--text, #fff); font-size: 13.5px; outline: none; transition: border-color 0.15s ease; }
  .te-field input:focus { border-color: rgba(var(--accent-rgb), 0.6); }
  .te-field input::placeholder { color: rgba(127,127,127,0.7); font-style: italic; }
  .te-row { display: flex; gap: 10px; }
  .te-foot { display: flex; gap: 8px; padding: 10px 14px 14px; border-top: 1px solid rgba(127,127,127,0.15); }
  .te-foot button { padding: 9px 12px; border-radius: 11px; font-size: 13px; cursor: pointer; transition: 0.15s ease; }
  .te-ghost { border: 1px solid var(--border, rgba(127,127,127,0.3)); background: transparent; color: var(--muted, #aaa); }
  .te-ghost:hover:not(:disabled) { color: var(--text); border-color: rgba(var(--accent-rgb), 0.45); }
  .te-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
  .te-primary { flex: 1; border: 1px solid rgba(var(--accent-rgb), 0.55); background: linear-gradient(rgba(var(--accent-rgb), 0.28), rgba(var(--accent-rgb), 0.28)), var(--button-bg, #222); color: var(--text, #fff); font-weight: 600; }
  .te-primary:hover:not(:disabled) { background: linear-gradient(rgba(var(--accent-rgb), 0.42), rgba(var(--accent-rgb), 0.42)), var(--button-bg, #222); }
  .te-primary:disabled { opacity: 0.55; cursor: not-allowed; }
  .te-errors { border: 1px solid rgba(230, 57, 70, 0.45); background: rgba(230, 57, 70, 0.1); border-radius: 10px; padding: 8px 10px; }
  .te-errors-head { font-size: 12px; font-weight: 600; color: #ff9aa5; margin-bottom: 4px; }
  .te-error { font-size: 12px; color: var(--muted, #ccc); line-height: 1.45; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .te-fixes { display: flex; flex-wrap: wrap; gap: 6px; }
  .te-fixes .te-ghost { padding: 6px 10px; border-radius: 999px; font-size: 12px; }
  .te-issue-list { display: flex; flex-direction: column; gap: 6px; }
  .te-issue { display: flex; flex-direction: column; gap: 5px; align-items: flex-start; text-align: left; padding: 8px 10px; border: 1px solid rgba(127,127,127,0.2); border-radius: 10px; background: rgba(127,127,127,0.10); cursor: pointer; transition: 0.15s ease; }
  .te-issue:hover { border-color: rgba(var(--accent-rgb), 0.45); background: rgba(var(--accent-rgb), 0.08); }
  .te-issue-title { font-size: 13px; font-weight: 600; color: var(--text); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .te-issue-codes { display: flex; flex-wrap: wrap; gap: 4px; }
  .te-badge { font-size: 10.5px; padding: 2px 7px; border-radius: 999px; background: rgba(230, 57, 70, 0.16); border: 1px solid rgba(230, 57, 70, 0.4); color: #ff9aa5; }
  .te-badge.soft { background: rgba(127,127,127,0.14); border-color: rgba(127,127,127,0.4); color: var(--muted, #bbb); }
  .te-cover { display: flex; gap: 10px; align-items: center; padding: 8px; margin-top: 2px; border: 1px solid var(--border, rgba(127,127,127,0.2)); border-radius: 12px; background: rgba(127,127,127,0.06); }
  .te-cover-thumb { width: 64px; height: 64px; flex: 0 0 64px; border-radius: 8px; overflow: hidden; background: var(--item-bg, rgba(127,127,127,0.12)); display: flex; align-items: center; justify-content: center; }
  .te-cover-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .te-cover-thumb span { font-size: 10px; line-height: 1.3; color: var(--muted, #999); text-align: center; padding: 0 4px; }
  .te-cover-meta { min-width: 0; }
  .te-cover-label { display: block; font-size: 12px; color: var(--muted, #999); margin-bottom: 6px; }
  .te-cover-ro { font-size: 11px; color: var(--muted, #999); }
  .te-cover-btns { display: flex; gap: 6px; }
  .te-mini { padding: 5px 12px; font-size: 12px; border: 1px solid var(--border, rgba(127,127,127,0.3)); border-radius: 8px; background: transparent; color: var(--text); cursor: pointer; transition: 0.15s ease; }
  .te-mini:hover:enabled { border-color: rgba(var(--accent-rgb), 0.55); }
  .te-mini.danger:hover:enabled { border-color: #e63946; color: #e63946; }
  .te-mini:disabled { opacity: 0.45; cursor: default; }
</style>
