import type { CheckInput } from '@/lib/messaging/protocol';
import { googleAiModeUrl } from '@/lib/webmode';
import { Alert, External, Refresh, Sliders } from './Icons';
import { InputCard } from './InputCard';

export interface RunError {
  code: string;
  message: string;
  details?: string;
}

const HINT: Record<string, string> = {
  'no-key': 'Add an API key in settings, or open the check in Google AI Mode instead — that needs no key.',
  auth: 'The provider rejected the key. Check it in settings; keys from Google AI Studio start with “AIza”.',
  quota: 'You hit a rate limit or quota. Wait a minute, pick the cheaper model, or try another provider.',
  network: 'Couldn’t reach the provider. Check your connection, or for a local model, that the server is running.',
  blocked: 'The provider declined this content. Try a shorter selection or a different provider.',
  'bad-request': 'The provider didn’t accept the request — often an unknown model name. Check the model in settings.',
  server: 'The provider had a server error. Try again in a moment.',
  cancelled: 'Cancelled.',
  'image-permission':
    'The site doesn’t allow extensions to read its images directly. Allow access to that host once and try again, or make sure the image is visible on screen so a screenshot can be used.',
  image: 'The image couldn’t be loaded. Try opening it in its own tab and checking it from there.',
};

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
  onSettings: () => void;
  onAllowHost?: () => void;
}) {
  const host = input.kind === 'image' ? hostOf(input.srcUrl) : '';
  return (
    <div className="flex flex-col gap-3.5 p-3.5">
      <InputCard input={input} clamp />
      <div className="flex gap-2.5 rounded-xl border border-bad-line bg-bad-soft p-3">
        <Alert size={20} className="mt-px shrink-0 text-bad" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[15px] font-bold text-bad">{error.code === 'cancelled' ? 'Cancelled' : 'Couldn’t complete the check'}</span>
          <span className="text-[13px] leading-[18px] text-bad-ink">{error.message}</span>
          {error.details && <span className="text-[11px] leading-[15px] text-bad-ink/80 wrap-break-word">{error.details}</span>}
        </div>
      </div>
      <p className="m-0 text-[13px] leading-[19px] text-ink-2">{HINT[error.code] ?? 'Something unexpected happened. Try again, or use Google AI Mode.'}</p>
      {onAllowHost && host && (
        <button className="wys-btn wys-btn-primary" onClick={onAllowHost}>
          Allow access to {host} and retry
        </button>
      )}
      <div className="flex gap-2">
        <button className="wys-btn grow" onClick={onRetry}>
          <Refresh size={15} /> Try again
        </button>
        <button className="wys-btn grow" onClick={onSettings}>
          <Sliders size={15} /> Settings
        </button>
      </div>
      <a href={googleAiModeUrl(input)} target="_blank" rel="noopener noreferrer" className={`wys-btn no-underline ${onAllowHost ? '' : 'wys-btn-primary'}`}>
        Open in Google AI Mode instead <External size={14} />
      </a>
    </div>
  );
}

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
}
