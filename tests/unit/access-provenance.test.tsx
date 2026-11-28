import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareImageForCheck } from '@/lib/image/prepare';
import { ProvenancePanel } from '@/ui/components/ProvenancePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// P5B6-02: when the image's host is not granted, the screenshot is used and the result says so.

const shot = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/lib/image/bytes', async (orig) => {
  const a = await orig<typeof import('@/lib/image/bytes')>();
  return {
    ...a,
    screenshotImage: async () => {
      shot.calls++;
      return { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png', via: 'screenshot' as const };
    },
    prepareForModel: async () => ({ base64: 'AA', mime: 'image/png', width: 160, height: 107, bitmap: { close: () => undefined } as unknown as ImageBitmap }),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('screenshot for lack of access', () => {
  it('uses the screenshot without contacting the host and records the host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await prepareImageForCheck(
      { kind: 'image', srcUrl: 'https://cdn.example/photo.jpg', pageUrl: 'https://site.example/a', pageTitle: 't' },
      7,
      () => undefined,
      new AbortController().signal,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(shot.calls).toBe(1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.image.via).toBe('screenshot');
      expect(r.image.provenance.needsAccessHost).toBe('cdn.example');
    }
  });

  it('shows the line and the Allow button, which calls back from the click', async () => {
    const onAllowHost = vi.fn();
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        <ProvenancePanel
          provenance={{ width: 160, height: 107, needsAccessHost: 'cdn.example' }}
          srcUrl="https://cdn.example/photo.jpg"
          onAllowHost={onAllowHost}
        />,
      );
    });
    expect(el.textContent).toContain('Read from a screenshot: the extension has no access to cdn.example');
    const btn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Allow cdn.example and check again')!;
    expect(btn).toBeTruthy();
    await act(async () => btn.click());
    expect(onAllowHost).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.render(<ProvenancePanel provenance={{ width: 160, height: 107 }} srcUrl="https://cdn.example/photo.jpg" onAllowHost={onAllowHost} />);
    });
    expect(el.textContent).not.toContain('no access');
    root.unmount();
  });
});
