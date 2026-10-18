import { writable } from 'svelte/store';
import { SaveSettings } from '../../wailsjs/go/main/App';

export const defaultSettings = {
  theme: 'dark',
  design: 'normal',
  background: 'none',
  palette: 'base',
  adaptiveBackground: false,
  neonFrame: true,
  particleCount: 60,
  babbleCount: 22,
  matrixSpeed: 1,
  matrixDensity: 100,
  auroraCount: 5,
  lyricsApiUrl: '',
  customAccent: '#7c5cff',
  defaultVolume: 0.5,
  restoreLastTrack: false,
  dataFolder: '',
  lastTrackId: '',
  lastPosition: 0
};

export const settings = writable({ ...defaultSettings });

let saveTimer;

export function persistSettings(value) {
  clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    SaveSettings(value)
      .then((saved) => {
        if (saved) {
          settings.set({ ...defaultSettings, ...saved });
        }
      })
      .catch((err) => {
        console.error('Не удалось сохранить настройки:', err);
      });
  }, 350);
}

export function updateSettings(patch) {
  settings.update((current) => {
    const next = { ...current, ...patch };
    persistSettings(next);
    return next;
  });
}