import { ACCENT_PRESETS, DEFAULT_PREFERENCES, normalizePreferences, onAccentColor, type Preferences } from '@notes/shared';

const KEY = 'thoughtwell.preferences';

export function loadPreferences(): Preferences {
  try {
    return normalizePreferences(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(p: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the choice lasts until the app closes */
  }
}

/** Applies mode, density and accent. Colors live in CSS variables, so every component follows. */
export function applyTheme(prefs: Preferences) {
  const root = document.documentElement;
  root.dataset.mode = prefs.mode;
  root.dataset.density = prefs.density;
  const accent = ACCENT_PRESETS[prefs.accent][prefs.mode];
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--on-accent', onAccentColor(accent));
}

/** A remembered UI choice (open folders, last note). */
export function remember<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`thoughtwell.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
export function keep(key: string, value: unknown) {
  try {
    localStorage.setItem(`thoughtwell.${key}`, JSON.stringify(value));
  } catch {
    /* not essential */
  }
}
