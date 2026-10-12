import type React from 'react';

/** The model's prose, split into paragraphs. Rendered as text only — never as HTML. */
export function Narrative({ text, streaming }: { text: string; streaming?: boolean }) {
  const paras = text
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean);
  if (paras.length === 0) return streaming ? <p className="wys-caret m-0" /> : null;
  return (
    <div className="wys-prose text-[13px] leading-[19px]">
      {paras.map((p, i) => (
        <p key={i} className={streaming && i === paras.length - 1 ? 'wys-caret' : undefined}>
          {renderInline(p)}
        </p>
      ))}
    </div>
  );
}

/** Minimal inline markdown: **bold** and `code`. Everything else is literal text. */
function renderInline(s: string) {
  const out: Array<string | React.ReactElement> = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={k++}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={k++}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
