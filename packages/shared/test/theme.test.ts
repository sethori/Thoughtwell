import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, deriveScheme, SURFACES, MIN_CONTRAST, normalizePreferences, DEFAULT_PREFERENCES } from '../src/index.js';

test('contrastRatio matches known WCAG values', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
});

test('deriveScheme keeps any brand color readable in both modes', () => {
  const brands = ['#ffcc00', '#00ff00', '#0033cc', '#ff0000', '#ffffff', '#000000', '#7b2cbf', '#14b8a6'];
  for (const brand of brands) {
    const s = deriveScheme(brand);
    assert.ok(
      contrastRatio(s.light.accent, SURFACES.light.page) >= MIN_CONTRAST,
      `${brand} light accent ${s.light.accent} too faint`,
    );
    assert.ok(
      contrastRatio(s.dark.accent, SURFACES.dark.page) >= MIN_CONTRAST,
      `${brand} dark accent ${s.dark.accent} too faint`,
    );
    assert.ok(contrastRatio(s.light.onAccent, s.light.accent) >= MIN_CONTRAST, `${brand} light button text`);
    assert.ok(contrastRatio(s.dark.onAccent, s.dark.accent) >= MIN_CONTRAST, `${brand} dark button text`);
  }
});

test('deriveScheme leaves a color alone when it already passes', () => {
  assert.equal(deriveScheme('#3856d6').light.accent, '#3856d6');
});

test('deriveScheme rejects malformed input', () => {
  assert.throws(() => deriveScheme('blue'));
});

test('normalizePreferences falls back to defaults on bad input', () => {
  assert.deepEqual(normalizePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences({ mode: 'light', accent: 'nope', density: 'compact' }), {
    mode: 'light',
    accent: 'blue',
    density: 'compact',
  });
  assert.equal(normalizePreferences({ accent: 'teal' }).accent, 'teal');
});
