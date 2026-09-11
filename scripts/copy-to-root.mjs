#!/usr/bin/env node
/**
 * Copy the built preview from dist/ to the repository root.
 *
 *   npm run preview:root
 *
 * WHY THIS EXISTS
 * GitHub Pages on this repo is set to "Deploy from a branch" and serves the
 * branch ROOT. That means the root has to contain the built site, or Pages
 * renders README.md through Jekyll instead — which is exactly what it did
 * before these files were added.
 *
 * The source of truth is still public/. These root copies are generated
 * output; re-run this after changing anything in public/ or the preview goes
 * stale. If you switch the Pages source to "GitHub Actions" the workflow in
 * .github/workflows/pages.yml handles it and these root copies can be deleted.
 *
 * None of this affects Cloudflare Pages, which serves public/ directly.
 */

import { readdir, cp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

// Everything the build emits. Kept explicit so this can never scribble over
// package.json, functions/, public/ or anything else that matters.
const ENTRIES = [
  '404.html', 'about', 'apple-touch-icon.png', 'assets', 'book', 'contact',
  'faq', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'index.html',
  'llms.txt', 'owner', 'privacy', 'robots.txt', 'services',
  'site.webmanifest', 'sitemap.xml', 'terms', 'work',
];

const built = new Set(await readdir(DIST));
for (const entry of ENTRIES) {
  if (!built.has(entry)) {
    console.error(`dist/${entry} is missing — run the build first.`);
    process.exit(1);
  }
}

for (const entry of ENTRIES) {
  await rm(join(ROOT, entry), { recursive: true, force: true });
  await cp(join(DIST, entry), join(ROOT, entry), { recursive: true });
}

// Without this, Pages runs the output through Jekyll.
await writeFile(join(ROOT, '.nojekyll'), '', 'utf8');

console.log(`Copied ${ENTRIES.length} entries to the repository root.`);
console.log('Commit them — Pages serves the branch root, not public/.');
