// Bundles the Electron main process, the API and the shared package into one file.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/main.mjs',
  sourcemap: true,
  // electron comes from the runtime; pg-native is an optional pg add-on we do not use.
  external: ['electron', 'pg-native'],
  // Lets bundled CommonJS packages (fastify, pg) call require() inside an ES module.
  banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});
