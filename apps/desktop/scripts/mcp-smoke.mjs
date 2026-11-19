// Checks the app's MCP mode end to end: starts `<command…> --mcp --ozone-platform=headless --vault <temp>`
// (the command the app shows agents) with no display,
// connects as an MCP client over stdio, files an inbox item and checks Me/ is protected.
// Usage: node scripts/mcp-smoke.mjs <command> [args…]   (prints MCP SMOKE OK)
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('usage: mcp-smoke.mjs <command> [args…]');
const vault = mkdtempSync(join(tmpdir(), 'thoughtwell-mcp-smoke-'));
const fail = (msg) => {
  console.error(`MCP SMOKE FAILED: ${msg}`);
  process.exit(1);
};

const transport = new StdioClientTransport({ command, args: [...args, '--mcp', '--ozone-platform=headless', '--vault', vault], stderr: 'ignore' });
const client = new Client({ name: 'mcp-smoke', version: '1.0.0' });
const timer = setTimeout(() => fail('timed out'), 60_000);
try {
  await client.connect(transport);
  const call = async (name, a = {}) => {
    const r = await client.callTool({ name, arguments: a });
    return { error: r.isError, data: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
  };
  const overview = await call('vault_overview');
  if (overview.error || overview.data.root !== vault) fail('vault_overview: ' + JSON.stringify(overview.data));
  writeFileSync(join(vault, 'Brain/Inbox/note.txt'), 'smoke');
  const moved = await call('move_to_sources', { path: 'Brain/Inbox/note.txt' });
  if (moved.error) fail(moved.data);
  const saved = await call('save_summary', { title: 'Smoke', source: moved.data.path, summary: 'A test.', body: 'Body.', topics: ['Testing'] });
  if (saved.error) fail(saved.data);
  if (!readFileSync(join(vault, 'Brain/Log.md'), 'utf8').includes('Summarized [[Smoke]]')) fail('no log line');
  const denied = await call('write_note', { path: 'Me/x.md', content: 'x' });
  if (!denied.error) fail('wrote into Me/');
  console.log('MCP SMOKE OK');
} catch (err) {
  fail(err.message);
} finally {
  clearTimeout(timer);
  await client.close().catch(() => {});
  rmSync(vault, { recursive: true, force: true });
}
