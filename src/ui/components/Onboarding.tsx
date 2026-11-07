import { useState } from 'react';
import { PROVIDER_LABELS } from '@/lib/providers/registry';
import { GeminiProvider } from '@/lib/providers/gemini';
import { providerReady, type ProviderId, type Settings } from '@/lib/storage/settings';
import { Cpu, Globe, Link, Sparkle } from './Icons';
import { CommitInput, Row, SecretInput, StatusLine, Toggle } from './settings/primitives';
import { useProviderVerify } from './settings/useProviderVerify';
import type { UpdateSettings } from '../hooks/useSettings';

/** Same names as the Settings cards, so what you pick here is what you find there. */
const CHOICES: { id: ProviderId; title: string; tag: string; tagTone: 'accent' | 'muted' | 'ok'; blurb: string; icon: React.ReactNode }[] = [
  {
    id: 'gemini',
    title: PROVIDER_LABELS.gemini,
    tag: 'Recommended',
    tagTone: 'accent',
    blurb: 'Free key from Google AI Studio. Searches Google, answers in the panel.',
    icon: <Sparkle size={15} />,
  },
  {
    id: 'webmode',
    title: PROVIDER_LABELS.webmode,
    tag: 'No setup',
    tagTone: 'muted',
    blurb: 'No key. Opens google.com in a new tab. Not saved to history.',
    icon: <Globe size={15} />,
  },
  {
    id: 'anthropic',
    title: PROVIDER_LABELS.anthropic,
    tag: 'Bring a key',
    tagTone: 'muted',
    blurb: 'Web search built in. GPT or another API: pick it in Settings afterwards.',
    icon: <Link size={15} />,
  },
  {
    id: 'openai-compat',
    title: PROVIDER_LABELS['openai-compat'],
    tag: 'Private',
    tagTone: 'ok',
    blurb: 'Ollama or LM Studio on this device; add a search tool so it can find sources.',
    icon: <Cpu size={15} />,
  },
];

