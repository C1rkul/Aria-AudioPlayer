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