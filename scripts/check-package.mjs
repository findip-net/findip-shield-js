import { createRequire } from 'node:module';

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