export function Onboarding({
  settings,
  update,
  onDone,
  onOpenSettings,
}: {
  settings: Settings;
  update: UpdateSettings;
  onDone: () => void;
  onOpenSettings: (provider?: ProviderId) => void;
}) {
  const [choice, setChoiceState] = useState<ProviderId>('gemini');
  const [touched, setTouched] = useState(false);
  const setChoice = (id: ProviderId) => {
    setTouched(true);
    setChoiceState(id);
  };
  const [chip, setChip] = useState(settings.privacy.chip);
  const [snapshots, setSnapshots] = useState(settings.privacy.snapshots);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const geminiKey = settings.providers.gemini.apiKey.trim();
  const anthropicKey = settings.providers.anthropic.apiKey.trim();
  const { status: verify, verify: verifyGemini } = useProviderVerify(
    () => new GeminiProvider(settings.providers.gemini),
    geminiKey,
    () => 'Key works.',
  );

  const keyMissing = (choice === 'gemini' && !geminiKey) || (choice === 'anthropic' && !anthropicKey);

  const finish = async () => {
    // A provider configured in Settings before pressing Finish wins over the untouched radio default.
    const keepCurrent = !touched && providerReady(settings) && settings.defaultProvider !== choice;
    // Finishing without a key means checks go to Google AI Mode until a key is added; say so on the button.
    const provider: ProviderId = keepCurrent ? settings.defaultProvider : keyMissing ? 'webmode' : choice;
    await update((s) => ({ ...s, onboarded: true, defaultProvider: provider, privacy: { ...s.privacy, chip, snapshots } }));
    if (choice === 'openai-compat' || (choice === 'anthropic' && !keyMissing)) onOpenSettings(choice);
    else onDone();
  };

  // Says where the button goes: Settings for the providers that need more than a key, else home.
  const buttonText =
    choice === 'openai-compat' || (choice === 'anthropic' && !keyMissing)
      ? 'Continue to settings'
      : keyMissing
        ? 'Finish without a key (use Google AI Mode)'
        : 'Finish setup';

  return (
    <div className="flex h-full flex-col">
      <div className="flex grow flex-col gap-3.5 overflow-y-auto px-4 pt-4 pb-3">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[18px] leading-[22px] font-bold tracking-tight">Check the source of anything you read</h1>
          <p className="m-0 text-[13px] leading-[18px] text-ink-2">You decide which AI does the checking. Change it any time.</p>
        </div>

        <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 flex items-center gap-2 p-0">
            <StepNo n={1} />
            <span className="text-[13px] font-semibold">How do you want to check sources?</span>
          </legend>
          {CHOICES.map((c) => (
            <label
              key={c.id}
              htmlFor={`wys-ob-${c.id}`}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 ${choice === c.id ? 'border-accent bg-accent-wash' : 'border-line bg-paper'}`}
            >
              <input
                id={`wys-ob-${c.id}`}
                type="radio"
                name="wys-provider"
                className="accent-accent"
                checked={choice === c.id}
                onChange={() => setChoice(c.id)}
              />
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${choice === c.id ? 'bg-accent-fill text-white' : 'bg-surface-2 text-ink-2'}`}
              >
                {c.icon}
              </span>
              <span className="flex min-w-0 grow flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-semibold">{c.title}</span>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold ${c.tagTone === 'accent' ? 'bg-accent-fill text-white' : c.tagTone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-muted-soft text-ink-2'}`}
                  >
                    {c.tag}
                  </span>
                </span>
                <span className="line-clamp-2 text-[12px] leading-4 text-ink-2">{c.blurb}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {choice === 'gemini' && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <StepNo n={2} />
              <label htmlFor="wys-ob-gkey" className="text-[13px] font-semibold">
                Your Gemini API key
              </label>
            </div>
            <div className="flex gap-2">
              <div className="min-w-0 grow">
                <SecretInput
                  id="wys-ob-gkey"
                  value={settings.providers.gemini.apiKey}
                  onCommit={(v) => void update((s) => ({ ...s, providers: { ...s.providers, gemini: { ...s.providers.gemini, apiKey: v } } }))}
                  placeholder="Paste key…"
                />
              </div>
              <button
                className="wys-btn px-2.5"
                type="button"
                aria-disabled={!geminiKey || verify.kind === 'checking'}
                onClick={() => geminiKey && verify.kind !== 'checking' && void verifyGemini()}
              >
                Verify
              </button>
            </div>
            <StatusLine status={verify} />
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
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <StepNo n={2} />
              <label htmlFor="wys-ob-akey" className="text-[13px] font-semibold">
                Your Anthropic API key
              </label>
            </div>
            <SecretInput
              id="wys-ob-akey"
              value={settings.providers.anthropic.apiKey}
              onCommit={(v) => void update((s) => ({ ...s, providers: { ...s.providers, anthropic: { ...s.providers.anthropic, apiKey: v } } }))}
              placeholder="sk-ant-…"
            />
            <span className="text-[12px] leading-4 text-ink-2">
              Using OpenAI or another API instead? Finish, then pick it under Settings → Local or OpenAI-style model → Server.
            </span>
          </div>
        )}
        {choice === 'openai-compat' && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <StepNo n={2} />
              <label htmlFor="wys-ob-url" className="text-[13px] font-semibold">
                Where is the model running?
              </label>
            </div>
            <CommitInput
              id="wys-ob-url"
              value={settings.providers.openaiCompat.baseUrl}
              onCommit={(v) => void update((s) => ({ ...s, providers: { ...s.providers, openaiCompat: { ...s.providers.openaiCompat, baseUrl: v } } }))}
              placeholder="http://localhost:11434/v1"
            />
            <span className="text-[12px] leading-4 text-ink-2">
              Don’t have one yet? Install{' '}
              <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" className="font-semibold no-underline">
                Ollama
              </a>{' '}
              and run <code className="rounded bg-surface-2 px-1">ollama pull qwen3.5:9b</code>. You’ll pick the model and a search tool on the next screen.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <StepNo n={3} />
            <span className="text-[13px] font-semibold">Privacy</span>
            <span className="grow" />
            <button
              type="button"
              className="border-0 bg-transparent p-0 text-[12px] font-medium text-accent"
              onClick={() => setPrivacyOpen((v) => !v)}
              aria-expanded={privacyOpen}
            >
              {privacyOpen ? 'Hide' : 'Change'}
            </button>
          </div>
          {privacyOpen ? (
            <div className="wys-card flex flex-col px-3">
              <Row label="Send text or images only when I press Check" hint="Always">
                {(id) => <Toggle checked disabled labelledBy={id} />}
              </Row>
              <Row label="Save a copy of the page with each check (local only)">
                {(id) => <Toggle checked={snapshots} onChange={setSnapshots} labelledBy={id} />}
              </Row>
              <Row label="Show the floating “Check source” chip on selection">{(id) => <Toggle checked={chip} onChange={setChip} labelledBy={id} />}</Row>
            </div>
          ) : (
            <p className="m-0 text-[12px] leading-4 text-ink-2">
              Nothing is sent until you press Check. Page copies for history: {snapshots ? 'on' : 'off'}. Floating chip: {chip ? 'on' : 'off'}.
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-paper px-4 pt-2.5 pb-3.5">
        <button className="wys-btn wys-btn-primary h-11 text-[14px]" onClick={() => void finish()}>
          {buttonText}
        </button>
        <span className="text-center text-[12px] text-ink-2">You can mix these later in Settings, e.g. Gemini by default and a local model as fallback.</span>
      </div>
    </div>
  );
}

function StepNo({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-accent-fill text-[12px] font-bold text-white"
    >
      {n}
    </span>
  );
}
