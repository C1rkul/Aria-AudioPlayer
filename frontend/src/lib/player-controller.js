import { writable, get } from 'svelte/store';
import { tracks as tracksStore, currentIndex as currentIdxStore, isPlaying as playingStore, repeatMode, shuffleEnabled, updateTrackDuration } from '../stores/player.js';
import { getSourceProvider } from './sources/index.js';
import { ReadFileAsDataURL } from '../../wailsjs/go/main/App'; // <-- Импорт Go функции

class PlayerController {
  constructor() {
    this.audioElement = null;
    this.streamBaseUrl = '';
    
    // Состояния внутри контроллера
    this.currentTime = writable(0);
    this.duration = writable(0);
    this.isLoading = writable(false);
    this.loadedSrc = writable(''); // Храним именно URL источника
    
    this.pendingPosition = 0;
    this.saveTimer = null;
    this.startPaused = false; // следующий загружаемый трек не стартует автоматически
  }

  init(audioEl, baseUrl) {
    this.audioElement = audioEl;
    this.streamBaseUrl = baseUrl;
    // нужно для Web Audio (стрим идёт с другого origin, CORS у сервера открыт)
    this.audioElement.crossOrigin = 'anonymous';
    
    // Слушатели событий аудио
    this.audioElement.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.audioElement.addEventListener('loadedmetadata', () => this.onLoadedMetadata());
    this.audioElement.addEventListener('ended', () => this.onEnded());
    this.audioElement.addEventListener('play', () => playingStore.set(true));
    this.audioElement.addEventListener('pause', () => playingStore.set(false));
  }

  async playTrack(track) {
    if (!this.audioElement || !track) return;

    const provider = getSourceProvider(track);
    let src = '';

    try {
      // 1. Пробуем получить URL от провайдера (обычно это http://127.0.0.1.../stream...)
      src = provider.getStreamUrl(track, this.streamBaseUrl);
      
      // 2. Если провайдер вернул пустую строку или ошибку (например, нет streamBase), 
      // используем fallback через Go (base64 data URL)
      if (!src) {
        console.warn("Стрим недоступен, переключаемся на base64 fallback");
        src = await ReadFileAsDataURL(track.path);
      }

      if (!src) throw new Error("Не удалось получить источник звука");

      // Если пользователь поставил паузу и переключил трек — новый трек тоже загружается на паузе
      const startPaused = this.startPaused;
      this.startPaused = false;

      // Тот же источник уже загружен — ничего не перезапускаем и состояние паузы не трогаем
      if (get(this.loadedSrc) === src) return;

      this.isLoading.set(true);
      this.audioElement.src = src;
      this.loadedSrc.set(src);

      // Применяем громкость перед стартом
      this.applyCurrentVolume();

      if (startPaused) {
        this.audioElement.pause();
        this.isLoading.set(false);
        return;
      }

      await this.audioElement.play();
      this.isLoading.set(false);

    } catch (err) {
      this.isLoading.set(false);
      // AbortError — быстрое переключение треков, NotAllowedError — автозапуск без клика: не ошибки
      if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
      console.error("Playback error:", err);
      alert("Ошибка воспроизведения: " + err.message);
    }
  }

  // Анализатор для визуализатора (создаётся лениво, при первом обращении)
  getAnalyser() {
    if (this.analyser) return this.analyser;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new Ctx();
      const srcNode = this.audioCtx.createMediaElementSource(this.audioElement);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      srcNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
    } catch (e) {
      console.warn('Visualizer unavailable:', e);
      this.analyser = null;
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
    return this.analyser;
  }

  applyCurrentVolume() {
     // Громкость берется из глобального стора settings, но чтобы не создавать циклическую зависимость,
     // мы будем устанавливать её напрямую из App.svelte при инициализации и изменении.
     // Здесь просто убеждаемся, что volume применена к элементу.
     if(this.audioElement && this._targetVolume !== undefined) {
         this.audioElement.volume = Math.max(0, Math.min(1, this._targetVolume * this._targetVolume));
     }
  }

  setVolume(vol) { this.setTargetVolume(vol); }

  setTargetVolume(vol) {
      this._targetVolume = vol;
      this.applyCurrentVolume();
  }

  togglePlay() {
    if (!this.audioElement) return;
    // Ничего не выбрано — запускаем первый трек списка
    if (!this.audioElement.src || get(currentIdxStore) < 0) {
      if (get(tracksStore).length > 0) currentIdxStore.set(0);
      return;
    }
    if (this.audioElement.paused) {
      this.audioElement.play().catch((e) => console.warn('play() rejected:', e));
    } else {
      this.audioElement.pause();
    }
  }

