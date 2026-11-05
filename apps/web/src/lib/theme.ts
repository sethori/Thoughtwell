import { ACCENT_PRESETS, onAccentColor, type DerivedScheme, type Preferences } from '@notes/shared';

/**
 * Applies the person's mode, density and accent to the page. Colors live in
 * CSS variables, so every component follows without re-rendering.
 */
export function applyTheme(prefs: Preferences, brand: DerivedScheme | null) {
  const root = document.documentElement;
  root.dataset.mode = prefs.mode;
  root.dataset.density = prefs.density;

  let accent: string;
  if (prefs.accent === 'brand' && brand) {
    accent = brand[prefs.mode].accent;
  } else {
    const preset = prefs.accent === 'brand' ? 'blue' : prefs.accent;
    accent = ACCENT_PRESETS[preset][prefs.mode];
  }
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--on-accent', onAccentColor(accent));
}
