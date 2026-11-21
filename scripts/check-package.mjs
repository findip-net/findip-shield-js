import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
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


// The published types must resolve for consumers on TypeScript's Node module
// resolution ("node16"/"nodenext"), for both import and require. A relative
// import without a file extension in a .d.ts file makes TypeScript give up
// silently there and type every export as `any`.
const consumer = mkdtempSync(join(tmpdir(), 'findip-shield-types-'));
try {
  mkdirSync(join(consumer, 'node_modules', '@findip'), { recursive: true });
  symlinkSync(root, join(consumer, 'node_modules', '@findip', 'shield'), 'junction');
  const notAny = (name) => `const _${name}: IsAny<typeof ${name}> = false;`;
  const assertions = [
    'type IsAny<T> = 0 extends 1 & T ? true : false;',
    ...expectedExports.map(notAny),
    'const _options: IsAny<IdentifyOptions> = false;',
    `void [${expectedExports.map((name) => `_${name}`).join(', ')}, _options];`,
  ].join('\n');
  const names = expectedExports.join(', ');
  writeFileSync(
    join(consumer, 'esm.mts'),
    `import { ${names}, type IdentifyOptions } from '@findip/shield';\n${assertions}\n`,
  );
  writeFileSync(
    join(consumer, 'cjs.cts'),
    `import shield = require('@findip/shield');\nconst { ${names} } = shield;\ntype IdentifyOptions = shield.IdentifyOptions;\n${assertions}\n`,
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        moduleResolution: 'nodenext',
        strict: true,
        noEmit: true,
        // Check the package's own .d.ts files too, so an import that does
        // not resolve inside them is an error here.
        skipLibCheck: false,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        types: [],
      },
      files: ['esm.mts', 'cjs.cts'],
    }),
  );
  try {
    execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', consumer], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (error) {
    throw new Error(`Published types do not resolve under nodenext:\n${error.stdout ?? error.message}`);
  }
} finally {
  rmSync(consumer, { recursive: true, force: true });
}

console.log('Verified the published types under nodenext (import and require).');
