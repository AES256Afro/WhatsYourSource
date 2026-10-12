import { Logo } from '../components/Icons';
import { SettingsView } from '../components/SettingsView';
import { useSettings } from '../hooks/useSettings';

export function OptionsApp() {
  const { settings, update } = useSettings();
  return (
    <div className="min-h-full bg-surface">
      <div className="flex h-14 items-center gap-2.5 border-b border-line bg-paper px-6">
        <Logo size={24} className="text-accent" />
        <span className="text-[16px] font-semibold tracking-tight">WhatsYourSource settings</span>
        <span className="grow" />
        <a href="https://github.com/AES256Afro/WhatsYourSource" target="_blank" rel="noopener noreferrer" className="text-[12px] font-medium no-underline">
          Source code
        </a>
      </div>
      <div className="mx-auto my-6 max-w-[760px] rounded-xl border border-line bg-paper">
        {settings ? <SettingsView settings={settings} update={update} wide /> : <div className="p-4 text-ink-2">Loading…</div>}
      </div>
    </div>
  );
}
