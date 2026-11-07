import { useEffect, useRef } from 'react';
import type { CheckInput } from '@/lib/messaging/protocol';
import type { CheckErrorCode, RunError } from '@/lib/pipeline/runCheck';
import type { ProviderId } from '@/lib/storage/settings';
import { hostOf } from '@/lib/util/url';
import { googleAiModeUrl } from '@/lib/googleAiMode';
import { Alert, External, Refresh, Sliders } from './Icons';
import { InputCard } from './InputCard';

/** What to do next, per error code. Never repeats the message itself. */
const HINT: Record<CheckErrorCode, string> = {
  'no-key': 'Add an API key in Settings, or open the check in Google AI Mode instead; that needs no key.',
  auth: 'Check the key in Settings.',
  quota: 'Wait a minute, pick the cheaper model, or try another provider.',
  network: 'Check your connection.',
  blocked: 'Try a shorter selection or a different provider.',
  'bad-request': 'Often an unknown model name: check the model in Settings.',
  server: 'Try again in a moment.',
  empty: 'For a local model, give it a bigger context window or a shorter selection; otherwise try again or another provider.',
  cancelled: '',
  'image-permission': 'Allow access to that host once and try again, or make sure the image is visible on screen so a screenshot can be used.',
  image: 'Try opening the image in its own tab and checking it from there.',
  'image-page-closed': 'Open the page the image was on, then right-click the image → Check source of this image.',
  unknown: '',
  unsupported: 'Pick a model that can see images (for Ollama or LM Studio a “vision” or “-VL” model), or use Gemini or Claude for image checks.',
};

function hintFor(error: RunError): string {
  const base = HINT[error.code] || 'Something unexpected happened. Try again, or use Google AI Mode.';
  const local = error.provider === 'openai-compat' && error.endpoint && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(error.endpoint);
  if (local && (error.code === 'network' || error.code === 'server')) {
    return 'Is Ollama or LM Studio running, with a model loaded? Open Settings and press Test on the local model card.';
  }
  if (error.code === 'auth' && error.provider === 'gemini') return `${base} Keys from Google AI Studio start with "AIza".`;
  if (error.code === 'auth' && error.provider === 'anthropic') return `${base} Anthropic keys start with "sk-ant-".`;
  return base;
}

export function ErrorView({
  input,
  error,
  onRetry,
  onSettings,
  onAllowHost,
}: {
  input: CheckInput;
  error: RunError;
  onRetry: () => void;
  /** Opens Settings, scrolled to the provider that failed when known. */
  onSettings: (provider?: ProviderId) => void;
  onAllowHost?: () => void;
}) {
  const host = input.kind === 'image' ? hostOf(input.srcUrl) : '';
  const hint = hintFor(error);
  const banner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    banner.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-3.5 p-3.5">
      <InputCard input={input} clamp />
      <div
        ref={banner}
        tabIndex={-1}
        role="alert"
        className="flex gap-2.5 rounded-xl border border-bad-line bg-bad-soft p-3 outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
      >
        <Alert size={20} className="mt-px shrink-0 text-bad" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 text-[16px] leading-[20px] font-semibold text-bad">{error.code === 'cancelled' ? 'Cancelled' : 'Couldn’t complete the check'}</h2>
          <span className="text-[13px] leading-[18px] text-bad-ink">{error.message}</span>
          {error.details && <span className="text-[11px] leading-[15px] text-bad-ink wrap-break-word">{error.details}</span>}
        </div>
      </div>
      {hint && <p className="wys-measure m-0 text-[13px] leading-[18px] text-ink-2">{hint}</p>}
      {onAllowHost && host && (
        <button className="wys-btn wys-btn-primary" onClick={onAllowHost}>
          Allow access to {host} and retry
        </button>
      )}
      <div className="flex gap-2">
        <button className="wys-btn grow" onClick={onRetry}>
          <Refresh size={15} /> Try again
        </button>
        <button className="wys-btn grow" onClick={() => onSettings(error.provider)}>
          <Sliders size={15} /> Open Settings
        </button>
      </div>
      <a href={googleAiModeUrl(input)} target="_blank" rel="noopener noreferrer" className="wys-btn no-underline">
        Open in Google AI Mode instead <External size={14} />
      </a>
    </div>
  );
}

export type { RunError } from '@/lib/pipeline/runCheck';
