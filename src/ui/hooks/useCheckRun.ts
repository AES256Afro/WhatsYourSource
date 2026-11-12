import { useCallback, useEffect, useRef, useState } from 'react';
import { enforceSnapshotCap, saveCheck } from '@/lib/history/db';
import { captureFromTab } from '@/lib/history/snapshot';
import { prepareImageForCheck, type PreparedImage } from '@/lib/image/prepare';
import { attachLookups, LOOKUP_BUDGET_MS, sourceLookups, startLookups, type PreRunLookups } from '@/lib/lookups';
import type { CheckInput } from '@/lib/messaging/protocol';
import { claimsForPrompt, extractClaims } from '@/lib/pipeline/claims';
import { emptyRunState, reduceProgress, type RunState } from '@/lib/pipeline/progress';
import type { RunError } from '@/lib/pipeline/runCheck';
import { runProviders } from '@/lib/pipeline/runProviders';
import type { CheckResult } from '@/lib/pipeline/schema';
import { decideTarget } from '@/lib/pipeline/target';
import { cheapestModel, createProvider, providerRunLabel } from '@/lib/providers/registry';
import type { ProviderId, Settings } from '@/lib/storage/settings';

/** The result a second opinion is answering, so the new one can point back at it. */
export interface PreviousResult {
  id: string;
  label: string;
  verdict: string;
}

export type SaveStatus = { status: 'pending' } | { status: 'saved'; withSnapshot: boolean } | { status: 'failed'; message: string };

/** The one state machine behind the panel's main views. */
export type PhasePayload =
  | { phase: 'idle' }
  | { phase: 'setup'; input: CheckInput }
  | { phase: 'checking'; run: RunState }
  | { phase: 'result'; result: CheckResult; save: SaveStatus; previous?: PreviousResult }
  | { phase: 'error'; input: CheckInput; error: RunError };
/** `seq` changes on every transition so the view can follow transitions, not re-renders. */
export type Phase = PhasePayload & { seq: number };

export interface CheckRunDeps {
  settings: () => Settings | null;
  /** Called on every transition, so the panel can show the matching view. */
  onPhase: (p: PhasePayload) => void;
  openGoogleAiMode: (input: CheckInput) => void;
  /** A check with a working provider means the user is set up, whatever the onboarding flag says. */
  onOnboarded: () => void;
  onSaved: () => void;
}

/**
 * Runs a check end to end: target decision, two-pass claim listing, lookups, image prep, the
 * provider loop with fallback, lookups folded into the result, history save. Every state write is
 * guarded by a run token so a superseded run can never overwrite the current one.
 */
