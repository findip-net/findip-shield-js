#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { runInit } from './init.js';

const HELP = `Usage: npx @findip/shield init [options]

Adds FindIP Shield to the project in the current directory. Detects Next.js,
React + Vite, Vue + Vite, SvelteKit, Astro or a plain HTML site, prints what
it will change, and asks before writing.

Options:
  --site-key <pub_...>  Your public site key (never the secret key)
  --dry-run             Print the changes without making them
  --yes, -y             Make the changes without asking
  --help, -h            Show this help
`;

function parseArgs(argv) {
  const options = { command: null, siteKey: null, dryRun: false, yes: false, help: false, error: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--site-key') options.siteKey = argv[(i += 1)] ?? '';
    else if (arg.startsWith('--site-key=')) options.siteKey = arg.slice('--site-key='.length);
    else if (!arg.startsWith('-') && options.command === null) options.command = arg;
    else options.error = `Unknown option: ${arg}`;
  }
  return options;
}

/** Asks on the terminal. Without a terminal (CI, a coding agent) the answer is no. */
function confirm(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    prompt.question(question, (answer) => {
      prompt.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

const options = parseArgs(process.argv.slice(2));

if (options.error || (options.command !== 'init' && !options.help)) {
  console.error(options.error ?? (options.command ? `Unknown command: ${options.command}` : 'Missing command.'));
  console.error(`\n${HELP}`);
  process.exitCode = 1;
} else if (options.help) {
  console.log(HELP);
} else {
  process.exitCode = await runInit({
    cwd: process.cwd(),
    siteKey: options.siteKey,
    dryRun: options.dryRun,
    yes: options.yes,
    log: (text) => console.log(text),
    confirm,
  });
}
