import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSnapshotSrcdoc } from '@/lib/history/snapshot';

// Vitest runs from the repository root.
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Top-level blocks of a stylesheet: [prelude, body] with comments removed. */
function topLevelBlocks(css: string): [string, string][] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: [string, string][] = [];
  let depth = 0;
  let start = 0;
  let prelude = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') {
      if (depth === 0) {
        prelude = src.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        out.push([prelude, src.slice(start, i)]);
        start = i + 1;
      }
    } else if (c === ';' && depth === 0) {
      start = i + 1; // @import … ;
    }
  }
  return out;
}

describe('app.css cascade', () => {
  const css = read('src/styles/app.css');

  it('has no unlayered element rules (they would beat component classes and utilities)', () => {
    for (const [prelude, body] of topLevelBlocks(css)) {
      if (prelude.startsWith('@layer') || prelude.startsWith('@theme')) continue;
      // The only unlayered block allowed is the dark-theme token override, which sets custom properties on :root.
      expect(prelude).toMatch(/^@media \(prefers-color-scheme: dark\)$/);
      expect(body.replace(/:root\s*\{[^}]*\}/g, '').trim()).toBe('');
    }
  });

  it('limits Tailwind to scanning src/', () => {
    expect(css).toMatch(/@import 'tailwindcss' source\('\.\.\/'\);/);
    expect(css).not.toMatch(/@source '\.\.\/';/);
  });

  it('declares colour scheme, placeholder colour, reduced motion, disabled and forced-colour states', () => {
    expect(css).toContain('color-scheme: light dark');
    expect(css).toMatch(/::placeholder[\s\S]*?color: var\(--color-ink-3\)/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain(".wys-btn[aria-disabled='true']");
    expect(css).toContain('.wys-input:disabled');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain("[role='switch'][aria-checked='true']");
  });
});

describe('shipped notices', () => {
  it('names every runtime dependency and the Wikipedia data licence', () => {
    const notices = read('public/THIRD_PARTY_NOTICES.txt');
    const deps = Object.keys((JSON.parse(read('package.json')) as { dependencies: Record<string, string> }).dependencies);
    for (const d of deps) expect(notices).toMatch(new RegExp(`^${d.replace(/[/.@]/g, '\\$&')} \\d`, 'm'));
    expect(notices).toContain('CC BY-SA 4.0');
    expect(notices).toContain('Apache License');
  });
});

describe('saved page', () => {
  it('keeps the text to a readable width', () => {
    const doc = buildSnapshotSrcdoc({ html: '<p>Hello</p>', title: 't', url: 'https://example.com/', capturedAt: 0 });
    expect(doc).toMatch(/body\{max-width:72ch;margin:0 auto;/);
  });
});
