// ЗАГОТОВКА: поиск текста песни через внешний API.
// Пока выключено — сетевые запросы не выполняются. Чтобы включить в будущем:
//   1) поставить LYRICS_ENABLED = true (и разблокировать поле в настройках),
//   2) в settings.lyricsApiUrl указать шаблон ссылки, например:
//        https://api.lyrics.ovh/v1/{artist}/{title}
//   3) при необходимости подправить parseLyricsResponse под формат ответа API.
// Если API не отдаёт CORS-заголовки, запрос лучше делать из Go (http.Get) через биндинг.

export const LYRICS_ENABLED = false;

/** Подставляет исполнителя и название в шаблон ссылки. */
export function buildLyricsUrl(template, track) {
  if (!template || !track) return '';
  const enc = (v) => encodeURIComponent((v || '').trim());
  return template
    .replaceAll('{artist}', enc(track.artist))
    .replaceAll('{title}', enc(track.title))
    .replaceAll('{album}', enc(track.album));
}

/** Достаёт текст из ответа API. Понимает JSON с полями lyrics/text/plainLyrics и обычный текст. */
export function parseLyricsResponse(raw) {
  if (raw == null) return '';
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return raw.trim(); }
  }
  if (typeof data === 'string') return data.trim();
  const candidates = [data.lyrics, data.plainLyrics, data.text, data.result?.lyrics, data.data?.lyrics];
  const found = candidates.find((v) => typeof v === 'string' && v.trim());
  return found ? found.replace(/\r\n/g, '\n').trim() : '';
}

/**
 * Возвращает { status, text }.
 * status: 'disabled' | 'no-api' | 'found' | 'none' | 'error'
 */
export async function fetchLyrics(track, apiTemplate) {
  if (!LYRICS_ENABLED) return { status: 'disabled', text: '' };
  if (!apiTemplate) return { status: 'no-api', text: '' };
  try {
    const res = await fetch(buildLyricsUrl(apiTemplate, track));
    if (!res.ok) return { status: 'none', text: '' };
    const text = parseLyricsResponse(await res.text());
    return text ? { status: 'found', text } : { status: 'none', text: '' };
  } catch (e) {
    console.warn('Lyrics fetch failed:', e);
    return { status: 'error', text: '' };
  }
}
