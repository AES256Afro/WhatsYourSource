import { normalizeAsk } from '@/lib/pipeline/question';
import { defaultAsk } from '@/lib/storage/settings';
import { useCallback, useEffect, useRef, useState } from 'react';
import { enforceSnapshotCap, saveCheck, updateCheckResult } from '@/lib/history/db';
import { captureFromTab } from '@/lib/history/snapshot';
import { prepareImageForCheck, type PreparedImage } from '@/lib/image/prepare';
import { attachLookups, LOOKUP_BUDGET_MS, originalSourceCapture, sourceRatings, startLookups, type PreRunLookups } from '@/lib/lookups';
import type { CheckInput } from '@/lib/messaging/protocol';
import { claimsForPrompt, extractClaims } from '@/lib/pipeline/claims';
import { emptyRunState, reduceProgress, type RunState } from '@/lib/pipeline/progress';
import type { RunError } from '@/lib/pipeline/runCheck';
import { runProviders } from '@/lib/pipeline/runProviders';
import type { CheckResult } from '@/lib/pipeline/schema';
import { decideTarget } from '@/lib/pipeline/target';
import { cheapestModel, createProvider, providerRunLabel } from '@/lib/providers/registry';
import type { ProviderId, Settings } from '@/lib/storage/settings';
import { getTargetTab } from '@/lib/tabs';
import { browser } from 'wxt/browser';

/** The earlier result a new one follows (a second opinion, or another question about the same content), so the new one can point back at it. */
export interface PreviousResult {
  id: string;
  label: string;
  verdict: string;
}

export type SaveStatus =
  | { status: 'pending' }
  | { status: 'saved'; withSnapshot: boolean }
  | { status: 'failed'; message: string }
  /** Checked from a private (incognito) window: nothing is written to history. */
  | { status: 'private' };

/** How a run was started, beyond its input: kept on an error so "Try again" repeats the same run. */
export interface RunOptions {
  tabId?: number;
  only?: ProviderId;
  previous?: PreviousResult;
  /** The checked tab is in a private window. Unset: looked up from the tab the panel serves. */
  incognito?: boolean;
}

/** The one state machine behind the panel's main views. */
export type PhasePayload =
  | { phase: 'idle' }
  | { phase: 'setup'; input: CheckInput }
  | { phase: 'checking'; run: RunState }
  | { phase: 'result'; result: CheckResult; save: SaveStatus; previous?: PreviousResult }
  | ({ phase: 'error'; input: CheckInput; error: RunError } & Pick<RunOptions, 'only' | 'previous' | 'incognito'>);
/** `seq` changes on every transition so the view can follow transitions, not re-renders. */
export type Phase = PhasePayload & { seq: number };

export interface CheckRunDeps {
  settings: () => Settings | null;
  /** Called when the phase changes kind (and when a run starts), so the panel can show the matching view. */
  onPhase: (p: PhasePayload) => void;
  openGoogleAiMode: (input: CheckInput) => void;
  /** A check with a working provider means the user is set up, whatever the onboarding flag says. */
  onOnboarded: () => void;
  onSaved: () => void;
}

/** Whether the tab a check applies to is in a private window (the job's tab, else the one the panel serves). */
async function tabIsIncognito(tabId: number | undefined): Promise<boolean> {
  try {
    const t = tabId != null ? await browser.tabs.get(tabId) : await getTargetTab();
    return !!t?.incognito;
  } catch {
    return false;
  }
}

/**
 * Runs a check end to end: target decision, two-pass claim listing, lookups, image prep, the
 * provider loop with fallback, lookups folded into the result, history save. Every state write is
 * guarded by a run token so a superseded run can never overwrite the current one.
 */
/** How long the claim-listing pass may take before the check goes ahead without it. */
const CLAIMS_BUDGET_MS = 10_000;

