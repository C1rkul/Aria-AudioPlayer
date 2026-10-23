// Мелкое межстраничное состояние интерфейса.
import { writable } from 'svelte/store';

// Вкладка плеера, которую нужно открыть при переходе на страницу «Плеер» ('pl:<id>' | 'local' | null).
export const pendingPlayerTab = writable(null);
