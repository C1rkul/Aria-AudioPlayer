// Горячие клавиши плеера: работают по всему окну, кроме полей ввода.
// Медиа-клавиши ОС дополнительно идут через MediaSession API (см. player-controller).
import { get } from 'svelte/store';
import { playerController } from './player-controller.js';

const VOL_STEP = 0.05;

function isEditable(el) {
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

function bumpVolume(delta) {
  const v = Math.min(1, Math.max(0, get(playerController.volume) + delta));
  playerController.setVolume(v);
}

export function installHotkeys() {
  const onKey = (e) => {
    // Медиа-клавиши (если доходят до окна)
    if (e.key === 'MediaPlayPause') { e.preventDefault(); playerController.togglePlay(); return; }
    if (e.key === 'MediaNextTrack') { e.preventDefault(); playerController.next(); return; }
    if (e.key === 'MediaPrevTrack') { e.preventDefault(); playerController.prev(); return; }

    // Ctrl/Cmd/Alt + стрелки: треки и громкость (в полях ввода не перехватываем)
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if (isEditable(e.target)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); playerController.next(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); playerController.prev(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); bumpVolume(VOL_STEP); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); bumpVolume(-VOL_STEP); return; }
      return;
    }

    // Пробел — пуск/пауза (не в полях ввода и не на кнопках — там это нативный клик)
    if (e.key === ' ' || e.key === 'Spacebar') {
      if (isEditable(e.target)) return;
      if (e.target && e.target.closest && e.target.closest('button, a, [role="button"]')) return;
      e.preventDefault();
      playerController.togglePlay();
    }
  };

  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
