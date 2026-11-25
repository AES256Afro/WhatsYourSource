// Writes public/THIRD_PARTY_NOTICES.txt: the licence text of every package whose code ships in the
// extension bundles, plus the attribution for the Wikipedia data. WXT copies public/ into every build,
// so the file is in each zip. Run after changing dependencies:  npm run notices
// `node scripts/notices.mjs --check` exits 1 when the committed file is out of date (for CI).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'public/THIRD_PARTY_NOTICES.txt');
const DATA = join(ROOT, 'src/data/reliable-sources.json');

/**
 * The packages whose code is in the built bundles: every runtime dependency, their own runtime
 * dependencies (scheduler), and the build tools that put code or CSS in the output (Tailwind, WXT).
 * Build-tool helpers (Vite's preload helper, Rolldown's interop shim) are left out, as is usual.
 * `use` picks the licence for a dual-licensed package.
 */
const PACKAGES = [
  { name: 'react' },
  { name: 'react-dom' },
  { name: 'scheduler' },
  { name: 'zod' },
  { name: 'idb' },
  { name: 'dompurify', use: 'Apache-2.0' },
  { name: '@mozilla/readability' },
  { name: 'exifr' },
  { name: 'tailwindcss', note: 'Generated CSS and the Preflight base styles.' },
  { name: 'wxt', note: 'Runtime wrappers for the background and content scripts.' },
  { name: '@wxt-dev/browser', note: 'The `browser` API shim.' },
];

const RULE = '='.repeat(78);
const APACHE_FROM = 'dompurify';

function pkgDir(name) {
  return join(ROOT, 'node_modules', name);
}

function licenceFiles(dir) {
  return readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f))
    .sort();
}

function authorName(author) {
  if (!author) return '';
  if (typeof author === 'string') return author.replace(/\s*[<(].*$/, '').trim();
  return author.name ?? '';
}

function mitText(holder) {
  return `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
}

function section({ name, use, note }) {
  const dir = pkgDir(name);
  if (!existsSync(join(dir, 'package.json'))) throw new Error(`${name} is not installed: run npm ci first`);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const declared = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN');
  const files = licenceFiles(dir).filter((f) => !(use && /mpl/i.test(f)));
  const lines = [RULE, `${name} ${pkg.version}`, `License: ${declared}${use ? ` (used here under ${use})` : ''}`];
  if (authorName(pkg.author)) lines.push(`Author: ${authorName(pkg.author)}`);
  if (pkg.homepage) lines.push(`Homepage: ${pkg.homepage}`);
  if (note) lines.push(note);
  lines.push(RULE, '');
  if (files.length > 0) {
    for (const f of files) lines.push(readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trimEnd(), '');
    if (name === '@mozilla/readability') lines.push(`The full text of the Apache License 2.0 is reproduced in the ${APACHE_FROM} section of this file.`, '');
  } else if (declared === 'MIT') {
    // The npm package ships no LICENSE file; the standard MIT text with the holder from its author field.
    lines.push(
      `(No licence file in the npm package; standard text for its declared "MIT" licence.)`,
      '',
      mitText(authorName(pkg.author) || `the ${name} authors`),
      '',
    );
  } else {
    throw new Error(`${name}: no licence file and licence "${declared}" has no template here`);
  }
  if (name === APACHE_FROM && !files.some((f) => /apache/i.test(readFileSync(join(dir, f), 'utf8').slice(0, 200)))) {
    throw new Error(`${name}: expected the Apache-2.0 text in its LICENSE file`);
  }
  return lines.join('\n');
}

function dataSection() {
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  return [
    RULE,
    'Outlet ratings: src/data/reliable-sources.json',
    'License: CC BY-SA 4.0 (not MIT)',
    RULE,
    '',
    `Adapted from "Wikipedia:Reliable sources/Perennial sources" by Wikipedia editors,`,
    `${data.source}`,
    `(contributors: the page history, ${data.source}?action=history),`,
    `as retrieved on ${data.updated}.`,
    '',
    'Changes: each entry is reduced to the outlet name, its rating, its domains and a',
    'one-sentence summary, and the list is stored as JSON.',
    '',
    'This adapted data is licensed under the Creative Commons Attribution-ShareAlike 4.0',
    'International licence: https://creativecommons.org/licenses/by-sa/4.0/',
    '',
  ].join('\n');
}

const deps = Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies ?? {});
const missing = deps.filter((d) => !PACKAGES.some((p) => p.name === d));
if (missing.length > 0) throw new Error(`add to PACKAGES in scripts/notices.mjs: ${missing.join(', ')}`);

const text = [
  'WhatsYourSource: third-party notices',
  '',
  'WhatsYourSource is MIT-licensed (see LICENSE in the source repository). The extension bundles',
  'the third-party software and data listed below; each is under its own licence, reproduced here.',
  'Generated by scripts/notices.mjs from node_modules; do not edit by hand.',
  '',
  ...PACKAGES.map(section),
  dataSection(),
].join('\n');

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error('public/THIRD_PARTY_NOTICES.txt is out of date: run npm run notices');
    process.exit(1);
  }
  console.log('public/THIRD_PARTY_NOTICES.txt is up to date');
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT.replace(ROOT, '')} (${PACKAGES.length} packages + Wikipedia data)`);
}
