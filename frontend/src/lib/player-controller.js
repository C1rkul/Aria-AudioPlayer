import { writable, get } from 'svelte/store';
import { tracks as tracksStore, currentIndex as currentIdxStore, isPlaying as playingStore, repeatMode, shuffleEnabled, updateTrackDuration } from '../stores/player.js';
import { getSourceProvider } from './sources/index.js';
import { updateSettings, settings as settingsStore } from '../stores/settings.js';
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

// Границы длительности кроссфейда (секунды)
const XFADE_MIN = 1;
const XFADE_MAX = 12;
// Количество точек кривой equal-power (cos/sin) для плавного перехода
const XFADE_CURVE_POINTS = 65;
// Запас по времени таймера завершения фейда поверх автоматизации на аудио-часах
const XFADE_TIMER_MARGIN_MS = 150;

class PlayerController {
  constructor() {
    // --- Аудио-элементы -------------------------------------------------
    // elA/elB — два физических <audio> (для кроссфейда нужно играть одновременно два).
    // audioElement — АКТИВНЫЙ элемент (на нём играет «основной» трек), меняется при свапе.
    // uiEl — элемент, чьё время/длительность показывает интерфейс
    // (во время кроссфейда это входящий трек — UI переключается в начале перехода).
    this.elA = null;
    this.elB = null;
    this.audioElement = null;
    this.uiEl = null;
    this.activeTrackId = null;

    this.streamBaseUrl = '';

    // Состояния внутри контроллера
    this.currentTime = writable(0);
    this.duration = writable(0);
    this.isLoading = writable(false);
    this.loadedSrc = writable(''); // Храним именно URL источника активного/переходящего трека

    this.pendingPosition = 0;
    this.saveTimer = null;
    this.startPaused = false; // следующий загружаемый трек не стартует автоматически
    this.priority = []; // id треков из «играть следом»: берутся первыми, даже при shuffle
    this.speed = writable(1); // скорость воспроизведения (на время сеанса)
    this.pitch = writable(1); // тон (множитель частоты), на время сеанса
    this.tempoLinked = writable(false); // скорость и тон связаны: меняются вместе, как у пластинки

    // --- Web Audio граф -------------------------------------------------
    // elA → gainA ┐
    // elB → gainB ┴→ mixer → [shifter] → analyser → destination
    this.audioCtx = null;
    this.analyser = null;
    this.srcNode = null;   // legacy-имя: source-нод активного элемента
    this.srcA = null;
    this.srcB = null;
    this.gainA = null;
    this.gainB = null;
    this.mixer = null;
    this.shifter = null;      // AudioWorklet со сдвигом тона (создаётся, когда тон != 1 и не связан со скоростью)
    this.shifterLoading = null;
    this._graphBuilding = false;
    this._resumeHooked = false;

    this.volume = writable(0.5); // единственный источник громкости: все ползунки читают и пишут его

    // --- Состояние кроссфейда -------------------------------------------
    this._fading = false;        // идёт переход fade-out → fade-in
    this._fadeInEl = null;       // входящий элемент (пока идёт фейд)
    this._fadeTrackId = null;    // id входящего трека
    this._fadeOutOnly = false;   // фейд в тишину (конец очереди)
    this._fadeTimer = null;      // таймер завершения фейда
    this._xfadeDone = false;     // окно кроссфейда для текущего трека уже обработано
    this._xfadeArmed = false;    // переход затеян АВТОматически (_beginAutoCrossfade) — фейдить
    this._playSeq = 0;           // счётчик вызовов playTrack: побеждает самый новый
  }

  // ==========================================================================
  // Инициализация
  // ==========================================================================

  init(audioEl, baseUrl) {
    this.elA = audioEl;
    this.elB = document.createElement('audio');
    this.audioElement = audioEl;
    this.uiEl = audioEl;
    this.streamBaseUrl = baseUrl;

    // нужно для Web Audio (стрим идёт с другого origin, CORS у сервера открыт)
    audioEl.crossOrigin = 'anonymous';
    audioEl.preservesPitch = true; // при смене скорости тон не меняется

    // второй элемент — такой же: оба ходят в один граф Web Audio
    this.elB.crossOrigin = 'anonymous';
    this.elB.preservesPitch = true;
    this.elB.preload = 'auto';
    this.elB.style.display = 'none';
    (document.body || document.documentElement).appendChild(this.elB);

    // Слушатели событий аудио (на обоих элементах; в обработчиках — разбор по ролям)
    this._wire(audioEl);
    this._wire(this.elB);
  }

