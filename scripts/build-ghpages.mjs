#!/usr/bin/env node
/**
 * Build a GitHub Pages preview of the site into dist/.
 *
 *   node scripts/build-ghpages.mjs [--base /Icflics]
 *
 * GitHub Pages is a STATIC PREVIEW ONLY. It cannot run the Pages Functions in
 * functions/, so the booking calendar, the contact form and the owner panel
 * are all inert there. Cloudflare Pages remains the real deployment target —
 * see docs/LAUNCH.md.
 *
 * Two things have to change for a project Pages site:
 *   1. It is served from /<repo>/, not /, so every root-absolute URL needs
 *      the repo name prefixed.
 *   2. Pages does not rewrite /work to work.html, so each page becomes
 *      work/index.html instead.
 */

import { readdir, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'public');
const DIST = join(ROOT, 'dist');

const baseArg = process.argv.indexOf('--base');
let BASE = baseArg !== -1 ? process.argv[baseArg + 1] : (process.env.PAGES_BASE || '/Icflics');
BASE = BASE.replace(/\/+$/, '');
if (BASE && !BASE.startsWith('/')) BASE = '/' + BASE;

// Pages that stay put rather than becoming directories.
const KEEP_FLAT = new Set(['index.html', '404.html']);
// Anything with one of these extensions is an asset, not a page.
const ASSET = /\.(webp|jpg|jpeg|png|gif|svg|ico|woff2?|css|js|xml|txt|json|webmanifest|mjs)$/i;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Rewrite one root-absolute URL for the Pages base path. */
function rewriteUrl(url) {
  if (!url.startsWith('/') || url.startsWith('//')) return url;

  // Split off query and hash so they survive the transformation.
  const m = /^([^?#]*)(.*)$/.exec(url);
  let path = m[1];
  const tail = m[2];

  if (path === '/') return `${BASE}/${tail}`;
  if (ASSET.test(path)) return `${BASE}${path}${tail}`;
  if (path.startsWith('/api/')) return `${BASE}${path}${tail}`;

  // A page link: /work -> /Icflics/work/
  if (!path.endsWith('/')) path += '/';
  return `${BASE}${path}${tail}`;
}

function rewriteHtml(html) {
  // href="/…" and src="/…" only. Protocol-relative and absolute URLs untouched.
  return html.replace(/(\b(?:href|src|action)=")(\/[^"]*)(")/g,
    (_, pre, url, post) => pre + rewriteUrl(url) + post);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

let pages = 0;
let assets = 0;

for await (const file of walk(SRC)) {
  const rel = relative(SRC, file).replace(/\\/g, '/');

  // _headers and _redirects are Cloudflare-only; Pages ignores them anyway.
  if (rel === '_headers' || rel === '_redirects') continue;

  if (rel.endsWith('.html')) {
    const html = rewriteHtml(await readFile(file, 'utf8'));
    const name = rel.split('/').pop();

    let outRel;
    if (KEEP_FLAT.has(rel) || rel.endsWith('/index.html')) {
      outRel = rel;                                   // index.html, 404.html, owner/index.html
    } else {
      outRel = rel.replace(/\.html$/, '/index.html'); // work.html -> work/index.html
    }

    const out = join(DIST, outRel);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, html, 'utf8');
    pages++;
  } else {
    const out = join(DIST, rel);
    await mkdir(dirname(out), { recursive: true });
    await cp(file, out);
    assets++;
  }
}

// Stop GitHub running the output through Jekyll, which would drop _-prefixed paths.
await writeFile(join(DIST, '.nojekyll'), '', 'utf8');

console.log(`dist/ built for base "${BASE}": ${pages} pages, ${assets} assets.`);
console.log('Static preview only — the booking backend needs Cloudflare Pages.');
