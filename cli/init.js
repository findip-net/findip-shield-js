// `npx @findip/shield init`: adds FindIP Shield to the project in the current
// directory. It reads the project, prints what it found and what it will
// change, and creates at most three things: a line in .env.example, a line in
// .env.local (only with --site-key) and one new init file. It never edits or
// overwrites a source file, never writes a secret key, and makes no network
// request.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export const PACKAGE_NAME = '@findip/shield';
export const DASHBOARD_URL = 'https://www.findip.net/shield';
export const VERIFY_DOCS_URL = 'https://www.findip.net/docs/shield/server-verification';
export const SITE_KEY_PATTERN = /^pub_[A-Za-z0-9_-]+$/;
const CDN_SCRIPT = 'https://cdn.findip.net/shield/v1.js';
const KEY_PLACEHOLDER = 'YOUR_PUBLIC_SITE_KEY';

const INIT_CALL = `init({
    siteKey,
    privacyMode: 'balanced',
    autoTrack: true, // page views
    autoDetectForms: true, // reports form submits, e.g. a signup form as \`signup_attempt\`
  });`;

/** A React component for Next.js: both routers render it once, in the browser. */
function nextComponent(envVar) {
  return `'use client';

import { useEffect } from 'react';
import { init } from '${PACKAGE_NAME}';

let started = false;

/** Starts FindIP Shield once, in the browser. Renders nothing. */
export function Shield() {
  useEffect(() => {
    const siteKey = process.env.${envVar};
    if (started || !siteKey) return;
    started = true;

    ${INIT_CALL.replace(/\n/g, '\n  ')}
  }, []);

  return null;
}
`;
}

/** A `startShield()` module for apps that Vite bundles for the browser. */
function viteModule(envVar, ts) {
  return `import { init } from '${PACKAGE_NAME}';

let started = false;

/** Starts FindIP Shield once. Browser only. */
export function startShield()${ts ? ': void' : ''} {
  const siteKey = import.meta.env.${envVar}${ts ? ' as string | undefined' : ''};
  if (started || !siteKey || typeof window === 'undefined') return;
  started = true;

  ${INIT_CALL}
}
`;
}

/**
 * SvelteKit loads src/hooks.client once, when the app starts in the browser.
 * SvelteKit 3 reads public variables from `$app/env/public` (declared in
 * src/env.ts); earlier versions read them from `$env/dynamic/public`.
 */
function svelteKitHooks(envVar, kitMajor) {
  const [source, value] = kitMajor >= 3
    ? [`import { ${envVar} } from '$app/env/public';`, envVar]
    : ["import { env } from '$env/dynamic/public';", `env.${envVar}`];
  return `import { init } from '${PACKAGE_NAME}';
${source}

// FindIP Shield: started once, in the browser, when the app starts.
const siteKey = ${value};
if (siteKey) {
  ${INIT_CALL}
}
`;
}

/**
 * One entry per supported framework: the env variable that holds the public
 * site key, the file `init` creates, and the one step left to the developer.
 */
