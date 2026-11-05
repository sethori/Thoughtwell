/**
 * Theme tokens. Every user picks a mode, an accent and a density; an admin
 * can set a brand color, and the platform derives an accent from it that
 * stays readable in both light and dark mode.
 */
export const THEME_MODES = ['dark', 'light'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export const ACCENT_PRESETS = {
  blue: { light: '#3856d6', dark: '#7b9cff' },
  teal: { light: '#0b7f75', dark: '#3fd0c0' },
  violet: { light: '#6d44d9', dark: '#a78bfa' },
  amber: { light: '#9a5b00', dark: '#f2b13c' },
  rose: { light: '#c4284d', dark: '#ff7a93' },
} as const;
export type AccentPreset = keyof typeof ACCENT_PRESETS;
/** `brand` uses the organization's derived brand accent. */
export type AccentChoice = AccentPreset | 'brand';

export interface Preferences {
  mode: ThemeMode;
  accent: AccentChoice;
  density: Density;
}

export const DEFAULT_PREFERENCES: Preferences = {
  mode: 'dark',
  accent: 'blue',
  density: 'comfortable',
};

/** Page surfaces the accent must read against. Keep in sync with the web CSS. */
export const SURFACES = {
  light: { page: '#ffffff', onAccentDark: '#0b0f1c' },
  dark: { page: '#1a1d23', onAccentDark: '#0b0f1c' },
} as const;

/** Minimum contrast for accent text and for text on accent buttons (WCAG AA). */
export const MIN_CONTRAST = 4.5;

export function normalizePreferences(input: unknown): Preferences {
  const p = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const mode = (THEME_MODES as readonly unknown[]).includes(p.mode) ? (p.mode as ThemeMode) : DEFAULT_PREFERENCES.mode;
  const density = (DENSITIES as readonly unknown[]).includes(p.density)
    ? (p.density as Density)
    : DEFAULT_PREFERENCES.density;
  const accent =
    p.accent === 'brand' || (typeof p.accent === 'string' && p.accent in ACCENT_PRESETS)
      ? (p.accent as AccentChoice)
      : DEFAULT_PREFERENCES.accent;
  return { mode, accent, density };
}

// ---------- color math ----------

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

/**
 * Moves a color's lightness, keeping its hue, until it reaches `target`
 * contrast against `surface`. Darkens for light surfaces, lightens for dark.
 */
function fitToSurface(hex: string, surface: string, target: number): string {
  if (contrastRatio(hex, surface) >= target) return hex;
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const surfaceIsLight = relativeLuminance(surface) > 0.5;
  const step = surfaceIsLight ? -0.01 : 0.01;
  let light = l;
  // Very saturated colors at high lightness can look neon; temper slightly.
  const sat = surfaceIsLight ? s : Math.min(s, 0.9);
  for (let i = 0; i < 100; i++) {
    light = Math.min(1, Math.max(0, light + step));
    const candidate = rgbToHex(hslToRgb([h, sat, light]));
    if (contrastRatio(candidate, surface) >= target) return candidate;
  }
  return surfaceIsLight ? '#000000' : '#ffffff';
}

/** White or near-black, whichever reads better on the accent. */
export function onAccentColor(accent: string): string {
  const white = '#ffffff';
  const dark = SURFACES.dark.onAccentDark;
  return contrastRatio(white, accent) >= contrastRatio(dark, accent) ? white : dark;
}

export interface DerivedScheme {
  light: { accent: string; onAccent: string };
  dark: { accent: string; onAccent: string };
}

/**
 * Derives a light-mode and a dark-mode accent from one brand color, each
 * readable as text on its page surface and as a button with legible text.
 */
export function deriveScheme(brandHex: string): DerivedScheme {
  if (!isHexColor(brandHex)) throw new Error(`Not a #rrggbb color: ${brandHex}`);
  const lightAccent = fitToSurface(brandHex.toLowerCase(), SURFACES.light.page, MIN_CONTRAST);
  const darkAccent = fitToSurface(brandHex.toLowerCase(), SURFACES.dark.page, MIN_CONTRAST);
  return {
    light: { accent: lightAccent, onAccent: onAccentColor(lightAccent) },
    dark: { accent: darkAccent, onAccent: onAccentColor(darkAccent) },
  };
}
