import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedExports = ['getSession', 'init', 'setConsent', 'track', 'version'];
const esm = await import('../dist/findip-shield.esm.js');
const require = createRequire(import.meta.url);
const commonJs = require('../dist/findip-shield.cjs');

for (const name of expectedExports) {
  if (!(name in esm)) {
    throw new Error(`Missing ESM export: ${name}`);
  }
  if (!(name in commonJs)) {
    throw new Error(`Missing CommonJS export: ${name}`);
  }
}

console.log('Verified ESM and CommonJS package exports.');

// The CLI (`npx @findip/shield init`) must be published and must start.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const [name, target] of Object.entries(manifest.bin ?? {})) {
  const file = target.replace(/^\.\//, '');
  if (!manifest.files.some((entry) => file.startsWith(`${entry}/`))) {
    throw new Error(`bin "${name}" (${file}) is not covered by "files"`);
  }
  const help = execFileSync(process.execPath, [join(root, file), '--help'], { encoding: 'utf8' });
  if (!help.includes('init')) {
    throw new Error(`bin "${name}" did not print its help`);
  }
}

console.log('Verified the CLI entry.');

