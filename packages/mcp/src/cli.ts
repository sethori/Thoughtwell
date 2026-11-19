// Command-line entry: node/tsx src/cli.ts [--vault <folder>]
import { findVault, runStdio } from './stdio.js';

const vault = findVault(process.argv.slice(2));
if (!vault) {
  console.error('No vault found. Pass --vault <folder>, set THOUGHTWELL_VAULT, or open a vault in the Thoughtwell app once.');
  process.exit(2);
}
runStdio(vault).then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
