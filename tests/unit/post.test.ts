import { describe, expect, it } from 'vitest';
import { extractPost } from '@/lib/post/extract';

function dom(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe('extractPost', () => {
  it('finds the article around the clicked element and pulls out the parts', () => {
    const doc = dom(`
      <div id="feed">
        <article data-testid="tweet">
          <div><a href="/someone" data-testid="User-Name">Some One</a> <a href="/someone/status/123"><time datetime="2026-10-11T10:00:00Z">Oct 11</time></a></div>
          <div id="body">Firefox is dropping Manifest V2 add-on support next month. Say goodbye to real ad blocking. <a href="https://news.example/firefox-mv2">news.example/firefox-mv2</a></div>
          <img src="https://cdn.example/photo.jpg" width="600" height="400" alt="screenshot">
          <img src="https://cdn.example/avatar.png" width="40" height="40" alt="avatar">
          <button>Like</button>
        </article>
        <article><p>Another unrelated post with enough text to count as a container.</p></article>
      </div>`);
    const target = doc.getElementById('body')!;
    const post = extractPost(target, doc)!;
    expect(post).not.toBeNull();
    expect(post.kind).toBe('post');
    expect(post.author).toBe('Some One');
    expect(post.postedAt).toBe('2026-10-11T10:00:00Z');
    expect(post.permalink).toMatch(/\/someone\/status\/123$/);
    expect(post.text).toContain('Firefox is dropping Manifest V2');
    expect(post.text).not.toContain('Like');
    expect(post.text).not.toContain('unrelated');
    expect(post.images).toEqual(['https://cdn.example/photo.jpg']);
    expect(post.links).toEqual(['https://news.example/firefox-mv2']);
  });

  it('falls back to a text-sized ancestor when there is no article element', () => {
    const doc = dom(`<div><div><span id="t">Short.</span><p>${'word '.repeat(40)}</p></div></div>`);
    const post = extractPost(doc.getElementById('t'), doc)!;
    expect(post).not.toBeNull();
    expect(post.text.length).toBeGreaterThan(80);
  });

  it('returns null for nothing useful', () => {
    const doc = dom(`<div><span id="t">Hi</span></div>`);
    expect(extractPost(doc.getElementById('t'), doc)).toBeNull();
  });
});

describe('post text layout', () => {
  it('keeps line breaks between blocks even without whitespace in the markup', () => {
    const doc = dom(
      '<article><div><span id="t">Jane Doe</span><span>@jane</span><span>3h</span></div><div>First paragraph of the post.</div><div>Second paragraph.</div></article>',
    );
    const post = extractPost(doc.getElementById('t'), doc)!;
    expect(post.text).toContain('Jane Doe @jane 3h\nFirst paragraph of the post.\nSecond paragraph.');
  });
  it('never keeps a javascript: permalink or link', () => {
    const doc = dom(
      '<article><p id="t">Enough text in here to count as a post for the extractor.</p><a href="javascript:alert(1)" rel="bookmark">perma</a><a href="javascript:void(0)">x</a></article>',
    );
    const post = extractPost(doc.getElementById('t'), doc)!;
    expect(post.permalink).toBeUndefined();
    expect(post.links).toEqual([]);
  });
});
