// Провайдер для локальных файлов
export const LocalSource = {
  id: 'local',
  name: 'Локальная библиотека',
  
  // Проверка, может ли этот источник обработать данный объект трека
  canHandle(track) {
    return track.source === 'local';
  },

  // Получить URL для аудио элемента
  getStreamUrl(track, baseUrl) {
    if (!baseUrl) throw new Error('Stream base URL not provided');
    return `${baseUrl}/stream?path=${encodeURIComponent(track.path)}`;
  },

  // Получить URL обложки
  getCoverUrl(track, baseUrl) {
    if (!track.coverPath || !baseUrl) return null;
    return `${baseUrl}/cover?path=${encodeURIComponent(track.coverPath)}`;
  }
};