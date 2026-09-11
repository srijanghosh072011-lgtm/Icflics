#!/usr/bin/env node
/**
 * Regenerate public/sitemap.xml from the HTML files in public/.
 *
 *   npm run sitemap
 *
 * Pages carrying <meta name="robots" content="noindex"> are skipped, as is
 * anything under /owner. Run it whenever you add or remove a page.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const SITE = process.env.SITE_URL || 'https://icflic.com';

// Rough editorial priority. Anything unlisted falls back to 0.5.
const PRIORITY = {
  '/': '1.0',
  '/book': '0.9',
  '/services': '0.9',
  '/work': '0.8',
  '/faq': '0.7',
  '/about': '0.7',
  '/contact': '0.7',
  '/privacy': '0.3',
  '/terms': '0.3',
};

const CHANGEFREQ = {
  '/': 'weekly',
  '/work': 'weekly',
  '/book': 'daily',
};

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'assets' || entry.name === 'owner') continue;
      yield* walk(full);
    } else if (entry.name.endsWith('.html')) {
      yield full;
    }
  }
}

const urls = [];

for await (const file of walk(PUBLIC_DIR)) {
  const html = await readFile(file, 'utf8');

  if (/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html)) continue;

  let route = '/' + relative(PUBLIC_DIR, file).replace(/\\/g, '/');
  route = route.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  if (route !== '/' && route.endsWith('/')) route = route.slice(0, -1);

  urls.push(route);
}

urls.sort((a, b) => (Number(PRIORITY[b] || 0.5) - Number(PRIORITY[a] || 0.5)) || a.localeCompare(b));

const today = new Date().toISOString().slice(0, 10);

const body = urls.map((route) => `  <url>
    <loc>${SITE}${route === '/' ? '/' : route}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${CHANGEFREQ[route] || 'monthly'}</changefreq>
    <priority>${PRIORITY[route] || '0.5'}</priority>
  </url>`).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

await writeFile(join(PUBLIC_DIR, 'sitemap.xml'), xml, 'utf8');
console.log(`sitemap.xml written with ${urls.length} URLs:`);
for (const route of urls) console.log(`  ${SITE}${route}`);
