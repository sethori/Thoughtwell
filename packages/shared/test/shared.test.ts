import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maxRole,
  roleAtLeast,
  can,
  childTypeOf,
  canContain,
  childPath,
  isAncestorPath,
  buildTree,
  pathLabel,
  contrastRatio,
  deriveScheme,
  SURFACES,
  MIN_CONTRAST,
  normalizePreferences,
  DEFAULT_PREFERENCES,
  maxUploadBytes,
  isAllowedType,
  normalizeUploadPolicy,
} from '../src/index.js';

test('maxRole picks the strongest grant and ignores gaps', () => {
  assert.equal(maxRole(['viewer', 'editor', 'contributor']), 'editor');
  assert.equal(maxRole([null, undefined, 'viewer']), 'viewer');
  assert.equal(maxRole([]), null);
});

test('roleAtLeast and capabilities follow the ladder', () => {
  assert.ok(roleAtLeast('admin', 'viewer'));
  assert.ok(!roleAtLeast('contributor', 'editor'));
  assert.ok(!roleAtLeast(null, 'viewer'));
  assert.ok(can('contributor', 'editDraft'));
  assert.ok(!can('contributor', 'manageFolders'));
  assert.ok(can('approver', 'review'));
  assert.ok(!can('editor', 'manageAccess'));
});

test('each tree level holds only the next level down', () => {
  assert.equal(childTypeOf('org'), 'directorate');
  assert.equal(childTypeOf('section'), 'project');
  assert.equal(childTypeOf('project'), null);
  assert.ok(canContain('division', 'branch'));
  assert.ok(!canContain('division', 'section'));
  assert.ok(!canContain('org', 'division'));
});

test('paths are built from ids and survive renames', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.equal(pathLabel(id), 'u0f8fad5bd9cb469fa16570867728950e');
  assert.match(childPath('uroot', id), /^uroot\.u[0-9a-f]{32}$/);
  assert.ok(isAncestorPath('a.b', 'a.b.c'));
  assert.ok(isAncestorPath('a.b', 'a.b'));
  assert.ok(!isAncestorPath('a.b', 'a.bc'));
});

test('buildTree nests rows under their parents', () => {
  const rows = [
    { id: '2', parent_id: '1', name: 'Div B' },
    { id: '1', parent_id: null, name: 'Org' },
    { id: '3', parent_id: '1', name: 'Div A' },
    { id: '4', parent_id: '3', name: 'Branch A1' },
  ];
  const tree = buildTree(rows, (a, b) => a.name.localeCompare(b.name));
  assert.equal(tree.length, 1);
  assert.deepEqual(
    tree[0]!.children.map((c) => c.item.name),
    ['Div A', 'Div B'],
  );
  assert.equal(tree[0]!.children[0]!.children[0]!.item.name, 'Branch A1');
});

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
    notify: { email: true, teams: false },
  });
  assert.equal(normalizePreferences({ accent: 'brand' }).accent, 'brand');
  assert.deepEqual(normalizePreferences({ notify: { email: false, teams: true } }).notify, { email: false, teams: true });
  assert.deepEqual(normalizePreferences({ notify: { email: 'yes' } }).notify, { email: true, teams: false });
});

test('upload limits take the most generous applicable rule', () => {
  const policy = normalizeUploadPolicy({ defaultMaxMb: 10, byRole: { editor: 50 }, byGroup: { g1: 100 } });
  const MB = 1024 * 1024;
  assert.equal(maxUploadBytes(policy, 'viewer', []), 10 * MB);
  assert.equal(maxUploadBytes(policy, 'editor', []), 50 * MB);
  assert.equal(maxUploadBytes(policy, 'editor', ['g1']), 100 * MB);
});

test('allowed types support exact matches and prefixes', () => {
  const policy = normalizeUploadPolicy({ allowedTypes: ['image/', 'application/pdf'] });
  assert.ok(isAllowedType(policy, 'image/png'));
  assert.ok(isAllowedType(policy, 'application/pdf'));
  assert.ok(!isAllowedType(policy, 'application/x-msdownload'));
  assert.ok(isAllowedType(normalizeUploadPolicy({ allowedTypes: [] }), 'anything/at-all'));
});
