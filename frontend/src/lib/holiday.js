// Стиль (акцент под праздник): ручной выбор или автоматический по дате.
// Настройки: style = 'normal' | 'halloween' | 'ny', styleAuto = bool.
// При styleAuto=true действует resolveHoliday(), иначе — выбранный style.
// Ручная смена стиля в Settings выставляет styleAuto=false (без конфликтов).

export const ACCENTS = {
  normal: '#7c5cff', // обычная — фирменный фиолетовый
  halloween: '#ff9500', // Хеллоуин — оранжевый
  ny: '#e63946', // Новый Год — красный
};

// Авто-окна: Хеллоуин 28–31 октября; Новый Год 24 декабря — 10 января.
export function resolveHoliday(now = new Date()) {
  const m = now.getMonth() + 1;
  const d = now.getDate();
  if (m === 10 && d >= 28) return 'halloween';
  if ((m === 12 && d >= 24) || (m === 1 && d <= 10)) return 'ny';
  return 'normal';
}

const VALID = ['normal', 'halloween', 'ny'];

/** Какой стиль действует прямо сейчас. */
export function effectiveStyle(settings) {
  if (settings && settings.styleAuto) return resolveHoliday();
  const s = settings && settings.style;
  return VALID.includes(s) ? s : 'normal';
}

/** Активный акцент для настроек (с учётом «Своя» палитры — её приоритет). */
export function accentFor(settings) {
  if (settings && settings.palette === 'custom' && settings.customAccent) {
    return settings.customAccent;
  }
  return ACCENTS[effectiveStyle(settings)] || ACCENTS.normal;
}
