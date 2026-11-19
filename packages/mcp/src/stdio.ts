/**
 * Running the MCP server on stdin/stdout for one vault. The vault is, in order:
 * --vault <dir>, $THOUGHTWELL_VAULT, or the folder the desktop app last opened.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VaultService } from '@notes/vault';
import { createServer } from './server.js';

/** Where the desktop app keeps settings.json (Electron's userData for "Thoughtwell"). */
export function defaultSettingsDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Thoughtwell');
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Thoughtwell');
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Thoughtwell');
}

export function findVault(argv: string[], settingsDir = defaultSettingsDir()): string | null {
  const i = argv.indexOf('--vault');
  if (i >= 0 && argv[i + 1]) return argv[i + 1]!;
  if (process.env.THOUGHTWELL_VAULT) return process.env.THOUGHTWELL_VAULT;
  try {
    const s = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf8')) as { vaultPath?: string };
    return s.vaultPath ?? null;
  } catch {
    return null;
  }
}

/** Runs until the client closes stdin. Logs go to stderr; stdout carries only the protocol. */
export async function runStdio(vaultPath: string, opts: { version?: string } = {}): Promise<void> {
  const service = await VaultService.open(vaultPath, { watch: true });
  const server = createServer(service, { version: opts.version });
  const transport = new StdioServerTransport();
  const done = new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    process.stdin.once('end', () => resolve());
  });
  await server.connect(transport);
  console.error(`Thoughtwell MCP server ready for ${service.root}`);
  await done;
  await server.close().catch(() => {});
  await service.close();
}