const FRAMEWORKS = {
  'next-app': {
    label: 'Next.js (App Router)',
    envVar: 'NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY',
    initFile: ({ src, ts }) => `${src}app/shield.${ts ? 'tsx' : 'jsx'}`,
    content: ({ envVar }) => nextComponent(envVar),
    wiring: ({ src, ts }) =>
      `Render it once in ${src}app/layout.${ts ? 'tsx' : 'jsx'}, inside <body>:\n\n` +
      `  import { Shield } from './shield';\n  ...\n  <body>\n    <Shield />\n    {children}\n  </body>`,
  },
  'next-pages': {
    label: 'Next.js (Pages Router)',
    envVar: 'NEXT_PUBLIC_FINDIP_SHIELD_SITE_KEY',
    initFile: ({ src, ts }) => `${src}components/shield.${ts ? 'tsx' : 'jsx'}`,
    content: ({ envVar }) => nextComponent(envVar),
    wiring: ({ src, ts }) =>
      `Render it once in ${src}pages/_app.${ts ? 'tsx' : 'jsx'}, next to <Component />:\n\n` +
      `  import { Shield } from '../components/shield';\n  ...\n  <Shield />\n  <Component {...pageProps} />`,
  },
  'react-vite': {
    label: 'React + Vite',
    envVar: 'VITE_FINDIP_SHIELD_SITE_KEY',
    initFile: ({ ts }) => `src/shield.${ts ? 'ts' : 'js'}`,
    content: ({ envVar, ts }) => viteModule(envVar, ts),
    wiring: ({ ts }) =>
      `Call it once in src/main.${ts ? 'tsx' : 'jsx'}, before createRoot():\n\n` +
      `  import { startShield } from './shield';\n\n  startShield();`,
  },
  'vue-vite': {
    label: 'Vue + Vite',
    envVar: 'VITE_FINDIP_SHIELD_SITE_KEY',
    initFile: ({ ts }) => `src/shield.${ts ? 'ts' : 'js'}`,
    content: ({ envVar, ts }) => viteModule(envVar, ts),
    wiring: ({ ts }) =>
      `Call it once in src/main.${ts ? 'ts' : 'js'}, before createApp():\n\n` +
      `  import { startShield } from './shield';\n\n  startShield();`,
  },
  sveltekit: {
    label: 'SvelteKit',
    envVar: 'PUBLIC_FINDIP_SHIELD_SITE_KEY',
    initFile: ({ ts }) => `src/hooks.client.${ts ? 'ts' : 'js'}`,
    content: ({ envVar, kitMajor }) => svelteKitHooks(envVar, kitMajor),
    wiring: ({ envVar, kitMajor, ts }) =>
      kitMajor >= 3
        ? `SvelteKit loads src/hooks.client when the app starts in the browser. Declare the variable in src/env.${ts ? 'ts' : 'js'}:\n\n` +
          `  import { defineEnvVars } from '@sveltejs/kit/env';\n\n` +
          `  export const variables = defineEnvVars({\n    ${envVar}: { public: true, schema: (value) => value || undefined },\n  });`
        : 'Nothing else to add: SvelteKit loads src/hooks.client when the app starts in the browser.',
  },
  astro: {
    label: 'Astro',
    envVar: 'PUBLIC_FINDIP_SHIELD_SITE_KEY',
    initFile: ({ ts }) => `src/lib/shield.${ts ? 'ts' : 'js'}`,
    content: ({ envVar, ts }) => viteModule(envVar, ts),
    wiring: () =>
      'Call it from a <script> in your base layout, before </body>:\n\n' +
      `  <script>\n    import { startShield } from '../lib/shield';\n\n    startShield();\n  </script>`,
  },
};

const BUNDLERS = ['vite', 'webpack', 'parcel', 'rollup', 'esbuild', '@angular/core', 'nuxt', 'react-scripts', 'gatsby', '@remix-run/dev'];
const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?)$/;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor']);
const REFERENCES = [PACKAGE_NAME, 'cdn.findip.net/shield', 'FindIP.init'];
const MAX_SCANNED_FILES = 5000;
const MAX_SCANNED_BYTES = 1024 * 1024;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The major version of an installed dependency, else of its declared range; null when neither says. */
function majorVersion(cwd, name, range) {
  const installed = readJson(join(cwd, 'node_modules', name, 'package.json'))?.version;
  const major = /\d+/.exec(installed ?? range ?? '');
  return major ? Number(major[0]) : null;
}

