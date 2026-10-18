// ЗАГОТОВКА для будущего внешнего API (Spotify, Radio, etc.)
export const ExternalSource = {
  id: 'external',
  name: 'Внешние источники',
  
  canHandle(track) {
    return track.source === 'external' || track.url !== undefined;
  },

  getStreamUrl(track) {
    // Здесь в будущем будет логика получения временного токена или прямой ссылки
    // Например: fetch(`/api/get-stream-token?url=${track.url}`).then(res => res.data.token)
    console.warn('External source playback is coming soon');
    return track.url; // Пока просто возвращаем ссылку, если она есть
  },

  getCoverUrl(track) {
    return track.coverUrl || null;
  }
};