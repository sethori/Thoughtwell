// Bundles the Electron main process (with the vault and shared packages) and the preload script.
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', target: 'node20', sourcemap: true, external: ['electron', 'fsevents'], logLevel: 'info' };

await build({
  ...common,
  entryPoints: ['src/main.ts'],
  format: 'esm',
  outfile: 'dist/main.mjs',
  // Lets bundled CommonJS packages call require() inside an ES module.
  banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" },
});

// A sandboxed preload must be a single CommonJS file.
await build({ ...common, entryPoints: ['src/preload.ts'], format: 'cjs', outfile: 'dist/preload.cjs' });
