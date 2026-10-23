import { writable, get } from 'svelte/store';
import { tracks as tracksStore, currentIndex as currentIdxStore, isPlaying as playingStore, repeatMode, shuffleEnabled, updateTrackDuration } from '../stores/player.js';
import { getSourceProvider } from './sources/index.js';
import { updateSettings } from '../stores/settings.js';
import { queue as queueStore, setQueue, ALL_ID } from '../stores/playlists.js';
import { ReadFileAsDataURL } from '../../wailsjs/go/main/App'; // <-- Импорт Go функции

// Сдвиг тона без изменения скорости: две линии задержки с плавным перекрытием (простой «granular» pitch shifter).
export const PITCH_WORKLET = `
class AriaPitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.W = Math.round(sampleRate * 0.06);
    this.size = this.W * 4;
    this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
    this.w = 0;
    this.ph = 0;
  }
  read(ch, pos) {
    const size = this.size;
    let p = pos % size; if (p < 0) p += size;
    const i0 = Math.floor(p), i1 = (i0 + 1) % size, f = p - i0;
    const b = this.buf[ch];
    return b[i0] * (1 - f) + b[i1] * f;
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    const r = params.ratio[0];
    const n = out[0].length, W = this.W, size = this.size;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) {
        const src = inp && inp.length ? inp[Math.min(c, inp.length - 1)] : null;
        this.buf[c][this.w] = src ? src[i] : 0;
      }
      this.ph += (1 - r) / W;
      if (this.ph >= 1) this.ph -= 1;
      if (this.ph < 0) this.ph += 1;
      const p1 = this.ph, p2 = (this.ph + 0.5) % 1;
      const g1 = 0.5 - 0.5 * Math.cos(2 * Math.PI * p1);
      const g2 = 1 - g1;
      for (let c = 0; c < out.length; c++) {
        const k = Math.min(c, 1);
        out[c][i] = this.read(k, this.w - p1 * W) * g1 + this.read(k, this.w - p2 * W) * g2;
      }
      this.w = (this.w + 1) % size;
    }
    return true;
  }
}
registerProcessor('aria-pitch-shifter', AriaPitchShifter);
`;

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
    this.priority = []; // id треков из «играть следом»: берутся первыми, даже при shuffle
    this.speed = writable(1); // скорость воспроизведения (на время сеанса)
    this.pitch = writable(1); // тон (множитель частоты), на время сеанса
    this.tempoLinked = writable(false); // скорость и тон связаны: меняются вместе, как у пластинки
    this.srcNode = null;
    this.shifter = null;      // AudioWorklet со сдвигом тона (создаётся, когда тон != 1 и не связан со скоростью)
    this.shifterLoading = null;
    this.volume = writable(0.5); // единственный источник громкости: все ползунки читают и пишут его
  }

  init(audioEl, baseUrl) {
    this.audioElement = audioEl;
    this.streamBaseUrl = baseUrl;
    // нужно для Web Audio (стрим идёт с другого origin, CORS у сервера открыт)
    this.audioElement.crossOrigin = 'anonymous';
    this.audioElement.preservesPitch = true; // при смене скорости тон не меняется
    
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
      this.srcNode = srcNode;
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
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

  /** Меняет громкость везде сразу (нижняя панель, большая страница, настройки). persist — сохранить в настройки. */
  setVolume(vol, persist = true) {
    const v = Math.max(0, Math.min(1, Number(vol) || 0));
    this._targetVolume = v;
    this.volume.set(v);
    this.applyCurrentVolume();
    if (persist) updateSettings({ defaultVolume: v });
  }

  /** Скорость воспроизведения 0.5–2.0. Если скорость и тон связаны — тон меняется вместе с ней. */
  setSpeed(v) {
    const n = Math.min(2, Math.max(0.5, Math.round(Number(v) * 20) / 20));
    if (!Number.isFinite(n)) return;
    this.speed.set(n);
    if (get(this.tempoLinked)) this.pitch.set(n);
    this.applyTempo();
  }

  /** Тон 0.5–2.0 (множитель частоты). При связанных скорость и тон меняются вместе. */
  setPitch(v) {
    const n = Math.min(2, Math.max(0.5, Math.round(Number(v) * 20) / 20));
    if (!Number.isFinite(n)) return;
    this.pitch.set(n);
    if (get(this.tempoLinked)) this.speed.set(n);
    this.applyTempo();
  }

  /** Связать/развязать скорость и тон. При связывании тон подтягивается к скорости. */
  setTempoLinked(on) {
    this.tempoLinked.set(!!on);
    if (on) this.pitch.set(get(this.speed));
    this.applyTempo();
  }

  applyTempo() {
    const el = this.audioElement;
    const s = get(this.speed), p = get(this.pitch);
    const linked = get(this.tempoLinked) && Math.abs(s - p) < 1e-6;
    if (el) {
      // связанные: обычное ускорение/замедление (тон меняется само); иначе тон сохраняется, а сдвигает его шифтер
      el.preservesPitch = !linked;
      el.webkitPreservesPitch = !linked;
      el.defaultPlaybackRate = s;
      el.playbackRate = s;
    }
    const ratio = linked ? 1 : p;
    if (Math.abs(ratio - 1) > 1e-6) this.ensureShifter().then(() => this.rewire(ratio));
    else this.rewire(1);
  }

  /** Подключает сдвиг тона в цепочку Web Audio (или выключает его при ratio == 1). */
  rewire(ratio) {
    if (!this.audioCtx || !this.srcNode || !this.analyser) return;
    try {
      this.srcNode.disconnect();
      if (this.shifter) this.shifter.disconnect();
    } catch (e) {}
    if (this.shifter && Math.abs(ratio - 1) > 1e-6) {
      this.shifter.parameters.get('ratio').value = ratio;
      this.srcNode.connect(this.shifter);
      this.shifter.connect(this.analyser);
    } else {
      this.srcNode.connect(this.analyser);
    }
  }

  async ensureShifter() {
    if (this.shifter) return;
    if (!this.shifterLoading) {
      this.shifterLoading = (async () => {
        this.getAnalyser(); // создаёт контекст и цепочку, если их ещё нет
        if (!this.audioCtx || !this.audioCtx.audioWorklet) throw new Error('AudioWorklet недоступен');
        const url = URL.createObjectURL(new Blob([PITCH_WORKLET], { type: 'text/javascript' }));
        await this.audioCtx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        this.shifter = new AudioWorkletNode(this.audioCtx, 'aria-pitch-shifter', { outputChannelCount: [2] });
      })().catch((e) => { console.warn('Сдвиг тона недоступен:', e); this.shifterLoading = null; });
    }
    await this.shifterLoading;
  }

  // старое имя — оставлено для совместимости
  setTargetVolume(vol) { this.setVolume(vol, false); }

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

  // --- Очередь ---

  _libIdx(id) {
    return get(tracksStore).findIndex((t) => t.id === id);
  }

  /**
   * Актуальное состояние очереди: { ids, pos }.
   * Очередь «all» всегда повторяет библиотеку; чужие очереди чистятся от удалённых треков.
   * Если играющего трека нет в очереди — очередь пересобирается из библиотеки.
   */
  _queueState() {
    const lib = get(tracksStore);
    const libIds = lib.map((t) => t.id);
    const libSet = new Set(libIds);
    const cur = lib[get(currentIdxStore)]?.id ?? null;
    const q0 = get(queueStore);
    let src = q0.sourceId || ALL_ID;
    let ids;
    if (src === ALL_ID) ids = libIds;
    else ids = q0.trackIds.filter((id) => libSet.has(id));

    let pos = -1;
    if (cur !== null) {
      pos = ids[q0.index] === cur ? q0.index : ids.indexOf(cur);
      if (pos === -1) { src = ALL_ID; ids = libIds; pos = ids.indexOf(cur); }
    }
    const same = ids.length === q0.trackIds.length && ids.every((id, i) => id === q0.trackIds[i]);
    if (!same || src !== q0.sourceId || pos !== q0.index) setQueue(src, ids, pos);
    return { ids, pos };
  }

  /** Запуск трека из списка: очередью становится этот список. */
  playFrom(sourceId, ids, trackId) {
    const pos = ids.indexOf(trackId);
    const idx = this._libIdx(trackId);
    if (pos === -1 || idx === -1) return;
    this.priority = [];
    setQueue(sourceId, ids, pos);
    this.startPaused = false; // явный выбор трека пользователем — всегда играем
    if (get(currentIdxStore) === idx) this.goTo(idx);
    else currentIdxStore.set(idx);
  }

  /** «Играть следом»: вставить трек сразу после текущего. */
  playNext(trackId) {
    const { ids, pos } = this._queueState();
    if (this._libIdx(trackId) === -1 || ids[pos] === trackId) return;
    const list = ids.filter((id) => id !== trackId);
    const at = list.indexOf(ids[pos]) + 1; // -1 + 1 = 0, если ничего не играет
    list.splice(at, 0, trackId);
    const src = get(queueStore).sourceId === ALL_ID ? 'custom' : get(queueStore).sourceId;
    setQueue(src, list, list.indexOf(ids[pos]));
    this.priority = [...this.priority.filter((id) => id !== trackId), trackId];
  }

  /** Переставить трек в очереди (from/to — позиции в очереди). Играющий трек остаётся тем же. */
  moveInQueue(from, to) {
    const { ids, pos } = this._queueState();
    if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return;
    const list = ids.slice();
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    setQueue('custom', list, list.indexOf(ids[pos]));
  }

  /** Убрать трек из очереди (играющий остаётся). Из библиотеки не удаляется. */
  removeFromQueue(trackId) {
    const { ids, pos } = this._queueState();
    if (ids[pos] === trackId || !ids.includes(trackId)) return;
    const list = ids.filter((id) => id !== trackId);
    this.priority = this.priority.filter((id) => id !== trackId);
    setQueue('custom', list, list.indexOf(ids[pos]));
  }

  /** Добавить трек в конец очереди. */
  addToQueue(trackId) {
    const { ids, pos } = this._queueState();
    if (this._libIdx(trackId) === -1 || ids.includes(trackId)) return;
    const src = get(queueStore).sourceId === ALL_ID ? 'custom' : get(queueStore).sourceId;
    setQueue(src, [...ids, trackId], pos);
  }

  /** Индекс в библиотеке следующего трека: число, -1 (конец очереди) или null (пусто). */
  pickNext() {
    const { ids, pos } = this._queueState();
    const total = ids.length;
    if (total === 0) return null;

    while (this.priority.length) {
      const id = this.priority.shift();
      if (ids.includes(id)) return this._libIdx(id);
    }
    if (get(shuffleEnabled)) {
      let n;
      do { n = Math.floor(Math.random() * total); } while (n === pos && total > 1);
      return this._libIdx(ids[n]);
    }
    let n = pos + 1;
    if (n >= total) {
      if (get(repeatMode) === 'all') n = 0;
      else return -1; // конец очереди
    }
    return this._libIdx(ids[n]);
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
    this._queueState(); // обновить позицию в очереди
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
    const { ids, pos } = this._queueState();
    const total = ids.length;
    if (total === 0) return;

    let p;
    if (get(shuffleEnabled)) {
      do { p = Math.floor(Math.random() * total); } while (p === pos && total > 1);
    } else {
      p = pos - 1;
      if (p < 0) p = get(repeatMode) === 'all' ? total - 1 : 0;
    }
    this.rememberPause();
    this.goTo(this._libIdx(ids[p]));
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