import { writable } from 'svelte/store';

// Небольшое всплывающее уведомление внизу окна (например, «Добавлено треков: 5»)
export const toast = writable('');
let timer;

export function showToast(message, ms = 2600) {
  toast.set(message);
  clearTimeout(timer);
  timer = setTimeout(() => toast.set(''), ms);
}