function packageManager(cwd, pkg) {
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : '';
  const lockfiles = { 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lock': 'bun', 'bun.lockb': 'bun' };
  const found = Object.keys(lockfiles).find((file) => existsSync(join(cwd, file)));
  const name = ['pnpm', 'yarn', 'bun'].includes(declared) ? declared : found ? lockfiles[found] : 'npm';
  return { name, install: `${name} ${name === 'npm' ? 'install' : 'add'} ${PACKAGE_NAME}` };
}

/** What kind of project `cwd` is. `framework` is null when it is none of the supported ones. */
export function detectProject(cwd) {
  const pkg = readJson(join(cwd, 'package.json'));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const has = (name) => name in deps;
  const dir = (path) => isDir(join(cwd, path));

  let framework = null;
  let src = '';
  if (has('next')) {
    const pagesOnly = !dir('app') && !dir('src/app') && (dir('pages') || dir('src/pages'));
    framework = pagesOnly ? 'next-pages' : 'next-app';
    src = dir('src/app') || (pagesOnly && dir('src/pages')) ? 'src/' : '';
  } else if (has('@sveltejs/kit')) framework = 'sveltekit';
  else if (has('astro')) framework = 'astro';
  else if (has('nuxt')) framework = null;
  else if (has('vite') && has('vue')) framework = 'vue-vite';
  else if (has('vite') && has('react')) framework = 'react-vite';
  else if (existsSync(join(cwd, 'index.html')) && !BUNDLERS.some(has)) framework = 'html';

  return {
    framework,
    label: framework === 'html' ? 'Plain HTML' : (FRAMEWORKS[framework]?.label ?? null),
    src,
    ts: existsSync(join(cwd, 'tsconfig.json')) || has('typescript'),
    // an unreadable version ("latest", a workspace link) is taken as the current major
    kitMajor: framework === 'sveltekit' ? (majorVersion(cwd, '@sveltejs/kit', deps['@sveltejs/kit']) ?? 3) : null,
    hasPackageJson: pkg !== null,
    hasDependency: has(PACKAGE_NAME),
    packageManager: pkg ? packageManager(cwd, pkg) : null,
  };
}

/** The first source file that already mentions Shield, relative to `cwd`, or null. */
export function findExistingReference(cwd) {
  let scanned = 0;
  const walk = (folder) => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
        const hit = walk(path);
        if (hit) return hit;
      } else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) {
        if (++scanned > MAX_SCANNED_FILES) return null;
        try {
          if (statSync(path).size > MAX_SCANNED_BYTES) continue;
          const text = readFileSync(path, 'utf8');
          if (REFERENCES.some((needle) => text.includes(needle))) return path;
        } catch {
          // unreadable file: skip it
        }
      }
    }
    return null;
  };
  const hit = walk(cwd);
  return hit ? relative(cwd, hit).split(sep).join('/') : null;
}

function scriptTag(siteKey) {
  return `<script
  src="${CDN_SCRIPT}"
  data-site-key="${siteKey ?? KEY_PLACEHOLDER}"
  data-auto-track="true"
  data-privacy-mode="balanced">
</script>`;
}

/** The line a .env file needs, or null when the file already sets the variable. */
function envLine(cwd, file, envVar, value, comment) {
  const path = join(cwd, file);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current !== null && new RegExp(`^\\s*${envVar}\\s*=`, 'm').test(current)) return null;
  const gap = current === null || current === '' ? '' : current.endsWith('\n') ? '\n' : '\n\n';
  return {
    file,
    action: current === null ? 'create' : 'append',
    content: `${gap}# ${comment}\n${envVar}=${value}\n`,
  };
}

/**
 * Everything `init` would do in `cwd`, without doing it.
 * `writes` are the file changes; `snippets` are printed for the developer to
 * place by hand; `unchanged` says why nothing is written, when that is so.
 */
export function planInit(cwd, options = {}) {
  const siteKey = options.siteKey ?? null;
  const project = detectProject(cwd);
  const plan = { project, install: null, writes: [], snippets: [], unchanged: null };

  if (project.framework === null) {
    plan.unchanged = 'no supported framework was found here';
    return plan;
  }

  if (project.framework === 'html') {
    const reference = findExistingReference(cwd);
    if (reference) {
      plan.unchanged = `${reference} already loads FindIP Shield`;
      plan.snippets.push({ title: 'For reference, the tag:', code: scriptTag(siteKey) });
      return plan;
    }
    plan.unchanged = 'a plain HTML site needs one tag, which you add yourself';
    plan.snippets.push({ title: 'Add this tag before </body> on every page:', code: scriptTag(siteKey) });
    if (!siteKey) {
      plan.snippets.push({ title: `Replace ${KEY_PLACEHOLDER} with the public site key (pub_...) from the dashboard.` });
    }
    return plan;
  }

  const framework = FRAMEWORKS[project.framework];
  const context = { ...project, envVar: framework.envVar };
  const initFile = framework.initFile(context);
  const initCode = framework.content(context);
  const reference = findExistingReference(cwd);
  const sibling = initFile.replace(/\.[jt]s(x?)$/, (_, x) => (project.ts ? `.js${x}` : `.ts${x}`));
  const existing = [initFile, sibling].find((file) => existsSync(join(cwd, file)));

  if (!project.hasDependency) plan.install = project.packageManager.install;

  if (reference) {
    plan.unchanged = `${reference} already uses FindIP Shield`;
  } else if (existing) {
    plan.unchanged = `${existing} already exists and is left as it is`;
  }

  if (plan.unchanged) {
    plan.snippets.push({ title: `For reference, the init code for ${framework.label} (${initFile}):`, code: initCode.trimEnd() });
    plan.snippets.push({ title: `The site key is read from ${framework.envVar}.` });
    return plan;
  }

  const example = envLine(cwd, '.env.example', framework.envVar, '',
    `FindIP Shield public site key (pub_...), from ${DASHBOARD_URL}. Safe to expose to the browser.`);
  if (example) plan.writes.push(example);
  if (siteKey) {
    const local = envLine(cwd, '.env.local', framework.envVar, siteKey, 'FindIP Shield public site key');
    if (local) plan.writes.push(local);
  } else {
    plan.snippets.push({ title: `Set ${framework.envVar} to your public site key (pub_...) in .env.local and in your deployment's settings.` });
  }
  plan.writes.push({ file: initFile, action: 'create', content: initCode });
  plan.snippets.push({ title: framework.wiring(context) });
  return plan;
}

