// Плейлисты и очередь воспроизведения. Плейлист хранит только id треков библиотеки.
// Playlists and the playback queue. A playlist stores only library track ids.
import { writable, get } from 'svelte/store';
import { LoadPlaylistsData, SavePlaylistsData } from '../../wailsjs/go/main/App';

export const ALL_ID = 'all'; // «Все песни» — это библиотека, а не плейлист / the library, not a playlist

export const playlists = writable([]);
export const queue = writable({ sourceId: ALL_ID, trackIds: [], index: -1 });
export const playlistsLoaded = writable(false);

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    SavePlaylistsData({ playlists: get(playlists), queue: get(queue) })
      .catch((err) => console.error('Не удалось сохранить плейлисты:', err));
  }, 400);
}

const newId = () => 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function loadPlaylists() {
  try {
    const data = await LoadPlaylistsData();
    playlists.set(Array.isArray(data?.playlists) ? data.playlists.map((p) => ({ ...p, trackIds: p.trackIds || [] })) : []);
    const q = data?.queue;
    queue.set({
      sourceId: q?.sourceId || ALL_ID,
      trackIds: Array.isArray(q?.trackIds) ? q.trackIds : [],
      index: Number.isInteger(q?.index) ? q.index : -1,
    });
  } catch (err) {
    console.error('Не удалось загрузить плейлисты:', err);
  } finally {
    playlistsLoaded.set(true);
  }
}

// --- плейлисты / playlists ---

export function createPlaylist(name) {
  const pl = { id: newId(), name: (name || '').trim() || 'Новый плейлист', trackIds: [], createdAt: Date.now() };
  playlists.update((l) => [...l, pl]);
  persist();
  return pl;
}

export function renamePlaylist(id, name) {
  const n = (name || '').trim();
  if (!n) return;
  playlists.update((l) => l.map((p) => (p.id === id ? { ...p, name: n } : p)));
  persist();
}

export function deletePlaylist(id) {
  playlists.update((l) => l.filter((p) => p.id !== id));
  // очередь, собранная из удалённого плейлиста, остаётся как есть, но больше ни к чему не привязана
  queue.update((q) => (q.sourceId === id ? { ...q, sourceId: ALL_ID } : q));
  persist();
}

/** Добавляет треки в плейлист без повторов. Возвращает, сколько добавлено. */
export function addToPlaylist(id, trackIds) {
  let added = 0;
  playlists.update((l) =>
    l.map((p) => {
      if (p.id !== id) return p;
      const have = new Set(p.trackIds);
      const fresh = [];
      for (const t of trackIds || []) if (!have.has(t)) { have.add(t); fresh.push(t); }
      added = fresh.length;
      return added ? { ...p, trackIds: [...p.trackIds, ...fresh] } : p;
    })
  );
  if (added) persist();
  return added;
}

export function removeFromPlaylist(id, trackId) {
  playlists.update((l) => l.map((p) => (p.id === id ? { ...p, trackIds: p.trackIds.filter((t) => t !== trackId) } : p)));
  persist();
}

export function moveInPlaylist(id, from, to) {
  if (from === to) return;
  playlists.update((l) =>
    l.map((p) => {
      if (p.id !== id) return p;
      const ids = p.trackIds.slice();
      const [item] = ids.splice(from, 1);
      ids.splice(to, 0, item);
      return { ...p, trackIds: ids };
    })
  );
  persist();
}

/** Трек удалён из библиотеки — убираем его отовсюду. */
export function forgetTrack(trackId) {
  playlists.update((l) => l.map((p) => ({ ...p, trackIds: p.trackIds.filter((t) => t !== trackId) })));
  queue.update((q) => {
    const pos = q.trackIds.indexOf(trackId);
    if (pos === -1) return q;
    const ids = q.trackIds.filter((t) => t !== trackId);
    let index = q.index;
    if (pos < index) index -= 1;
    else if (pos === index) index = -1;
    return { ...q, trackIds: ids, index };
  });
  persist();
}

// --- очередь / queue ---

/** Ставит очередь (источник + список id + позиция играющего трека). */
export function setQueue(sourceId, trackIds, index = -1) {
  queue.set({ sourceId: sourceId || ALL_ID, trackIds: trackIds.slice(), index });
  persist();
}

export function setQueueIndex(index) {
  queue.update((q) => (q.index === index ? q : { ...q, index }));
  persist();
}

/** Библиотека очищена: плейлисты остаются, но без треков; очередь пуста. */
export function clearTrackRefs() {
  playlists.update((l) => l.map((p) => ({ ...p, trackIds: [] })));
  queue.set({ sourceId: ALL_ID, trackIds: [], index: -1 });
  persist();
}
