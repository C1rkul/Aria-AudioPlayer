import { get } from 'svelte/store';
import { tracks, currentIndex, currentTrack, persistTracks } from '../stores/player.js';
import { playerController } from './player-controller.js';

/**
 * Заменяет список библиотеки (после перескана папок или удаления папки):
 * сохраняет текущий трек и его позицию; если текущего трека больше нет —
 * останавливает воспроизведение.
 */
export function applyLibraryList(list) {
  const curId = get(currentTrack)?.id;
  tracks.set(list);
  persistTracks(list);
  const idx = curId ? list.findIndex((t) => t.id === curId) : -1;
  if (idx >= 0) {
    currentIndex.set(idx);
  } else if (get(currentIndex) >= 0) {
    playerController.stop();
    currentIndex.set(-1);
  }
}