  _wire(el) {
    el.addEventListener('timeupdate', () => this.onTimeUpdate(el));
    el.addEventListener('loadedmetadata', () => this.onLoadedMetadata(el));
    el.addEventListener('ended', () => this.onEnded(el));
    el.addEventListener('play', () => this.onPlay(el));
    el.addEventListener('pause', () => this.onPause(el));
  }

  /** Второй (неактивный) элемент — кандидат на вход в кроссфейд. */
  _idleEl() {
    return this.audioElement === this.elA ? this.elB : this.elA;
  }

  /** Gain-нода элемента (null, пока граф не построен). */
  gainOf(el) {
    if (!el) return null;
    if (el === this.elA) return this.gainA;
    if (el === this.elB) return this.gainB;
    return null;
  }

  /** Элементы, которые прямо сейчас должны звучать (активный + входящий во время фейда). */
  _liveEls() {
    const list = [this.audioElement];
    if (this._fading && this._fadeInEl) list.push(this._fadeInEl);
    return list;
  }

  // ==========================================================================
  // Настройки кроссфейда
  // ==========================================================================

  /** { enabled, sec } — читаем из стора настроек в момент действия (реактивно). */
  _xfadeCfg() {
    const s = get(settingsStore);
    const sec = Math.max(XFADE_MIN, Math.min(XFADE_MAX, Number(s.crossfadeDuration) || 5));
    return { enabled: !!s.crossfadeEnabled, sec };
  }

  /** Можно ли начать плавный переход с active-элемента на трек track. */
  canCrossfade(track) {
    const cfg = this._xfadeCfg();
    if (!cfg.enabled) return false;
    const el = this.audioElement;
    if (!el || !el.src || el.paused) return false; // ничто не звучит — обычное переключение
    if (!Number.isFinite(el.duration) || el.duration <= 0) return false;
    if (track && this.activeTrackId && track.id === this.activeTrackId) return false;
    return true;
  }

  // ==========================================================================
  // Web Audio граф
  // ==========================================================================

  /**
   * Строит граф (или просто пытается возобновить контекст, если он уже есть).
   * Возвращает true, если граф доступен. Граф создаётся один раз на оба элемента.
   */
  ensureGraph() {
    if (this.analyser && this.gainA && this.gainB) {
      this._resumeCtx();
      return true;
    }
    if (this._graphBuilding) return false;
    if (!this.elA || !this.elB) return false;
    try {
      this._graphBuilding = true;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('AudioContext недоступен');

      const ctx = new Ctx();
      const srcA = ctx.createMediaElementSource(this.elA);
      const srcB = ctx.createMediaElementSource(this.elB);
      const gainA = ctx.createGain();
      const gainB = ctx.createGain();
      const mixer = ctx.createGain();
      gainA.gain.value = 1;          // активный элемент звучит в полную
      gainB.gain.value = 0;          // неактивный — молчит, пока не начинает входить в фейд
      srcA.connect(gainA);
      srcB.connect(gainB);
      gainA.connect(mixer);
      gainB.connect(mixer);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      mixer.connect(analyser);
      analyser.connect(ctx.destination);

      // присваиваем поля только после полной сборки
      this.audioCtx = ctx;
      this.srcA = srcA;
      this.srcB = srcB;
      this.srcNode = this.audioElement === this.elB ? srcB : srcA;
      this.gainA = gainA;
      this.gainB = gainB;
      this.mixer = mixer;
      this.analyser = analyser;
      this._graphBuilding = false;

      this._resumeCtx();
      this._hookResumeOnGesture();
      // если шифтер тона уже был включён до перестроения — вернуть его в цепочку
      const pitch = get(this.pitch), speed = get(this.speed);
      const linked = get(this.tempoLinked) && Math.abs(speed - pitch) < 1e-6;
      const ratio = linked ? 1 : pitch;
      if (Math.abs(ratio - 1) > 1e-6) this.ensureShifter().then(() => this.rewire(ratio));
      return true;
    } catch (e) {
      console.warn('Web Audio недоступен:', e);
      this._graphBuilding = false;
      return false;
    }
  }