export function useCheckRun(deps: CheckRunDeps) {
  const [phase, setPhaseState] = useState<Phase>({ phase: 'idle', seq: 0 });
  const seq = useRef(0);
  const runSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const currentInput = useRef<CheckInput | null>(null);
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  const start = useCallback(async (input: CheckInput, opts: { tabId?: number; only?: ProviderId; previous?: PreviousResult } = {}) => {
    const { tabId, only, previous } = opts;
    const s = depsRef.current.settings();
    if (!s) return;
    const myRun = ++runSeq.current;
    const stale = () => runSeq.current !== myRun;
    const setPhase = (p: PhasePayload, opts: { quiet?: boolean } = {}) => {
      if (stale()) return;
      setPhaseState({ ...p, seq: ++seq.current });
      // Later updates to a result (saved, evidence attached) must not pull the user back to it
      // from History or Settings; only transitions navigate.
      if (!opts.quiet) depsRef.current.onPhase(p);
    };
    abortRef.current?.abort();
    currentInput.current = input;

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
    const { order } = target;
    const first = createProvider(order[0]!, s)!;
    const firstLabel = providerRunLabel(order[0]!, s);

    // The page as it is now, beside everything else; only the page the input came from.
    const pageOfInput = input.kind === 'page' ? input.url : input.pageUrl;
    const snapshotPromise = s.privacy.snapshots ? captureFromTab(tabId, input.kind === 'text' ? input.text : undefined, pageOfInput) : Promise.resolve(null);

    // Two-pass: list the claims first so each gets its own lookup and the main pass knows what to verify.
    const twoPass = s.twoPass && input.kind !== 'image';
    // The listing pass needs no tools or search, so the cheapest model of the same provider does it.
    const lister = twoPass ? (createProvider(order[0]!, s, { model: cheapestModel(order[0]!) }) ?? first) : first;
    const claimsPromise = twoPass ? extractClaims(input, lister, controller.signal) : Promise.resolve([] as string[]);
    const lookups = startLookups(input, s, controller.signal, twoPass ? claimsPromise : undefined);
    let preReady: PreRunLookups | null = null;
    void lookups.all.then((v) => (preReady = v)).catch(() => undefined);
    let run = emptyRunState(input, firstLabel, twoPass ? ['Listing the claims to check…'] : []);
    if (twoPass) setPhase({ phase: 'checking', run });
    const claims = await claimsPromise;
    if (stale()) return;
    if (twoPass) {
      run = {
        ...run,
        claims,
        statuses: [...run.statuses, claims.length ? `Checking ${claims.length} claim${claims.length === 1 ? '' : 's'}` : 'No separate claims found'],
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
        setPhase({ phase: 'error', input, error: prepared.error });
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
          setPhase({ phase: 'error', input, error: ev.error });
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

    // Whatever lookups have resolved go into the first render, so the banner is there when focus lands.
    if (preReady) finished = attachLookups(finished, preReady, { credibility: {}, mixNotes: [] });
    setPhase({ phase: 'result', result: finished, save: { status: 'pending' }, previous });

    // Save first, enrich later: a result the user has seen is in history even if they start the
    // next check (a second opinion, say) while the slow lookups are still running.
    let snap: Awaited<typeof snapshotPromise> = null;
    try {
      snap = await snapshotPromise;
      await saveCheck(finished, snap);
      depsRef.current.onSaved();
      void enforceSnapshotCap(s.history.maxMb * 1024 * 1024);
      setPhase({ phase: 'result', result: finished, save: { status: 'saved', withSnapshot: !!snap }, previous }, { quiet: true });
    } catch (e) {
      console.warn('[wys] could not save to history', e);
      setPhase(
        { phase: 'result', result: finished, save: { status: 'failed', message: e instanceof Error ? e.message : String(e) }, previous },
        { quiet: true },
      );
      return;
    }
    try {
      const pre = await lookups.all;
      const extra = await sourceLookups(
        finished.sources.map((x) => x.domain || x.url),
        finished.originalSource?.url,
        s,
        controller.signal,
      );
      finished = attachLookups(finished, pre, extra);
      // The row exists; re-put it with the evidence attached even if a newer run has taken the view.
      await saveCheck(finished, snap);
      if (stale()) return;
      setPhase({ phase: 'result', result: finished, save: { status: 'saved', withSnapshot: !!snap }, previous }, { quiet: true });
    } catch (e) {
      console.warn('[wys] lookups failed', e);
    }
  }, []);

  /** Cancel lands at once: the run is made stale so nothing it still awaits can write over the cancelled state. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    runSeq.current++;
    const input = currentInput.current;
    if (input) {
      setPhaseState({ phase: 'error', input, error: { code: 'cancelled', message: 'Cancelled.' }, seq: ++seq.current });
      depsRef.current.onPhase({ phase: 'error', input, error: { code: 'cancelled', message: 'Cancelled.' } });
    }
  }, []);
  const clearSetup = useCallback(() => setPhaseState((p) => (p.phase === 'setup' ? { phase: 'idle', seq: ++seq.current } : p)), []);
  return { phase, start, cancel, clearSetup, busy: phase.phase === 'checking' };
}
