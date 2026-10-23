// Статистика прослушивания. Считается на фронтенде (из timeupdate плеера), хранится в localStorage.
// Listening statistics: counted in the frontend, persisted in localStorage.
import { writable, get } from 'svelte/store';
import { playlists } from './playlists.js';

const KEY = 'aria.stats.v1';
const PLAY_THRESHOLD = 10; // столько секунд нужно послушать, чтобы засчитать «прослушивание»

function emptyData() {
  return {
    firstLaunch: Date.now(),
    launches: 0,
    totalSec: 0,
    plays: 0,
    tracks: {},    // id -> { sec, plays, title, artist, last }
    playlists: {}  // id -> { sec, plays, name, last }
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') return { ...emptyData(), ...raw, tracks: raw.tracks || {}, playlists: raw.playlists || {} };
  } catch (e) { /* нет localStorage или битые данные — начинаем с нуля */ }
  return emptyData();
}

let data = load();
let sessionSec = 0; // прослушано с момента этого запуска

// Публичный снимок для интерфейса (обновляется не чаще раза в секунду)
export const stats = writable(snapshot());

function snapshot() {
  return { ...data, sessionSec };
}

let publishTimer = 0;
function publish() {
  if (publishTimer) return;
  publishTimer = setTimeout(() => { publishTimer = 0; stats.set(snapshot()); }, 1000);
}

let saveTimer = 0;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(flushStats, 5000);
}

/** Немедленно записать статистику на диск (вызывается и при закрытии окна). */
export function flushStats() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushStats);
  window.addEventListener('pagehide', flushStats);
}

/** Один раз за запуск приложения. */
export function registerLaunch() {
  data.launches += 1;
  flushStats();
  stats.set(snapshot());
}

// Текущее «прослушивание» (один проход трека): когда набрали порог — считаем +1 прослушивание
let curTrackId = null;
let curAccum = 0;
let curCounted = false;

/** Начать отсчёт прослушивания заново (трек доигран / начат повтор). */
export function resetListen() {
  curTrackId = null;
  curAccum = 0;
  curCounted = false;
}

/** Добавить dt секунд прослушивания трека. sourceId — откуда играет (id плейлиста или 'all'/'custom'/...). */
export function recordListen(track, sourceId, dt) {
  if (!track || !(dt > 0)) return;
  if (track.id !== curTrackId) { curTrackId = track.id; curAccum = 0; curCounted = false; }

  const now = Date.now();
  const t = data.tracks[track.id] || (data.tracks[track.id] = { sec: 0, plays: 0, title: '', artist: '', last: 0 });
  t.title = track.title || t.title || 'Unknown Title';
  t.artist = track.artist || t.artist || '';
  t.sec += dt;
  t.last = now;

  const pl = sourceId ? get(playlists).find((p) => p.id === sourceId) : null;
  let p = null;
  if (pl) {
    p = data.playlists[pl.id] || (data.playlists[pl.id] = { sec: 0, plays: 0, name: '', last: 0 });
    p.name = pl.name;
    p.sec += dt;
    p.last = now;
  }

  data.totalSec += dt;
  sessionSec += dt;
  curAccum += dt;

  const need = track.duration > 0 ? Math.min(PLAY_THRESHOLD, track.duration / 2) : PLAY_THRESHOLD;
  if (!curCounted && curAccum >= need) {
    curCounted = true;
    t.plays += 1;
    data.plays += 1;
    if (p) p.plays += 1;
  }

  publish();
  save();
}

/** Полный сброс (кнопка на странице статистики). Счётчик запусков и сеанс сохраняются. */
export function resetStats() {
  const launches = data.launches;
  data = emptyData();
  data.launches = launches;
  sessionSec = 0;
  resetListen();
  flushStats();
  stats.set(snapshot());
}