  _resumeCtx() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      const p = this.audioCtx.resume();
      if (p && p.catch) p.catch(() => {});
    }
  }

  // страховка: в WKWebView resume() надёжнее вызывать во время жеста
  _hookResumeOnGesture() {
    if (this._resumeHooked) return;
    this._resumeHooked = true;
    const hook = () => {
      this._resumeCtx();
      if (!this.audioCtx || this.audioCtx.state === 'running') {
        document.removeEventListener('pointerdown', hook);
      }
    };
    document.addEventListener('pointerdown', hook);
  }

  // Анализатор для визуализатора (создаётся лениво, при первом обращении)
  getAnalyser() {
    this.ensureGraph();
    if (this.audioCtx && this.audioCtx.state === 'suspended') this._resumeCtx();
    return this.analyser || null;
  }

  /** Подключает сдвиг тона в цепочку Web Audio (или выключает его при ratio == 1). */
  rewire(ratio) {
    if (!this.audioCtx || !this.mixer || !this.analyser) return;
    try {
      this.mixer.disconnect();
    } catch (e) {}
    if (this.shifter && Math.abs(ratio - 1) > 1e-6) {
      this.shifter.parameters.get('ratio').value = ratio;
      this.mixer.connect(this.shifter);
      this.shifter.connect(this.analyser);
    } else {
      this.mixer.connect(this.analyser);
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

  // ==========================================================================
  // Кроссфейд: утилиты гейнов и кривых
  // ==========================================================================

  /** Equal-power кривые: out — cos (1→0), in — sin (0→1). */
  _fadeCurves(n = XFADE_CURVE_POINTS) {
    const out = new Float32Array(n);
    const inn = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      inn[i] = Math.sin(t * Math.PI / 2);
      out[i] = Math.cos(t * Math.PI / 2);
    }
    return { out, inn };
  }

  /** Мгновенно зафиксировать гейн элемента (сброс любых automation-событий). */
  _snapGain(el, value) {
    const g = this.gainOf(el);
    if (!this.audioCtx || !g) return;
    const t = this.audioCtx.currentTime;
    try {
      g.gain.cancelScheduledValues(0);
      g.gain.setValueAtTime(value, t);
    } catch (e) {}
  }

  /** Повесить equal-power кривую на гейн: из текущего значения плавно в конец кривой. */
  _applyCurve(param, curve, sec) {
    const t0 = this.audioCtx.currentTime;
    const v = param.value; // текущее (возможно, частично затухающее) значение
    try {
      param.cancelScheduledValues(0);
      param.setValueAtTime(v, t0);
      // кривая чуть позже, чтобы события не перекрывались по спеке
      param.setValueCurveAtTime(curve, t0 + 0.01, sec);
    } catch (e) {
      // запасной вариант — линейный реймп
      try {
        param.cancelScheduledValues(0);
        param.setValueAtTime(v, t0);
        param.linearRampToValueAtTime(curve[curve.length - 1], t0 + sec);
      } catch (e2) {}
    }
  }

  _clearFadeTimer() {
    if (this._fadeTimer) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
  }

  // ==========================================================================
  // Кроссфейд: запуск / завершение / отмена
  // ==========================================================================

  /** Реализация плавного перехода на новый src. Возвращает true, если фейд начался. */
  async startCrossfade(src, track) {
    const outEl = this.audioElement;
    const inEl = this._idleEl();
    if (!outEl || !inEl || !this.ensureGraph()) return false; // нет Web Audio — обычное переключение

    const cfg = this._xfadeCfg();
    let fadeSec = cfg.sec;
    if (Number.isFinite(outEl.duration) && outEl.duration > 0) {
      fadeSec = Math.min(fadeSec, Math.max(outEl.duration / 2, XFADE_MIN));
    }

    // --- подготовка входящего элемента ---
    try {
      inEl.pause();
      inEl.src = src;
    } catch (e) {
      return false;
    }
    // общий уровень громкости/скорости с активным элементом
    inEl.volume = outEl.volume;
    inEl.defaultPlaybackRate = outEl.defaultPlaybackRate;
    inEl.playbackRate = outEl.playbackRate;
    inEl.preservesPitch = outEl.preservesPitch;
    inEl.webkitPreservesPitch = outEl.webkitPreservesPitch;

    // --- состояние перехода ---
    this._fading = true;
    this._fadeInEl = inEl;
    this._fadeTrackId = track ? track.id : null;
    this._fadeOutOnly = false;
    this._xfadeDone = true; // окно обработано — повторно не триггерим
    this.uiEl = inEl;       // UI переключается на новый трек сразу (как в радиоплеерах)
    this.loadedSrc.set(src);
    this.currentTime.set(inEl.currentTime || 0);
    this.duration.set(Number.isFinite(inEl.duration) ? inEl.duration : 0);

    // --- гейны: активный в полную, входящий в ноль, затем кривые ---
    this._snapGain(outEl, 1);
    this._snapGain(inEl, 0);
    const { out, inn } = this._fadeCurves();
    this._applyCurve(this.gainOf(outEl).gain, out, fadeSec);
    this._applyCurve(this.gainOf(inEl).gain, inn, fadeSec);

    this.isLoading.set(true);
    try {
      await inEl.play();
    } catch (err) {
      this.isLoading.set(false);
      // AbortError — быстрая смена треков, NotAllowedError — автозапуск: не фатально
      if (err && err.name === 'AbortError') return false;
      console.warn('Кроссфейд: не удалось запустить новый трек, откат:', err);
      return false; // playTrack откатит состояние и переключит обычно
    }
    this.isLoading.set(false);

    this._clearFadeTimer();
    this._fadeTimer = setTimeout(() => this.finishCrossfade(), fadeSec * 1000 + XFADE_TIMER_MARGIN_MS);
    return true;
  }

  /** Завершение перехода: новый трек становится активным, старый — глушится и выгружается. */
  finishCrossfade() {
    if (!this._fading) return;
    this._clearFadeTimer();

    const outEl = this.audioElement;
    const inEl = this._fadeInEl;
    if (!inEl) {
      this._resetFadeFlags();
      return;
    }

    // фиксируем целевые значения гейнов
    this._snapGain(outEl, 0);
    this._snapGain(inEl, 1);

    try { outEl.pause(); } catch (e) {}
    try { outEl.removeAttribute('src'); outEl.load(); } catch (e) {} // освобождаем буфер/сети

    // свап ролей
    this.audioElement = inEl;
    this._fadeInEl = null;
    this._fading = false;
    this.uiEl = inEl;
    this.activeTrackId = this._fadeTrackId;
    this._fadeTrackId = null;
    this._xfadeDone = false; // для нового трека окно кроссфейда снова открыто
    if (this.analyser) this.srcNode = inEl === this.elB ? this.srcB : this.srcA;

    this.currentTime.set(inEl.currentTime || 0);
    if (Number.isFinite(inEl.duration)) this.duration.set(inEl.duration);
    this._syncPlaying();
  }

  /**
   * Отмена перехода (выбрали другой трек / остановку): входящий глушится,
   * активный продолжает звучать в полную.
   */
  cancelCrossfade() {
    this._clearFadeTimer();
    if (this._fadeOutOnly) this.cancelFadeOutOnly();
    if (!this._fading) {
      this._fadeTrackId = null;
      return;
    }

    const outEl = this.audioElement;
    const inEl = this._fadeInEl;
    this._fading = false;
    this._fadeInEl = null;

    if (inEl) {
      try { inEl.pause(); } catch (e) {}
      try { inEl.removeAttribute('src'); inEl.load(); } catch (e) {}
      this._snapGain(inEl, 0);
    }
    this._snapGain(outEl, 1);

    this.uiEl = outEl;
    this._fadeTrackId = null;
    this._xfadeDone = false;
    this.loadedSrc.set(outEl.getAttribute('src') || '');
    this.currentTime.set(outEl.currentTime || 0);
    if (Number.isFinite(outEl.duration)) this.duration.set(outEl.duration);
    this._syncPlaying();
  }

  /** Конец очереди: плавно уйти в тишину, затем остановиться. */
  async startFadeOutOnly() {
    if (this._fadeOutOnly || this._fading) return;
    const el = this.audioElement;
    if (!el || !this.ensureGraph()) { this.stop(); return; }

    const cfg = this._xfadeCfg();
    let sec = cfg.sec;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      sec = Math.min(sec, Math.max(el.duration / 2, 0.5));
    }

    this._fadeOutOnly = true;
    this._xfadeDone = true;
    this._snapGain(el, 1);
    this._applyCurve(this.gainOf(el).gain, this._fadeCurves().out, sec);
    this._clearFadeTimer();
    this._fadeTimer = setTimeout(() => this._finishFadeOutOnly(), sec * 1000 + XFADE_TIMER_MARGIN_MS);
  }

  _finishFadeOutOnly() {
    if (!this._fadeOutOnly) return;
    this._clearFadeTimer();
    const el = this.audioElement;
    this._fadeOutOnly = false;
    if (el) {
      try { el.pause(); } catch (e) {}
      el.currentTime = 0;
      this._snapGain(el, 1); // вернуть громкость для следующего запуска (элемент на паузе — беззвучно)
    }
    this.currentTime.set(0);
    this._xfadeDone = false; // трек можно заново доиграть — окно кроссфейда снова открыто
    playingStore.set(false);
  }

  /** Отменить «уход в тишину» (например, пользователь нажал паузу в процессе). */
  cancelFadeOutOnly() {
    if (!this._fadeOutOnly) return;
    this._clearFadeTimer();
    this._fadeOutOnly = false;
    this._xfadeDone = false;
    this._snapGain(this.audioElement, 1);
  }

  _resetFadeFlags() {
    this._clearFadeTimer();
    this._fading = false;
    this._fadeInEl = null;
    this._fadeOutOnly = false;
    this._fadeTrackId = null;
    this._xfadeDone = false;
  }

  // ==========================================================================
  // Загрузка трека
  // ==========================================================================

  async playTrack(track) {
    if (!this.audioElement || !track) return;
    const seq = ++this._playSeq; // если появится более новый вызов — этот уступает

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
      if (seq !== this._playSeq) return; // за время fallback-загрузки пришёл более новый вызов

      // Если пользователь поставил паузу и переключил трек — новый трек тоже загружается на паузе
      const startPaused = this.startPaused;
      this.startPaused = false;

      // Фейд только для АВТОперехода: флаг ставит _beginAutoCrossfade непосредственно
      // перед сменой индекса. Ручные клики/кнопки его не ставят → мгновенное переключение.
      const armed = this._xfadeArmed;
      this._xfadeArmed = false;

      // Во время перехода: дублирующийся вызов для входящего трека игнорируем,
      // выбор ДРУГОГО трека — отменяем текущий фейд и переключаемся жёстко.
      if (this._fading) {
        if (track.id === this._fadeTrackId) return;
        this.cancelCrossfade();
      }

      // Тот же источник уже загружен — ничего не перезапускаем и состояние паузы не трогаем
      if (get(this.loadedSrc) === src) return;

      this._xfadeDone = false; // новый трек — окно кроссфейда открывается заново

      // --- ветка кроссфейда: автопереход, старый трек ещё звучит и плавно уходит ---
      if (armed && !startPaused && this.canCrossfade(track)) {
        const ok = await this.startCrossfade(src, track);
        if (ok) return;
        if (seq !== this._playSeq) return; // более новый вызов уже распорядился состоянием
        this.cancelCrossfade(); // откат частично начатого фейда
      }

      if (seq !== this._playSeq) return;
      await this.hardLoad(src, track, startPaused);

    } catch (err) {
      this.isLoading.set(false);
      // AbortError — быстрое переключение треков, NotAllowedError — автозапуск без клика: не ошибки
      if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
      console.error("Playback error:", err);
      alert("Ошибка воспроизведения: " + err.message);
    }
  }

  /** Обычное (жёсткое) переключение: один элемент, без перекрытия. */
  async hardLoad(src, track, startPaused) {
    const el = this.audioElement;
    this._resetFadeFlags();

    this.isLoading.set(true);
    this.loadedSrc.set(src);
    this.activeTrackId = track ? track.id : null;
    this.uiEl = el;

    el.src = src;
    this._snapGain(el, 1); // если граф есть — активный всегда в полную
    this.applyCurrentVolume();

    if (startPaused) {
      el.pause();
      this.isLoading.set(false);
      return;
    }

    try {
      await el.play();
    } finally {
      this.isLoading.set(false);
    }
  }

  // ==========================================================================
  // Обработчики событий аудио
  // ==========================================================================

  onPlay(el) {
    // граф строим при первом воспроизведении — контекст создаётся в контексте
    // пользовательского жеста, чтобы resume() гарантированно сработал
    if (!this.analyser) this.ensureGraph();
    this._resumeCtx();
    this._syncPlaying();
  }

  onPause(el) {
    this._syncPlaying();
  }

  /** Синхронизировать стор isPlaying с фактическим состоянием обоих элементов. */
  _syncPlaying() {
    const act = this.audioElement;
    let playing = !!(act && act.src && !act.paused && !act.ended);
    const fi = this._fadeInEl;
    if (fi && fi.src && !fi.paused && !fi.ended) playing = true;
    playingStore.set(playing);
  }

  onTimeUpdate(el) {
    // время/прогресс показываем только от ui-элемента (во время фейда — от входящего)
    if (el === this.uiEl) {
      this.currentTime.set(el.currentTime);
      // Автосохранение позиции каждые 5 сек (упрощенно)
      if (Date.now() % 5000 < 100) {
        this.scheduleSaveState();
      }
    }

    // --- триггер окна кроссфейда: подходим к концу текущего трека ---
    if (el !== this.audioElement) return;
    if (this._fading || this._fadeOutOnly || this._xfadeDone) return;
    const cfg = this._xfadeCfg();
    if (!cfg.enabled) return;
    if (get(repeatMode) === 'one') return; // повтор одного трека — фейд не нужен
    const dur = el.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const rem = dur - el.currentTime;
    const win = Math.min(cfg.sec, dur / 2); // не короче половины трека
    if (rem <= win && rem > 0) this._beginAutoCrossfade();
  }

  /** Решаем, что играет дальше, и запускаем переход (или уход в тишину). */
  _beginAutoCrossfade() {
    this._xfadeDone = true; // оцениваем ровно один раз на трек (pickNext мутирует очередь!)
    const nextIdx = this.pickNext();
    if (nextIdx === null) return;              // очередь пуста — пусть доиграет
    if (nextIdx === -1) {                       // конец очереди — плавно в тишину
      this.startFadeOutOnly();
      return;
    }
    const nextTrack = get(tracksStore)[nextIdx];
    if (!nextTrack || nextTrack.id === this.activeTrackId) return; // тот же трек — без фейда
    // смена индекса → App.svelte реактивно вызовет playTrack → ветка кроссфейда
    this._xfadeArmed = true; // ← только здесь: это АВТОпереход, ручные вызовы флаг не ставят
    this.goTo(nextIdx);
  }

  onLoadedMetadata(el) {
    if (el !== this.uiEl) return;
    const dur = el.duration;
    this.duration.set(dur);

    // Получаем текущий трек напрямую из сторов, а не через derived getter
    const allTracks = get(tracksStore);
    const curIdx = get(currentIdxStore);
    const currentTrack = allTracks[curIdx];

    if (currentTrack && Number.isFinite(dur)) {
      updateTrackDuration(currentTrack.id, dur);
    }

    if (this.pendingPosition > 0 && this.pendingPosition < dur - 0.5) {
      el.currentTime = this.pendingPosition;
      this.currentTime.set(this.pendingPosition);
    }
    this.pendingPosition = 0;
  }

  onEnded(el) {
    // Входящий трек кончился раньше, чем завершился фейд — закрываем переход сразу
    // и сразу обрабатываем его окончание как обычно (трек оказался короче кроссфейда).
    if (this._fading && el === this._fadeInEl) {
      this.finishCrossfade();
      this.onEnded(this.audioElement);
      return;
    }
    // Старый трек кончил посреди фейда: UI уже на новом, просто глушим старый,
    // автопереход делать не нужно — переход уже идёт.
    if (this._fading && el === this.audioElement) {
      try { el.pause(); } catch (e) {}
      this._syncPlaying();
      return;
    }
    if (el !== this.audioElement) return;   // чужой/неактивный элемент
    if (this._fadeOutOnly) return;          // уход в тишину завершит сам себя

    if (get(repeatMode) === 'one') {
      el.currentTime = 0;
      el.play();
      return;
    }

    // Автопереход после окончания трека: играем дальше (элемент после ended уже paused)
    const nextIdx = this.pickNext();
    if (nextIdx === null) return;
    if (nextIdx === -1) { this.stop(); return; }
    this.startPaused = false;
    this.goTo(nextIdx);
  }

  // ==========================================================================
  // Громкость / темп
  // ==========================================================================

  applyCurrentVolume() {
    // Громкость берётся из стора settings, но чтобы не создавать циклическую зависимость,
    // устанавливаем её напрямую из App.svelte при инициализации и изменении.
    if (this._targetVolume === undefined) return;
    const v = Math.max(0, Math.min(1, this._targetVolume * this._targetVolume));
    for (const el of [this.elA, this.elB]) {
      if (el) el.volume = v;
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

  // старое имя — оставлено для совместимости
  setTargetVolume(vol) { this.setVolume(vol, false); }

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
    this.applyTempo();
  }

  /** Связать/развязать скорость и тон. При связывании тон подтягивается к скорости. */
  setTempoLinked(on) {
    this.tempoLinked.set(!!on);
    if (on) this.pitch.set(get(this.speed));
    this.applyTempo();
  }

  applyTempo() {
    const s = get(this.speed), p = get(this.pitch);
    const linked = get(this.tempoLinked) && Math.abs(s - p) < 1e-6;
    for (const el of [this.elA, this.elB]) {
      if (!el) continue;
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

  // ==========================================================================
  // Управление воспроизведением
  // ==========================================================================

  togglePlay() {
    if (!this.audioElement) return;
    // Ничего не выбрано — запускаем первый трек списка
    if (!this.audioElement.src || get(currentIdxStore) < 0) {
      if (get(tracksStore).length > 0) currentIdxStore.set(0);
      return;
    }
    const els = this._liveEls().filter((e) => !!e.src);
    const anyPlaying = els.some((e) => !e.paused);
    if (anyPlaying) {
      // пауза посреди кроссфейда: уход в тишину отменяем (пользователь хочет слышать трек)
      if (this._fadeOutOnly) this.cancelFadeOutOnly();
      for (const e of els) e.pause();
    } else {
      this._resumeCtx();
      this.audioElement.play().catch((e) => console.warn('play() rejected:', e));
      if (this._fading && this._fadeInEl) {
        this._fadeInEl.play().catch(() => {});
      }
    }
  }

  seek(percent) {
    const el = this.uiEl || this.audioElement;
    if (!el || !get(this.duration)) return;
    // перемотка во время «ухода в тишину» = пользователь хочет снова слышать трек
    if (this._fadeOutOnly) this.cancelFadeOutOnly();
    const time = (percent / 100) * get(this.duration);
    el.currentTime = time;
    this.currentTime.set(time);
  }

  // Пользователь нажал «следующий/предыдущий»: если играла пауза — остаёмся на паузе
  rememberPause() {
    const el = this.uiEl || this.audioElement;
    this.startPaused = !!(el && el.src && el.paused);
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
    this._xfadeArmed = false; // ручной выбор трека — без кроссфейда
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
      // единственный трек (или выпал тот же при повторе) — добиваем фейд и проигрываем сначала
      if (this._fading) this.finishCrossfade();
      const el = this.audioElement;
      el.currentTime = 0;
      this.currentTime.set(0);
      if (!this.startPaused) el.play().catch(() => {});
      this.startPaused = false;
      return;
    }
    currentIdxStore.set(nextIdx);
    this._queueState(); // обновить позицию в очереди
  }

  next() {
    this._xfadeArmed = false; // ручное переключение — без кроссфейда
    const nextIdx = this.pickNext();
    if (nextIdx === null) return;
    if (nextIdx === -1) { this.stop(); return; }
    this.rememberPause();
    this.goTo(nextIdx);
  }

  prev() {
    this._xfadeArmed = false; // ручное переключение — без кроссфейда
    // Как в большинстве плееров: если трек играет дольше 3 секунд — перематываем в начало
    const el = this.uiEl || this.audioElement;
    if (el && el.currentTime > 3) {
      el.currentTime = 0;
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
    this.cancelCrossfade();
    this.cancelFadeOutOnly();
    this._xfadeDone = false; // после остановки окно кроссфейда открывается заново
    const el = this.audioElement;
    if (el) {
      el.pause();
      el.currentTime = 0;
      this.currentTime.set(0);
    }
    playingStore.set(false);
  }

  // --- Сохранение состояния ---

  scheduleSaveState() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const allTracks = get(tracksStore);
      const curIdx = get(currentIdxStore);
      const currentTrack = allTracks[curIdx];

      if (currentTrack && this.audioElement) {
        // Здесь можно вызывать сохранение настроек
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
