// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DASHBOARD_URL, VERIFY_DOCS_URL, detectProject, planInit, runInit } from '../cli/init.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'findip-shield.js');
const created: string[] = [];

/** A project in a temp directory: `files` maps a relative path to its content. */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'findip-shield-cli-'));
  created.push(dir);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

function pkg(dependencies: Record<string, string>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: 'fixture', dependencies, ...extra });
}

/** Every file under `dir` with its content, to prove that nothing changed. */
function snapshot(dir: string, base = dir): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(result, snapshot(path, base));
    else result[path.slice(base.length + 1)] = readFileSync(path, 'utf8');
  }
  return result;
}

async function run(cwd: string, options: { siteKey?: string; dryRun?: boolean; yes?: boolean; answer?: boolean } = {}) {
  const output: string[] = [];
  let asked = 0;
  const code = await runInit({
    cwd,
    siteKey: options.siteKey ?? null,
    dryRun: options.dryRun ?? false,
    yes: options.yes ?? false,
    log: (text: string) => output.push(text),
    confirm: async () => {
      asked += 1;
      return options.answer ?? false;
    },
  });
  return { code, asked, output: output.join('\n') };
}

const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8');

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FRAMEWORKS = [
  {
    name: 'Next.js App Router',
    files: { 'package.json': pkg({ next: '16.0.0', react: '19.0.0' }), 'tsconfig.json': '{}', 'app/layout.tsx': 'export default null;' },
    label: 'Next.js (App Router)',
    initFile: 'app/shield.tsx',
    envVar: 'NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY',
    reads: 'process.env.NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY',
  },
  {
    name: 'Next.js App Router under src/',
    files: { 'package.json': pkg({ next: '16.0.0' }), 'tsconfig.json': '{}', 'src/app/layout.tsx': 'export default null;' },
    label: 'Next.js (App Router)',
    initFile: 'src/app/shield.tsx',
    envVar: 'NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY',
    reads: 'process.env.NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY',
  },
  {
    name: 'Next.js Pages Router',
    files: { 'package.json': pkg({ next: '16.0.0' }), 'tsconfig.json': '{}', 'pages/_app.tsx': 'export default null;' },
    label: 'Next.js (Pages Router)',
    initFile: 'components/shield.tsx',
    envVar: 'NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY',
    reads: 'process.env.NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY',
  },
  {
    name: 'Next.js Pages Router in JavaScript under src/',
    files: { 'package.json': pkg({ next: '16.0.0' }), 'src/pages/_app.jsx': 'export default null;' },
    label: 'Next.js (Pages Router)',
    initFile: 'src/components/shield.jsx',
    envVar: 'NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY',
    reads: 'process.env.NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY',
  },
  {
    name: 'React + Vite',
    files: { 'package.json': pkg({ react: '19.0.0', vite: '8.0.0', typescript: '6.0.0' }), 'index.html': '<div id="root"></div>', 'src/main.tsx': '' },
    label: 'React + Vite',
    initFile: 'src/shield.ts',
    envVar: 'VITE_FINDIP_SHIELD_SITE_KEY',
    reads: 'import.meta.env.VITE_FINDIP_SHIELD_SITE_KEY',
  },
  {
    name: 'Vue + Vite in JavaScript',
    files: { 'package.json': pkg({ vue: '3.5.0', vite: '8.0.0' }), 'index.html': '<div id="app"></div>', 'src/main.js': '' },
    label: 'Vue + Vite',
    initFile: 'src/shield.js',
    envVar: 'VITE_FINDIP_SHIELD_SITE_KEY',
    reads: 'import.meta.env.VITE_FINDIP_SHIELD_SITE_KEY',
  },
  {
    name: 'SvelteKit 2',
    files: { 'package.json': pkg({ '@sveltejs/kit': '^2.20.0', svelte: '5.0.0', vite: '7.0.0' }), 'tsconfig.json': '{}', 'src/routes/+layout.svelte': '<slot />' },
    label: 'SvelteKit',
    initFile: 'src/hooks.client.ts',
    envVar: 'PUBLIC_FINDIP_SHIELD_SITE_KEY',
    reads: "import { env } from '$env/dynamic/public';",
  },
  {
    name: 'SvelteKit 3',
    files: { 'package.json': pkg({ '@sveltejs/kit': '^3.0.1', svelte: '5.0.0', vite: '8.0.0' }), 'tsconfig.json': '{}', 'src/routes/+layout.svelte': '<slot />' },
    label: 'SvelteKit',
    initFile: 'src/hooks.client.ts',
    envVar: 'PUBLIC_FINDIP_SHIELD_SITE_KEY',
    reads: "import { PUBLIC_FINDIP_SHIELD_SITE_KEY } from '$app/env/public';",
  },
  {
    name: 'Astro',
    files: { 'package.json': pkg({ astro: '7.0.0' }), 'tsconfig.json': '{}', 'src/pages/index.astro': '<h1>Hi</h1>' },
    label: 'Astro',
    initFile: 'src/lib/shield.ts',
    envVar: 'PUBLIC_FINDIP_SHIELD_SITE_KEY',
    reads: 'import.meta.env.PUBLIC_FINDIP_SHIELD_SITE_KEY',
  },
];