  seek(percent) {
    if (!this.audioElement || !get(this.duration)) return;
    const time = (percent / 100) * get(this.duration);
    this.audioElement.currentTime = time;
    this.currentTime.set(time);
  }

  // Пользователь нажал «следующий/предыдущий»: если играла пауза — остаёмся на паузе
  rememberPause() {
    this.startPaused = !!(this.audioElement && this.audioElement.src && this.audioElement.paused);
  }

  pickNext() {
    const idx = get(currentIdxStore);
    const total = get(tracksStore).length;
    if (total === 0) return null;

    if (get(shuffleEnabled)) {
      let nextIdx;
      do {
        nextIdx = Math.floor(Math.random() * total);
      } while (nextIdx === idx && total > 1);
      return nextIdx;
    }
    let nextIdx = idx + 1;
    if (nextIdx >= total) {
      if (get(repeatMode) === 'all') nextIdx = 0;
      else return -1; // конец списка
    }
    return nextIdx;
  }

  goTo(nextIdx) {
    if (get(currentIdxStore) === nextIdx) {
      // единственный трек (или выпал тот же при повторе) — просто проигрываем сначала
      this.audioElement.currentTime = 0;
      this.currentTime.set(0);
      if (!this.startPaused) this.audioElement.play().catch(() => {});
      this.startPaused = false;
      return;
    }
    currentIdxStore.set(nextIdx);
  }

  next() {
    const nextIdx = this.pickNext();
    if (nextIdx === null) return;
    if (nextIdx === -1) { this.stop(); return; }
    this.rememberPause();
    this.goTo(nextIdx);
  }

  prev() {
    // Как в большинстве плееров: если трек играет дольше 3 секунд — перематываем в начало
    if (this.audioElement && this.audioElement.currentTime > 3) {
      this.audioElement.currentTime = 0;
      this.currentTime.set(0);
      return;
    }
    const idx = get(currentIdxStore);
    const total = get(tracksStore).length;
    if (total === 0) return;

    let prevIdx;
    if (get(shuffleEnabled)) {
      do {
        prevIdx = Math.floor(Math.random() * total);
      } while (prevIdx === idx && total > 1);
    } else {
      prevIdx = idx - 1;
      if (prevIdx < 0) {
        if (get(repeatMode) === 'all') prevIdx = total - 1;
        else prevIdx = 0;
      }
    }
    this.rememberPause();
    this.goTo(prevIdx);
  }

  stop() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
      playingStore.set(false);
    }
  }

  // --- Internal Handlers ---

  onTimeUpdate() {
    if (!this.audioElement) return;
    this.currentTime.set(this.audioElement.currentTime);
    
    // Автосохранение позиции каждые 5 сек (упрощенно)
    if (Date.now() % 5000 < 100) {
      this.scheduleSaveState();
    }
  }

  onLoadedMetadata() {
    if (!this.audioElement) return;
    const dur = this.audioElement.duration;
    this.duration.set(dur);
    
    // Получаем текущий трек напрямую из сторов, а не через derived getter
    const allTracks = get(tracksStore);
    const curIdx = get(currentIdxStore);
    const currentTrack = allTracks[curIdx];

    if (currentTrack && Number.isFinite(dur)) {
      updateTrackDuration(currentTrack.id, dur);
    }

    if (this.pendingPosition > 0 && this.pendingPosition < dur - 0.5) {
      this.audioElement.currentTime = this.pendingPosition;
      this.currentTime.set(this.pendingPosition);
    }
    this.pendingPosition = 0;
  }

  onEnded() {
    if (get(repeatMode) === 'one') {
      this.audioElement.currentTime = 0;
      this.audioElement.play();
    } else {
      // Автопереход после окончания трека: играем дальше (элемент после ended уже paused)
      const nextIdx = this.pickNext();
      if (nextIdx === null) return;
      if (nextIdx === -1) { this.stop(); return; }
      this.startPaused = false;
      this.goTo(nextIdx);
    }
  }

  scheduleSaveState() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const allTracks = get(tracksStore);
      const curIdx = get(currentIdxStore);
      const currentTrack = allTracks[curIdx];
      
      if (currentTrack && this.audioElement) {
        // Здесь можно вызывать сохранение настроек, если нужно
        // Но так как настройки живут отдельно, лучше делать это в App.svelte
      }
    }, 800);
  }
  
  setPendingPos(pos) {
    this.pendingPosition = pos;
  }
}

// Экземпляр синглтона
export const playerController = new PlayerController();