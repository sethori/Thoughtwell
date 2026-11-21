/**
 * Pure helpers for the desktop app's updater (apps/desktop/src/updates.ts):
 * comparing release versions and reading the release's SHA256SUMS.
 */

/** "v1.2.3", "1.2" -> [1, 2, 3] / [1, 2, 0]. null for anything else. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** True if `latest` is a newer release than `current`. Unreadable versions are never newer. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current) ?? [0, 0, 0];
  if (!a) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

/** The sha256 (lowercase hex) that a `sha256sum` listing gives for fileName, or null. */
export function checksumFor(sums: string, fileName: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m && m[2] === fileName) return m[1]!.toLowerCase();
  }
  return null;
}

/** The AppImage name electron-builder gives a release (see artifactName in apps/desktop/package.json). */
export function appImageName(version: string, nodeArch: string): string {
  const arch = nodeArch === 'x64' ? 'x86_64' : nodeArch;
  return `Thoughtwell-${version.replace(/^v/, '')}-${arch}.AppImage`;
}