const ASTRO = FRAMEWORKS[FRAMEWORKS.length - 1];

describe('npx @findip/shield init', () => {
  describe.each(FRAMEWORKS)('$name', ({ files, label, initFile, envVar, reads }) => {
    it('detects the framework and creates the env placeholder and one init file', async () => {
      const dir = project(files);
      const before = snapshot(dir);
      const { code, asked, output } = await run(dir, { yes: true });

      expect(code).toBe(0);
      expect(asked).toBe(0);
      expect(output).toContain(`Found: ${label}`);
      expect(output).toContain('npm install @findip/shield');

      const after = snapshot(dir);
      expect(Object.keys(after).sort()).toEqual([...Object.keys(before), '.env.example', initFile].sort());
      for (const file of Object.keys(before)) expect(after[file]).toBe(before[file]);

      expect(after[initFile]).toContain("from '@findip/shield'");
      expect(after[initFile]).toContain(reads);
      expect(after[initFile]).not.toMatch(/pub_|sec_/);
      // an empty placeholder: no key is invented, and no secret key is named
      expect(after['.env.example']).toMatch(new RegExp(`^${envVar}=$`, 'm'));
      expect(after['.env.example']).not.toMatch(/=\s*pub_|sec_|SECRET/);

      expect(output).toContain(DASHBOARD_URL);
      expect(output).toContain(VERIFY_DOCS_URL);
    });

    it('changes nothing on a dry run, and says what it would do', async () => {
      const dir = project(files);
      const before = snapshot(dir);
      const { code, output } = await run(dir, { dryRun: true, yes: true });

      expect(code).toBe(0);
      expect(snapshot(dir)).toEqual(before);
      expect(output).toContain(`create ${initFile}`);
      expect(output).toContain('create .env.example');
      expect(output).toContain(`${envVar}=`);
    });

    it('leaves an existing init file alone and prints the snippet', async () => {
      const dir = project({ ...files, [initFile]: '// mine\n' });
      const before = snapshot(dir);
      const { code, output } = await run(dir, { yes: true });

      expect(code).toBe(0);
      expect(snapshot(dir)).toEqual(before);
      expect(output).toContain(`${initFile} already exists`);
      expect(output).toContain(reads);
    });
  });

  it('types the generated file for the project: no TypeScript syntax in a JavaScript project', async () => {
    const js = project({ 'package.json': pkg({ react: '19.0.0', vite: '8.0.0' }), 'src/main.jsx': '' });
    await run(js, { yes: true });
    expect(read(js, 'src/shield.js')).not.toMatch(/: void| as string/);

    const ts = project({ 'package.json': pkg({ react: '19.0.0', vite: '8.0.0' }), 'tsconfig.json': '{}', 'src/main.tsx': '' });
    await run(ts, { yes: true });
    expect(read(ts, 'src/shield.ts')).toMatch(/: void/);
  });

  it('does not create a .ts file next to an existing .js one', async () => {
    const dir = project({ 'package.json': pkg({ vue: '3.5.0', vite: '8.0.0' }), 'tsconfig.json': '{}', 'src/shield.js': '// mine\n' });
    const before = snapshot(dir);
    const { output } = await run(dir, { yes: true });
    expect(snapshot(dir)).toEqual(before);
    expect(output).toContain('src/shield.js already exists');
  });

  it.each([
    ['pnpm-lock.yaml', {}, 'pnpm add @findip/shield'],
    ['yarn.lock', {}, 'yarn add @findip/shield'],
    ['bun.lock', {}, 'bun add @findip/shield'],
    ['package-lock.json', {}, 'npm install @findip/shield'],
    ['package-lock.json', { packageManager: 'pnpm@10.0.0' }, 'pnpm add @findip/shield'],
  ])('prints the install command for the package manager (%s %o)', async (lockfile, extra, command) => {
    const dir = project({ 'package.json': pkg({ astro: '7.0.0' }, extra), [lockfile]: '' });
    const { output } = await run(dir, { dryRun: true });
    expect(output).toContain(command);
    expect(output).toContain('does not run it for you');
    expect(existsSync(join(dir, 'node_modules'))).toBe(false);
  });

  it('does not repeat the install command when the SDK is already a dependency', async () => {
    const dir = project({ 'package.json': pkg({ astro: '7.0.0', '@findip/shield': '^1.11.0' }) });
    const { output } = await run(dir, { yes: true });
    expect(output).not.toContain('npm install');
    expect(existsSync(join(dir, 'src/lib/shield.js'))).toBe(true);
  });

  it('changes nothing when the project already uses Shield', async () => {
    const dir = project({
      'package.json': pkg({ react: '19.0.0', vite: '8.0.0' }),
      'src/analytics.js': "import { init } from '@findip/shield';\n",
      'node_modules/other/index.js': "require('@findip/shield');\n",
    });
    const before = snapshot(dir);
    const { code, output } = await run(dir, { yes: true, siteKey: 'pub_abc123' });

    expect(code).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    expect(output).toContain('src/analytics.js already uses FindIP Shield');
    expect(output).toContain('VITE_FINDIP_SHIELD_SITE_KEY');
  });

  it('is safe to run twice', async () => {
    const dir = project(FRAMEWORKS[4].files);
    await run(dir, { yes: true });
    const first = snapshot(dir);
    const { output } = await run(dir, { yes: true });
    expect(snapshot(dir)).toEqual(first);
    expect(output).toContain('No files will be changed');
  });

  it('asks before writing, and writes nothing on a no', async () => {
    const dir = project(FRAMEWORKS[0].files);
    const before = snapshot(dir);
    const declined = await run(dir, { answer: false });
    expect(declined.asked).toBe(1);
    expect(snapshot(dir)).toEqual(before);
    expect(declined.output).toContain('Nothing was changed');

    const accepted = await run(dir, { answer: true });
    expect(accepted.asked).toBe(1);
    expect(existsSync(join(dir, 'app/shield.tsx'))).toBe(true);
  });

  it('adds to an existing .env.example without touching its lines', async () => {
    const dir = project({ ...ASTRO.files, '.env.example': 'DATABASE_URL=\nAPI_TOKEN=' });
    await run(dir, { yes: true });
    const env = read(dir, '.env.example');
    expect(env.startsWith('DATABASE_URL=\nAPI_TOKEN=\n\n# FindIP Shield')).toBe(true);
    expect(env.endsWith('PUBLIC_FINDIP_SHIELD_SITE_KEY=\n')).toBe(true);
  });

  it('leaves .env.example alone when it already has the variable', async () => {
    const dir = project({ ...ASTRO.files, '.env.example': 'PUBLIC_FINDIP_SHIELD_SITE_KEY=pub_xxx\n' });
    await run(dir, { yes: true });
    expect(read(dir, '.env.example')).toBe('PUBLIC_FINDIP_SHIELD_SITE_KEY=pub_xxx\n');
    expect(existsSync(join(dir, 'src/lib/shield.ts'))).toBe(true);
  });

  describe('--site-key', () => {
    it('puts the given key in .env.local and keeps the placeholder in .env.example empty', async () => {
      const dir = project({ ...FRAMEWORKS[0].files, '.env.local': 'OTHER=1\n' });
      await run(dir, { yes: true, siteKey: 'pub_abc123' });
      expect(read(dir, '.env.local')).toBe('OTHER=1\n\n# FindIP Shield public site key\nNEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY=pub_abc123\n');
      expect(read(dir, '.env.example')).toMatch(/^NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY=$/m);
      expect(read(dir, 'app/shield.tsx')).not.toContain('pub_abc123');
    });

    it('never replaces a key that .env.local already sets', async () => {
      const dir = project({ ...FRAMEWORKS[0].files, '.env.local': 'NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY=pub_existing\n' });
      await run(dir, { yes: true, siteKey: 'pub_abc123' });
      expect(read(dir, '.env.local')).toBe('NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY=pub_existing\n');
    });

    it('writes no .env.local without a key', async () => {
      const dir = project(FRAMEWORKS[0].files);
      const { output } = await run(dir, { yes: true });
      expect(existsSync(join(dir, '.env.local'))).toBe(false);
      expect(output).toContain('Set NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY to your public site key');
    });

    it.each(['sec_abcdef', 'abcdef', '', 'pub_abc"><script>'])('refuses %j and writes nothing', async (siteKey) => {
      const dir = project(FRAMEWORKS[0].files);
      const before = snapshot(dir);
      const { code, output } = await run(dir, { yes: true, siteKey });
      expect(code).toBe(1);
      expect(snapshot(dir)).toEqual(before);
      expect(output).toMatch(/pub_/);
      if (siteKey) expect(output).not.toContain(siteKey);
    });
  });

  describe('plain HTML', () => {
    it('prints the script tag and writes nothing', async () => {
      const dir = project({ 'index.html': '<!doctype html><html><body><h1>Hi</h1></body></html>' });
      const before = snapshot(dir);
      const { code, asked, output } = await run(dir);

      expect(code).toBe(0);
      expect(asked).toBe(0);
      expect(snapshot(dir)).toEqual(before);
      expect(output).toContain('Found: Plain HTML');
      expect(output).toContain('src="https://cdn.findip.net/shield/v1.js"');
      expect(output).toContain('data-site-key="YOUR_PUBLIC_SITE_KEY"');
      expect(output).not.toMatch(/data-site-key="pub_/);
      expect(output).not.toContain('npm install');
      expect(output).toContain(DASHBOARD_URL);
      expect(output).toContain(VERIFY_DOCS_URL);
    });

    it('puts a given site key in the printed tag', async () => {
      const dir = project({ 'index.html': '<html></html>', 'package.json': pkg({ serve: '14.0.0' }) });
      const { output } = await run(dir, { siteKey: 'pub_abc123' });
      expect(output).toContain('data-site-key="pub_abc123"');
    });

    it('says so when the page already loads Shield', async () => {
      const dir = project({ 'index.html': '<script src="https://cdn.findip.net/shield/v1.js" data-site-key="pub_abc123"></script>' });
      const { output } = await run(dir);
      expect(output).toContain('index.html already loads FindIP Shield');
      expect(output).not.toContain('Add this tag');
    });

    it('is not chosen for an index.html that a bundler builds', () => {
      const dir = project({ 'index.html': '<html></html>', 'package.json': pkg({ vite: '8.0.0', lit: '3.0.0' }) });
      expect(detectProject(dir).framework).toBeNull();
    });
  });

  it('explains itself and exits with 1 when it finds no supported project', async () => {
    for (const files of [{}, { 'package.json': pkg({ nuxt: '4.0.0', vue: '3.5.0', vite: '8.0.0' }) }] as Record<string, string>[]) {
      const dir = project(files);
      const before = snapshot(dir);
      const { code, output } = await run(dir, { yes: true });
      expect(code).toBe(1);
      expect(snapshot(dir)).toEqual(before);
      expect(output).toContain('no supported framework');
      expect(output).toContain(DASHBOARD_URL);
    }
  });

  it('reads the SvelteKit version from the installed package before the declared range', () => {
    const dir = project({
      'package.json': pkg({ '@sveltejs/kit': 'latest' }),
      'node_modules/@sveltejs/kit/package.json': JSON.stringify({ version: '2.20.1' }),
    });
    expect(detectProject(dir).kitMajor).toBe(2);
    expect(detectProject(project({ 'package.json': pkg({ '@sveltejs/kit': 'latest' }) })).kitMajor).toBe(3);
  });

  it('tells a SvelteKit 3 project to declare the variable in src/env.ts', async () => {
    const { output } = await run(project(FRAMEWORKS[7].files), { dryRun: true });
    expect(output).toContain('Declare the variable in src/env.ts');
    expect(output).toContain('PUBLIC_FINDIP_SHIELD_SITE_KEY: { public: true');
  });

  it('plans without touching the disk', () => {
    const dir = project(FRAMEWORKS[6].files);
    const before = snapshot(dir);
    const plan = planInit(dir);
    expect(plan.writes.map((write: { file: string }) => write.file)).toEqual(['.env.example', 'src/hooks.client.ts']);
    expect(snapshot(dir)).toEqual(before);
  });

  describe('the shipped command', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

    it('is declared as the package bin and included in the published files', () => {
      expect(manifest.bin).toEqual({ 'findip-shield': './cli/findip-shield.js' });
      expect(manifest.files).toContain('cli');
      expect(manifest.dependencies ?? {}).toEqual({});
      expect(readFileSync(CLI, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    });

    it('uses the file system only: no network, no child process', () => {
      for (const file of ['findip-shield.js', 'init.js']) {
        const source = readFileSync(join(ROOT, 'cli', file), 'utf8');
        const nodeModules = [...source.matchAll(/from '(node:[^']+)'/g)].map((match) => match[1]);
        for (const name of nodeModules) expect(['node:fs', 'node:path', 'node:readline']).toContain(name);
        expect(source).not.toMatch(/\bfetch\(|\brequire\(|\bimport\(|XMLHttpRequest|WebSocket/);
      }
    });

    it('runs from the command line', () => {
      const dir = project(FRAMEWORKS[4].files);
      const node = (args: string[]) => execFileSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

      expect(node(['--help'])).toContain('npx @findip/shield init');
      expect(node(['init', '--dry-run'])).toContain('Dry run');
      expect(existsSync(join(dir, 'src/shield.ts'))).toBe(false);

      // no terminal to ask on: nothing is written without --yes
      expect(node(['init'])).toContain('Nothing was changed');
      expect(existsSync(join(dir, 'src/shield.ts'))).toBe(false);

      expect(node(['init', '--yes', '--site-key=pub_abc123'])).toContain('Done: .env.example, .env.local, src/shield.ts');
      expect(read(dir, '.env.local')).toContain('VITE_FINDIP_SHIELD_SITE_KEY=pub_abc123');

      expect(() => node(['deploy'])).toThrow();
      expect(() => node(['init', '--force'])).toThrow();
    });
  });
});
