// Обновления. Сейчас — только локальный список изменений (src/data/changelog.json).
// В будущем клиент будет ходить на GitHub за двумя файлами (форматы описаны в docs/UPDATES.md):
//   version.json   — маленький файл: какая версия вышла (клиент сравнивает её со своей);
//   changelog.json — тот же формат, что и локальный src/data/changelog.json.
import changelog from '../data/changelog.json';

// Заполнить, когда файлы появятся в репозитории (raw-ссылки GitHub). Пока пусто — сетевая проверка выключена.
export const VERSION_URL = '';
export const CHANGELOG_URL = '';

export const entries = changelog.entries;

/** Сравнение версий вида 0.3.0-beta: 1 если a новее b, -1 если старее, 0 если равны. Релиз новее беты того же номера. */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [num, ...rest] = String(v || '0').trim().replace(/^v/i, '').split('-');
    const parts = num.split('.').map((n) => parseInt(n, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return { parts, pre: rest.join('-') };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x.parts[i] !== y.parts[i]) return x.parts[i] > y.parts[i] ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/** Проверка обновлений по сети. Пока выключена (вернёт status: 'disabled'). */
export async function checkForUpdates(currentVersion) {
  if (!VERSION_URL) return { status: 'disabled' };
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const info = await res.json(); // { version, released?, downloadUrl?, changelogUrl? }
    return compareVersions(info.version, currentVersion) > 0
      ? { status: 'available', info }
      : { status: 'up-to-date', info };
  } catch (err) {
    return { status: 'error', error: String(err) };
  }
}