/** The plan as the text the command prints. */
export function formatPlan(plan, { dryRun = false } = {}) {
  const { project } = plan;
  const lines = [];

  if (project.framework === null) {
    lines.push(
      'FindIP Shield: no supported framework found in this directory.',
      '',
      'Run this command in the root of a Next.js, React + Vite, Vue + Vite, SvelteKit or Astro project,',
      'or of a plain HTML site with an index.html. For any other setup:',
      '',
      `  npm:        npm install ${PACKAGE_NAME}, then call init({ siteKey }) once in browser code`,
      `  script tag: <script src="${CDN_SCRIPT}" data-site-key="${KEY_PLACEHOLDER}"></script>`,
    );
    return lines.join('\n');
  }

  lines.push(`Found: ${project.label}${project.framework === 'html' ? '' : project.ts ? ', TypeScript' : ', JavaScript'}` +
    (project.packageManager ? `, ${project.packageManager.name}` : ''));
  lines.push('');

  if (plan.unchanged) {
    lines.push(`No files will be changed: ${plan.unchanged}.`);
  } else {
    lines.push(dryRun ? 'Dry run. These changes would be made:' : 'Changes:');
    for (const write of plan.writes) {
      const what = write.action === 'create' ? 'create' : 'add to';
      lines.push(`  ${what} ${write.file}`);
      for (const line of write.content.trim().split('\n')) lines.push(`      ${line}`);
    }
  }

  if (plan.install) {
    lines.push('', 'Install the SDK (this command does not run it for you):', '', `  ${plan.install}`);
  }

  for (const snippet of plan.snippets) {
    lines.push('', snippet.title);
    if (snippet.code) lines.push('', ...snippet.code.split('\n').map((line) => `  ${line}`));
  }
  return lines.join('\n');
}

/** Writes the plan's files. A file that appeared since the plan was made is never overwritten. */
export function applyPlan(cwd, plan) {
  const written = [];
  for (const write of plan.writes) {
    const path = join(cwd, write.file);
    mkdirSync(dirname(path), { recursive: true });
    if (write.action === 'create') writeFileSync(path, write.content, { flag: 'wx' });
    else appendFileSync(path, write.content);
    written.push(write.file);
  }
  return written;
}

export function closingLines() {
  return [
    `Dashboard (site key, allowed domains, your first visit): ${DASHBOARD_URL}`,
    `Server verification (where the decision is made):       ${VERIFY_DOCS_URL}`,
  ].join('\n');
}

/**
 * Runs `init`. `log` receives the output; `confirm` is asked before writing
 * unless `yes` is set. Returns the exit code.
 */
export async function runInit({ cwd, siteKey = null, dryRun = false, yes = false, log, confirm }) {
  if (siteKey !== null && !SITE_KEY_PATTERN.test(siteKey)) {
    log(/^sec_/.test(siteKey)
      ? 'That is a secret key. It belongs on your server only; pass the public site key (pub_...) here.'
      : 'The site key should be the public key from the dashboard, starting with pub_.');
    return 1;
  }

  const plan = planInit(cwd, { siteKey });
  log(formatPlan(plan, { dryRun }));

  if (plan.project.framework !== null && !plan.unchanged && !dryRun) {
    if (!yes && !(await confirm('\nMake these changes? [y/N] '))) {
      log('\nNothing was changed. Run again with --yes to apply.');
    } else {
      const written = applyPlan(cwd, plan);
      log(`\nDone: ${written.join(', ')}`);
    }
  }

  log(`\n${closingLines()}`);
  return plan.project.framework === null ? 1 : 0;
}
