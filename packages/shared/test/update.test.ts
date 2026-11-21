import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appImageName, checksumFor, isNewer, parseVersion } from '../src/index.js';

test('parseVersion reads release tags', () => {
  assert.deepEqual(parseVersion('v1.0.3'), [1, 0, 3]);
  assert.deepEqual(parseVersion('2.1'), [2, 1, 0]);
  assert.equal(parseVersion('latest'), null);
  assert.equal(parseVersion('1.0.3-beta'), null);
});

test('isNewer compares each part as a number', () => {
  assert.ok(isNewer('v1.0.4', '1.0.3'));
  assert.ok(isNewer('1.1.0', '1.0.9'));
  assert.ok(isNewer('2.0.0', '1.9.9'));
  assert.ok(isNewer('1.0.10', '1.0.9'));
  assert.ok(!isNewer('1.0.3', '1.0.3'));
  assert.ok(!isNewer('1.0.2', '1.0.3'));
  assert.ok(isNewer('1.0.1', '0.0.0'));
  assert.ok(!isNewer('nonsense', '1.0.0'));
});

test('checksumFor finds a file in sha256sum output', () => {
  const a = 'a'.repeat(64);
  const b = 'B'.repeat(64);
  const sums = `${a}  Thoughtwell-1.0.3-x86_64.AppImage\n${b} *Thoughtwell-1.0.3-arm64.AppImage\n`;
  assert.equal(checksumFor(sums, 'Thoughtwell-1.0.3-x86_64.AppImage'), a);
  assert.equal(checksumFor(sums, 'Thoughtwell-1.0.3-arm64.AppImage'), b.toLowerCase());
  assert.equal(checksumFor(sums, 'Thoughtwell-1.0.3.AppImage'), null);
});

test('appImageName matches the release asset names', () => {
  assert.equal(appImageName('v1.0.3', 'x64'), 'Thoughtwell-1.0.3-x86_64.AppImage');
  assert.equal(appImageName('1.0.3', 'arm64'), 'Thoughtwell-1.0.3-arm64.AppImage');
});
