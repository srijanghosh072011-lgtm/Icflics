#!/usr/bin/env node
/**
 * Rewrite the domain, contact email and brand name across the whole site.
 *
 *   npm run set-domain -- --domain https://icflic.com
 *   npm run set-domain -- --domain https://newname.com --email hi@newname.com --brand Icflics
 *   npm run set-domain -- --domain https://newname.com --dry-run
 *
 * These three values appear in canonical URLs, OpenGraph tags, JSON-LD,
 * robots.txt, the sitemap and the page copy. Editing them by hand means
 * missing some, which quietly breaks canonical URLs and structured data.
 *
 * Run `npm run sitemap && npm run check` afterwards.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The values currently in the files. Update these if you run the script twice.
const CURRENT = {
  domain: 'https://icflic.com',
  email: 'hello@icflic.com',
  brand: 'Icflic',
};

const TARGETS = ['public', 'docs'];
const EXTENSIONS = ['.html', '.txt', '.xml', '.json', '.webmanifest', '.md', '.js', '.css'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'dry-run') { out.dryRun = true; continue; }
    out[key] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (!args.domain && !args.email && !args.brand) {
  console.error(`Usage:
  npm run set-domain -- --domain https://example.com [--email hi@example.com] [--brand Name] [--dry-run]`);
  process.exit(1);
}

if (args.domain) {
  if (!/^https:\/\/[a-z0-9.-]+[a-z]$/i.test(args.domain)) {
    console.error(`Domain must look like https://example.com (no trailing slash, https only). Got: ${args.domain}`);
    process.exit(1);
  }
  // A domain change implies the email domain too, unless one was given.
  if (!args.email) {
    const host = new URL(args.domain).hostname.replace(/^www\./, '');
    args.email = `${CURRENT.email.split('@')[0]}@${host}`;
    console.log(`No --email given; deriving ${args.email}`);
  }
}

const replacements = [
  args.domain && [CURRENT.domain, args.domain],
  args.email && [CURRENT.email, args.email],
  args.brand && [CURRENT.brand, args.brand],
].filter(Boolean);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'fonts', 'img'].includes(entry.name)) continue;
      yield* walk(full);
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield full;
    }
  }
}

let changedFiles = 0;
let changedTokens = 0;

for (const target of TARGETS) {
  for await (const file of walk(join(ROOT, target))) {
    const original = await readFile(file, 'utf8');
    let updated = original;

    for (const [from, to] of replacements) {
      const count = updated.split(from).length - 1;
      if (count) {
        updated = updated.split(from).join(to);
        changedTokens += count;
      }
    }

    if (updated !== original) {
      changedFiles++;
      console.log(`  ${args.dryRun ? '[dry-run] ' : ''}${relative(ROOT, file)}`);
      if (!args.dryRun) await writeFile(file, updated, 'utf8');
    }
  }
}

console.log(`\n${changedTokens} replacement(s) across ${changedFiles} file(s).`);

if (args.dryRun) {
  console.log('Dry run: nothing written.');
} else if (changedFiles) {
  console.log('\nNow run:  npm run sitemap && npm run check');
  console.log('Then update the CURRENT values at the top of this script so a');
  console.log('second run has the right starting point.');
}
