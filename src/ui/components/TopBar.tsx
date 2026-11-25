import type { View } from '../views';
import { ArrowLeft, Clock, Logo, Sliders } from './Icons';

export function TopBar({
  view,
  onHome,
  onHistory,
  onSettings,
  title,
  onBack,
  checking,
}: {
  view: View;
  onHome: () => void;
  onHistory: () => void;
  onSettings: () => void;
  title?: string;
  onBack?: () => void;
  /** A check is running in another view: show a way back to it. */
  checking?: boolean;
}) {
  return (
    // Under 380 px (a narrow panel, or zoom) the wordmark and the pill's text go so History and Settings stay in the bar;
    // the Home button and the pill keep their accessible names.
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-paper pr-2 pl-3.5">
      {onBack ? (
        <button className="wys-icon-btn -ml-2" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
      ) : (
        <button className="flex h-9 shrink-0 items-center gap-2 rounded-lg border-0 bg-transparent px-1 text-ink" onClick={onHome} aria-label="Home">
          <Logo size={22} className="shrink-0 text-accent" />
          <span className="text-[14px] font-semibold tracking-tight max-[379px]:hidden">WhatsYourSource</span>
        </button>
      )}
      {onBack && <span className="min-w-0 truncate text-[14px] font-semibold">{title}</span>}
      <span className="grow" />
      {checking && view !== 'checking' && (
        <button
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-2.5 text-[11px] font-semibold text-accent"
          aria-label="Back to the check in progress"
          onClick={onHome}
        >
          <span className="wys-spin h-3 w-3 border" /> <span className="max-[379px]:hidden">Checking…</span>
        </button>
      )}
      <button className="wys-icon-btn shrink-0" aria-label="History" aria-pressed={view === 'history' || view === 'detail'} onClick={onHistory}>
        <Clock size={18} />
      </button>
      <button className="wys-icon-btn shrink-0" aria-label="Settings" aria-pressed={view === 'settings'} onClick={onSettings}>
        <Sliders size={18} />
      </button>
    </div>
  );
}
