import { useCallback, useEffect, useRef, useState } from 'react';
import { appendFollowUp, getCheck } from '@/lib/history/db';
import { cleanFollowUpQuestion, MAX_FOLLOW_UPS, runFollowUp } from '@/lib/pipeline/followUp';
import type { CheckResult, FollowUp } from '@/lib/pipeline/schema';
import { createProvider, providerRunLabel } from '@/lib/providers/registry';
import { describeProviderError } from '@/lib/providers/types';
import { LLM_PROVIDER_IDS, providerOrder, providerReady, type ProviderId, type Settings } from '@/lib/storage/settings';

/** The follow-up being answered right now. */
export interface PendingFollowUp {
  question: string;
  text: string;
  status: string;
}

/**
 * The model a follow-up goes to: the one that answered the check, while it is still set up; else
 * the provider checks use now. Null when nothing is set up (Google AI Mode is not a model we can ask).
 */
export function followUpProvider(result: CheckResult, s: Settings): ProviderId | null {
  const own = LLM_PROVIDER_IDS.find((id) => id === result.provider.id);
  if (own && providerReady(s, own)) return own;
  return providerOrder(s).find((id) => providerReady(s, id)) ?? LLM_PROVIDER_IDS.find((id) => providerReady(s, id)) ?? null;
}

/**
 * Threads by check id, kept while the panel is open: the result view comes and goes (History,
 * Settings), and a check that could not be saved has nowhere else to keep its follow-ups.
 */
const threads = new Map<string, FollowUp[]>();

/** The follow-up thread of one result: what was asked so far, the one in flight, and how to ask another. */
export function useFollowUps(result: CheckResult, settings: Settings | undefined) {
  const id = result.id;
  const [items, setItems] = useState<FollowUp[]>(() => threads.get(id) ?? result.followUps ?? []);
  const [pending, setPending] = useState<PendingFollowUp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Another result in the same view (a saved check opened from this one): start from its own thread.
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) {
    setShownId(id);
    setItems(threads.get(id) ?? result.followUps ?? []);
    setPending(null);
    setError(null);
  }

  // History is the record: the copy in hand may predate follow-ups asked from another view.
  useEffect(() => {
    let alive = true;
    void getCheck(id)
      .then((c) => {
        const stored = c?.result.followUps;
        if (!alive || !stored || stored.length <= (threads.get(id)?.length ?? 0)) return;
        threads.set(id, stored);
        setItems(stored);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      abort.current?.abort();
      abort.current = null;
    };
  }, [id]);

  const providerId = settings ? followUpProvider(result, settings) : null;
  const settingsRef = useRef(settings);
  const resultRef = useRef(result);
  const itemsRef = useRef(items);
  useEffect(() => {
    settingsRef.current = settings;
    resultRef.current = result;
    itemsRef.current = items;
  });

  /** Ask one question. Resolves true when it was answered, false when it failed or was stopped. */
  const ask = useCallback(
    async (raw: string): Promise<boolean> => {
      const s = settingsRef.current;
      const question = cleanFollowUpQuestion(raw);
      if (!s || !question || abort.current) return false;
      const pid = followUpProvider(resultRef.current, s);
      const provider = pid ? createProvider(pid, s) : null;
      if (!provider) return false;
      const controller = new AbortController();
      abort.current = controller;
      setError(null);
      let run: PendingFollowUp = { question, text: '', status: '' };
      setPending(run);
      // Streams arrive a few characters at a time; the view is refreshed at most every 40 ms.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        timer = undefined;
        if (!controller.signal.aborted) setPending(run);
      };
      let ok = false;
      try {
        // The model sees the thread as it stands now, including follow-ups asked since the result was made.
        const withThread = { ...resultRef.current, followUps: itemsRef.current };
        for await (const ev of runFollowUp(withThread, question, provider, controller.signal)) {
          if (controller.signal.aborted) break;
          if (ev.type === 'delta') {
            run = { ...run, text: run.text + ev.text };
            timer ??= setTimeout(flush, 40);
          } else if (ev.type === 'status') {
            run = { ...run, status: ev.message };
            timer ??= setTimeout(flush, 40);
          } else if (ev.type === 'done') {
            const next = [...itemsRef.current, ev.followUp].slice(-MAX_FOLLOW_UPS);
            threads.set(id, next);
            itemsRef.current = next;
            setItems(next);
            ok = true;
            void appendFollowUp(id, ev.followUp, MAX_FOLLOW_UPS).catch((e: unknown) => console.warn('[wys] could not save the follow-up', e));
          } else if (ev.code !== 'cancelled') {
            setError(describeProviderError(ev));
          }
        }
      } finally {
        if (timer) clearTimeout(timer);
        // A stopped or superseded run has already been cleared by whoever stopped it.
        if (abort.current === controller) {
          abort.current = null;
          setPending(null);
        }
      }
      return ok;
    },
    [id],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setPending(null);
  }, []);

  return {
    items,
    pending,
    error,
    ask,
    stop,
    /** Who will answer, for the box's label; null when no model is set up. */
    providerLabel: settings && providerId ? providerRunLabel(providerId, settings) : null,
  };
}

export type FollowUpThread = ReturnType<typeof useFollowUps>;
