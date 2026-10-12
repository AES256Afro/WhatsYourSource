import type { StoredCheck, StoredSnapshot } from './db';
import { buildSnapshotSrcdoc, escapeHtml } from './snapshot';

/** One check as a self-contained HTML file: the result card first, the saved page below it. */
export function checkToStandaloneHtml(check: StoredCheck, snapshot?: StoredSnapshot | null): string {
  const r = check.result;
  const e = escapeHtml;
  const subject =
    r.input.kind === 'text' ? `<blockquote>${e(r.input.text)}</blockquote>` : r.input.kind === 'image' ? `<p>Image: <a href="${e(r.input.srcUrl)}">${e(r.input.srcUrl)}</a></p>` : `<p>Page: <a href="${e(r.input.url)}">${e(r.input.url)}</a></p>`;
  const claims = r.claims.length
    ? `<h3>Claims</h3><ul>${r.claims.map((c) => `<li><strong>${e(c.text)}</strong> — ${e(c.status)}${c.note ? `: ${e(c.note)}` : ''}${c.sourceIds.length ? ` [${c.sourceIds.join(', ')}]` : ''}</li>`).join('')}</ul>`
    : '';
  const sources = r.sources.length
    ? `<h3>Sources</h3><ol>${r.sources.map((s) => `<li id="src-${s.id}">${s.verified ? `<a href="${e(s.url)}">${e(s.title)}</a>` : `${e(s.title)} <em>(cited by model, link unverified)</em>`} — ${e(s.domain)}${s.date ? ` · ${e(s.date)}` : ''}</li>`).join('')}</ol>`
    : '';
  const original = r.originalSource
    ? `<h3>Likely original source</h3><p><strong>${e(r.originalSource.title)}</strong>${r.originalSource.publisher ? ` — ${e(r.originalSource.publisher)}` : ''}${r.originalSource.date ? ` (${e(r.originalSource.date)})` : ''}${r.originalSource.url ? ` · <a href="${e(r.originalSource.url)}">${e(r.originalSource.url)}</a>` : ''}${r.originalSource.how ? `<br><small>${e(r.originalSource.how)}</small>` : ''}</p>`
    : '';
  const narrative = r.narrative
    .split(/\n{2,}/)
    .map((p) => `<p>${e(p.trim())}</p>`)
    .join('');
  const pageHtml = snapshot ? buildSnapshotSrcdoc(snapshot, { loadImages: false }) : '';
  const pageSection = snapshot
    ? `<h2>Saved page</h2><p><small>${e(snapshot.title)} · <a href="${e(snapshot.url)}">${e(snapshot.url)}</a> · captured ${e(new Date(snapshot.capturedAt).toLocaleString())}</small></p><iframe sandbox="" style="width:100%;height:80vh;border:1px solid #E3E6EA;border-radius:8px" srcdoc="${pageHtml.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src data: about:; img-src data:"><title>${e(check.verdictLabel)} — ${e(check.title)}</title><style>
body{max-width:820px;margin:32px auto;padding:0 20px;font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#15181C}
.verdict{display:inline-block;padding:4px 12px;border-radius:999px;background:#FEF3C7;color:#7A4E00;font-weight:700}
blockquote{border-left:3px solid #BFD7F5;margin:0;padding:6px 14px;background:#F7F8FA;border-radius:6px}
small{color:#4B5563}h3{margin-top:24px}
</style></head><body>
<p><small>WhatsYourSource · ${e(new Date(check.createdAt).toLocaleString())} · ${e(check.provider)} (${e(check.model)})</small></p>
<h1><span class="verdict">${e(r.verdict.label)}</span> <small>${e(r.verdict.confidence)} confidence</small></h1>
<p><strong>${e(r.verdict.summary)}</strong></p>
${subject}
${narrative}
${original}
${claims}
${sources}
${check.note ? `<h3>Your note</h3><p>${e(check.note)}</p>` : ''}
${pageSection}
</body></html>`;
}

export function downloadText(text: string, filename: string, type = 'text/html'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFilename(s: string): string {
  return s.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'check';
}
