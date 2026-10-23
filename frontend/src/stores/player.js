import { writable, derived } from 'svelte/store';
import { SaveTracks } from '../../wailsjs/go/main/App';

export const tracks = writable([]);
export const currentIndex = writable(-1);

export const currentTrack = derived(
  [tracks, currentIndex],
  ([$tracks, $currentIndex]) => {
    if ($currentIndex < 0 || $currentIndex >= $tracks.length) return null;
    return $tracks[$currentIndex];
  }
);

export const isPlaying = writable(false);
export const repeatMode = writable('off'); // 'off', 'all', 'one'
export const shuffleEnabled = writable(false);

let saveTimer;

export function persistTracks(list) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    SaveTracks(list)
      .then(() => {})
      .catch((err) => console.error('Не удалось сохранить треки:', err));
  }, 500);
}

export function updateTrackDuration(id, duration) {
  tracks.update((current) => {
    const updated = current.map((track) =>
      track.id === id ? { ...track, duration } : track
    );
    persistTracks(updated);
    return updated;
  });
}

const normPath = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

/** Добавляет треки, пропуская те, что уже есть в списке (по пути). Возвращает, сколько добавлено. */
export function addTracksDedup(newTracks) {
  let added = 0;
  tracks.update((current) => {
    const seen = new Set(current.map((t) => normPath(t.path)));
    const fresh = [];
    for (const t of newTracks || []) {
      const key = normPath(t.path);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(t);
    }
    added = fresh.length;
    if (!added) return current;
    const updated = [...current, ...fresh];
    persistTracks(updated);
    return updated;
  });
  return added;
}

/** Перемещает трек из позиции from в позицию to; текущий играющий трек остаётся тем же. */
export function moveTrack(from, to) {
  if (from === to) return;
  let list = [];
  tracks.update((current) => {
    list = current.slice();
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    return list;
  });
  currentIndex.update((ci) => {
    if (ci === from) return to;
    if (from < ci && to >= ci) return ci - 1;
    if (from > ci && to <= ci) return ci + 1;
    return ci;
  });
  persistTracks(list);
}