export function useCheckRun(deps: CheckRunDeps) {
  const [phase, setPhaseState] = useState<Phase>({ phase: 'idle', seq: 0 });
  const seq = useRef(0);
  const runSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const currentInput = useRef<{ input: CheckInput; opts: RunOptions } | null>(null);
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  const start = useCallback(async (raw: CheckInput, opts: RunOptions = {}) => {
    const { tabId, only, previous } = opts;
    const s = depsRef.current.settings();
    if (!s) return;
    // The question travels with the input from here on (prompt, Google AI Mode, history, re-checks):
    // the one picked for this check, else the default from Settings.
    const input: CheckInput = { ...raw, ask: normalizeAsk(raw.ask ?? defaultAsk(s)) };
    const myRun = ++runSeq.current;
    const stale = () => runSeq.current !== myRun;
    // The phase kind last shown by this run: the view follows changes of kind (checking → result),
    // not every progress update, so History and Settings stay usable while a check runs.
    let shownKind: PhasePayload['phase'] | null = null;
    const setPhase = (p: PhasePayload, opts: { quiet?: boolean } = {}) => {
      if (stale()) return;
      setPhaseState({ ...p, seq: ++seq.current });
      // Later updates to a result (saved, evidence attached) must not pull the user back to it
      // from History or Settings; only transitions navigate.
      if (!opts.quiet && p.phase !== shownKind) depsRef.current.onPhase(p);
      shownKind = p.phase;
    };
    abortRef.current?.abort();
    currentInput.current = { input, opts };
    // A private window's check is never written to history: no row, no page copy, no screenshot.
    const incognitoPromise = opts.incognito != null ? Promise.resolve(opts.incognito) : tabIsIncognito(tabId);
    // What "Try again" needs to repeat this run (the second-opinion provider, the earlier answer).
    const retry: Pick<RunOptions, 'only' | 'previous' | 'incognito'> = { only, previous, incognito: opts.incognito };
    void incognitoPromise.then((v) => {
      retry.incognito = v;
      if (currentInput.current?.input === input) currentInput.current.opts = { ...currentInput.current.opts, incognito: v };
    });

    const target = decideTarget(s, only);
    if (target.kind === 'webmode') {
      depsRef.current.openGoogleAiMode(input);
      setPhase({ phase: 'idle' });
      return;
    }
    if (target.kind === 'setup') {
      setPhase({ phase: 'setup', input });
      return;
    }
    if (!s.onboarded) depsRef.current.onOnboarded();

    const controller = new AbortController();
    abortRef.current = controller;
    // The lookups outlive the run's own controller once the result is on screen: a next check aborts
    // this run, but the evidence for the result already shown (and saved) must still arrive.
    const lookupsController = new AbortController();
    const abortLookups = () => lookupsController.abort();
    controller.signal.addEventListener('abort', abortLookups, { once: true });
    const { order } = target;
    const first = createProvider(order[0]!, s)!;
    const firstLabel = providerRunLabel(order[0]!, s);

    // The page as it is now, beside everything else; only the page the input came from.
    const pageOfInput = input.kind === 'page' ? input.url : input.pageUrl;
    const snapshotPromise = s.privacy.snapshots
      ? incognitoPromise.then((incognito) => (incognito ? null : captureFromTab(tabId, input.kind === 'text' ? input.text : undefined, pageOfInput)))
      : Promise.resolve(null);

    // Two-pass: list the claims first so each gets its own lookup and the main pass knows what to verify.
    const twoPass = s.twoPass && input.kind !== 'image';
    // The listing pass needs no tools or search, so the cheapest model of the same provider does it.
    const lister = twoPass ? (createProvider(order[0]!, s, { model: cheapestModel(order[0]!) }) ?? first) : first;
    // Its own controller, so a lister that runs out of time is stopped rather than left generating
    // (on a local server the main pass would queue behind it).
    const listing = new AbortController();
    controller.signal.addEventListener('abort', () => listing.abort(), { once: true });
    const claimsPromise = twoPass ? extractClaims(input, lister, listing.signal) : Promise.resolve([] as string[]);
    const lookups = startLookups(input, s, lookupsController.signal, twoPass ? claimsPromise : undefined);
    let preReady: PreRunLookups | null = null;
    void lookups.all.then((v) => (preReady = v)).catch(() => undefined);
    let run = emptyRunState(input, firstLabel, twoPass ? ['Listing the claims to check…'] : []);
    // Before the first await, always: a single-pass or image check otherwise sat on Home for the
    // length of the fact-check lookup, looking as if the click had done nothing.
    setPhase({ phase: 'checking', run });
    // Listing is a convenience: a slow or hung lister (a local model doing a whole extra generation)
    // must not hold up the check itself. No claims is already a normal outcome.
    let listingTimedOut = false;
    const claims = await Promise.race([
      claimsPromise,
      new Promise<string[]>((r) =>
        setTimeout(() => {
          listingTimedOut = true;
          r([]);
        }, CLAIMS_BUDGET_MS),
      ),
    ]);
    if (listingTimedOut) listing.abort();
    if (stale()) return;
    if (twoPass) {
      run = {
        ...run,
        claims,
        statuses: [
          ...run.statuses,
          claims.length
            ? `Checking ${claims.length} claim${claims.length === 1 ? '' : 's'}`
            : listingTimedOut
              ? 'Listing took too long; checking it as a whole'
              : 'No separate claims found',
        ],
      };
      setPhase({ phase: 'checking', run });
    }
    const lookupsText = await Promise.race([
      lookups.forPrompt,
      new Promise<string>((r) => setTimeout(() => r(''), twoPass ? LOOKUP_BUDGET_MS.forPromptTwoPass : LOOKUP_BUDGET_MS.forPrompt)),
    ]);
    if (stale()) return;

    let image: PreparedImage | undefined;
    if (input.kind === 'image') {
      run = { ...run, statuses: [...run.statuses, 'Preparing the image…'] };
      setPhase({ phase: 'checking', run });
      const prepared = await prepareImageForCheck(
        input,
        tabId,
        (m) => setPhase({ phase: 'checking', run: (run = { ...run, statuses: [...run.statuses, m] }) }),
        controller.signal,
      );
      if (stale()) return;
      if (!prepared.ok) {
        setPhase({ phase: 'error', input, error: prepared.error, ...retry });
        return;
      }
      image = prepared.image;
    }

    // Streams arrive one delta per microtask (hundreds per answer on Claude); the view is refreshed at
    // most every 40 ms, and at once for anything that is not a text delta.
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      flushTimer = undefined;
      setPhase({ phase: 'checking', run });
    };
    const flushSoon = () => {
      flushTimer ??= setTimeout(flush, 40);
    };
    const flushNow = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flush();
    };
    let finished: CheckResult | null = null;
    try {
      for await (const ev of runProviders(input, s, order, controller.signal, {
        image,
        lookups: lookupsText || undefined,
        claims: claims.length ? claimsForPrompt(claims) : undefined,
      })) {
        if (stale()) return;
        if (ev.type === 'provider') {
          // Keep what was said so far (claims, image prep, why the previous provider was abandoned)
          // and the clock under the new label.
          run = { ...emptyRunState(input, ev.label, run.statuses, run.claims), startedAt: run.startedAt };
          flushNow();
        } else if (ev.type === 'fallback') {
          run = { ...run, statuses: [...run.statuses, `${ev.error.message} Trying the next provider…`] };
          flushNow();
        } else if (ev.type === 'result') {
          finished = ev.result;
        } else if (ev.type === 'failed') {
          if (flushTimer) clearTimeout(flushTimer);
          setPhase({ phase: 'error', input, error: ev.error, ...retry });
          return;
        } else {
          run = reduceProgress(run, ev);
          if (ev.type === 'delta') flushSoon();
          else flushNow();
        }
      }
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
    }
    if (!finished) return;
    // The result is on screen from here on; a later run no longer stops its lookups.
    controller.signal.removeEventListener('abort', abortLookups);

    // Whatever lookups have resolved go into the first render, so the banner is there when focus lands.
    if (preReady) finished = attachLookups(finished, preReady, { credibility: {}, mixNotes: [] });
    setPhase({ phase: 'result', result: finished, save: { status: 'pending' }, previous });

    // Save first, enrich later: a result the user has seen is in history even if they start the
    // next check (a second opinion, say) while the slow lookups are still running.
    let snap: Awaited<typeof snapshotPromise> = null;
    let save: SaveStatus;
    try {
      if (await incognitoPromise) {
        save = { status: 'private' };
        setPhase({ phase: 'result', result: finished, save, previous }, { quiet: true });
      } else {
        // A tab that never finishes loading never answers; the result is saved without a page copy then.
        snap = await Promise.race([snapshotPromise, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
        await saveCheck(finished, snap);
        depsRef.current.onSaved();
        enforceSnapshotCap(s.history.maxMb * 1024 * 1024).catch((e: unknown) => console.warn('[wys] could not trim saved pages', e));
        save = { status: 'saved', withSnapshot: !!snap };
        setPhase({ phase: 'result', result: finished, save, previous }, { quiet: true });
      }
    } catch (e) {
      console.warn('[wys] could not save to history', e);
      setPhase(
        { phase: 'result', result: finished, save: { status: 'failed', message: e instanceof Error ? e.message : String(e) }, previous },
        { quiet: true },
      );
      return;
    }
    try {
      // Outlet ratings come from a list inside the extension, so they go on screen now instead of
      // waiting for the Wayback Machine (1–6 seconds) with everything else.
      const originalUrl = finished.originalSource?.url;
      const rated = await sourceRatings(
        finished.sources.map((x) => x.domain || x.url),
        originalUrl,
        s,
      );
      if (Object.keys(rated.credibility).length || rated.mixNotes.length) {
        finished = { ...finished, credibility: rated.credibility, mixNotes: rated.mixNotes.length ? rated.mixNotes : undefined };
        setPhase({ phase: 'result', result: finished, save, previous }, { quiet: true });
      }
      const [pre, originalCapture] = await Promise.all([lookups.all, originalSourceCapture(originalUrl, s, lookupsController.signal)]);
      finished = attachLookups(finished, pre, { ...rated, originalCapture });
      // The row exists; attach the evidence to it even if a newer run has taken the view. An update,
      // not a second save: a note typed meanwhile is kept and a deleted check stays deleted.
      if (save.status === 'saved') await updateCheckResult(finished);
      if (stale()) return;
      setPhase({ phase: 'result', result: finished, save, previous }, { quiet: true });
    } catch (e) {
      console.warn('[wys] lookups failed', e);
    }
  }, []);

  /** Cancel lands at once: the run is made stale so nothing it still awaits can write over the cancelled state. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    runSeq.current++;
    const cur = currentInput.current;
    if (cur) {
      const { only, previous, incognito } = cur.opts;
      const p: PhasePayload = { phase: 'error', input: cur.input, error: { code: 'cancelled', message: 'Cancelled.' }, only, previous, incognito };
      setPhaseState({ ...p, seq: ++seq.current });
      depsRef.current.onPhase(p);
    }
  }, []);
  const clearSetup = useCallback(() => setPhaseState((p) => (p.phase === 'setup' ? { phase: 'idle', seq: ++seq.current } : p)), []);
  return { phase, start, cancel, clearSetup, busy: phase.phase === 'checking' };
}
