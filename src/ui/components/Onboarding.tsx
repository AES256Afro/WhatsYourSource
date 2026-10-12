import { useState } from 'react';
import type { ProviderId, Settings } from '@/lib/storage/settings';
import { Cpu, Globe, Link, Logo, Sparkle } from './Icons';
import { CommitInput, SecretInput, Toggle } from './settings/primitives';

type Update = (mutate: (s: Settings) => Settings) => Promise<Settings>;

const CHOICES: Array<{ id: ProviderId; title: string; tag: string; tagTone: 'accent' | 'muted' | 'ok'; blurb: string; icon: React.ReactNode }> = [
  {
    id: 'gemini',
    title: 'Google AI with your own free key',
    tag: 'Recommended',
    tagTone: 'accent',
    blurb: 'Gemini + Google Search. Answers and sources appear in the panel. Free key from AI Studio.',
    icon: <Sparkle size={15} />,
  },
  {
    id: 'webmode',
    title: 'Google AI Mode on the web',
    tag: 'No setup',
    tagTone: 'muted',
    blurb: 'No key. Opens google.com in a new tab with your text. Results aren’t saved to history.',
    icon: <Globe size={15} />,
  },
  {
    id: 'anthropic',
    title: 'Your own frontier model',
    tag: 'Bring a key',
    tagTone: 'muted',
    blurb: 'Claude, GPT or any API you already pay for. Paste a key; it stays on this device.',
    icon: <Link size={15} />,
  },
  {
    id: 'openai-compat',
    title: 'A local model on this device',
    tag: 'Private',
    tagTone: 'ok',
    blurb: 'Download a model with Ollama or LM Studio (e.g. Qwen). Nothing leaves your machine; add a search tool so it can find sources.',
    icon: <Cpu size={15} />,
  },
];

export function Onboarding({ settings, update, onDone, onOpenSettings }: { settings: Settings; update: Update; onDone: () => void; onOpenSettings: () => void }) {
  const [choice, setChoice] = useState<ProviderId>('gemini');
  const [chip, setChip] = useState(settings.privacy.chip);
  const [snapshots, setSnapshots] = useState(settings.privacy.snapshots);

  const finish = async () => {
    await update((s) => ({ ...s, onboarded: true, defaultProvider: choice, privacy: { ...s.privacy, chip, snapshots } }));
    if (choice === 'anthropic' || choice === 'openai-compat') onOpenSettings();
    else onDone();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex grow flex-col gap-4 overflow-y-auto px-5 pt-6 pb-3">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[15px] bg-accent-soft">
            <Logo size={30} className="text-accent" />
          </span>
          <h1 className="m-0 text-[20px] font-bold tracking-tight">Check the source of anything you read</h1>
          <p className="m-0 text-[13px] leading-[18px] text-ink-2">You decide which AI does the checking. Change it any time.</p>
        </div>

        <div className="flex flex-col gap-2">
          <Step n={1}>How do you want to check sources?</Step>
          {CHOICES.map((c) => (
            <label key={c.id} htmlFor={`wys-ob-${c.id}`} className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5 ${choice === c.id ? 'border-accent bg-accent-wash' : 'border-line bg-paper'}`}>
              <input id={`wys-ob-${c.id}`} type="radio" name="wys-provider" className="mt-[3px] accent-accent" checked={choice === c.id} onChange={() => setChoice(c.id)} />
              <span className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg ${choice === c.id ? 'bg-accent-fill text-white' : 'bg-surface-2 text-ink-2'}`}>{c.icon}</span>
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="text-[13px] font-semibold">{c.title}</span>
                  <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${c.tagTone === 'accent' ? 'bg-accent-fill text-white' : c.tagTone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-muted-soft text-ink-2'}`}>{c.tag}</span>
                </span>
                <span className="text-[12px] leading-4 text-ink-2">{c.blurb}</span>
              </span>
            </label>
          ))}
        </div>

        {choice === 'gemini' && (
          <div className="flex flex-col gap-2">
            <Step n={2}>
              <label htmlFor="wys-ob-gkey">Your Gemini API key</label>
            </Step>
            <SecretInput id="wys-ob-gkey" value={settings.providers.gemini.apiKey} onCommit={(v) => void update((s) => ({ ...s, providers: { ...s.providers, gemini: { ...s.providers.gemini, apiKey: v } } }))} placeholder="Paste key…" />
            <span className="text-[12px] leading-4 text-ink-2">
              Free at{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="font-semibold no-underline">
                aistudio.google.com
              </a>
              . Google’s free tier may use your prompts to improve its products; a paid key does not.
            </span>
          </div>
        )}
        {choice === 'anthropic' && (
          <div className="flex flex-col gap-2">
            <Step n={2}>
              <label htmlFor="wys-ob-akey">Your Anthropic API key</label>
            </Step>
            <SecretInput id="wys-ob-akey" value={settings.providers.anthropic.apiKey} onCommit={(v) => void update((s) => ({ ...s, providers: { ...s.providers, anthropic: { ...s.providers.anthropic, apiKey: v } } }))} placeholder="sk-ant-…" />
            <span className="text-[12px] leading-4 text-ink-2">Using OpenAI or another API instead? Pick it under Settings → OpenAI-compatible after this step.</span>
          </div>
        )}
        {choice === 'openai-compat' && (
          <div className="flex flex-col gap-2">
            <Step n={2}>
              <label htmlFor="wys-ob-url">Where is the model running?</label>
            </Step>
            <CommitInput id="wys-ob-url" value={settings.providers.openaiCompat.baseUrl} onCommit={(v) => void update((s) => ({ ...s, providers: { ...s.providers, openaiCompat: { ...s.providers.openaiCompat, baseUrl: v } } }))} placeholder="http://localhost:11434/v1" />
            <span className="text-[12px] leading-4 text-ink-2">
              Don’t have one yet? Install{' '}
              <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" className="font-semibold no-underline">
                Ollama
              </a>{' '}
              and run <code className="rounded bg-surface-2 px-1">ollama pull qwen3:8b</code>. You’ll pick the model and a search tool on the next screen.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Step n={3}>Privacy</Step>
          <div className="wys-card flex flex-col px-3">
            <PrivacyRow label="Send text or images only when I press Check" hint="Always">
              <Toggle checked disabled onChange={() => {}} />
            </PrivacyRow>
            <PrivacyRow label="Save a copy of the page with each check (local only)">
              <Toggle checked={snapshots} onChange={setSnapshots} />
            </PrivacyRow>
            <PrivacyRow label="Show the floating “Check source” chip on selection">
              <Toggle checked={chip} onChange={setChip} />
            </PrivacyRow>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-paper px-5 pt-2.5 pb-4">
        <button className="wys-btn wys-btn-primary h-11 text-[14px]" onClick={finish}>
          {choice === 'anthropic' || choice === 'openai-compat' ? 'Continue to settings' : 'Finish setup'}
        </button>
        <span className="text-center text-[12px] text-ink-2">You can mix these later — e.g. Gemini by default, a local model as fallback — in Settings.</span>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-accent-fill text-[12px] font-bold text-white">{n}</span>
      <span className="text-[13px] font-semibold">{children}</span>
    </div>
  );
}

function PrivacyRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[40px] items-center gap-2.5 border-b border-surface-2 py-1.5 text-[13px] last:border-b-0">
      <span className="grow leading-[17px]">{label}</span>
      {hint && <span className="text-[11px] text-ink-2">{hint}</span>}
      {children}
    </div>
  );
}
