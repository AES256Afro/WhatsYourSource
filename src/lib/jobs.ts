import { browser } from 'wxt/browser';
import { JobSchema, type CheckInput, type Job } from './messaging/protocol';

/**
 * The background hands work to the side panel through `storage.session`, not messaging:
 * the panel may not be open yet when the user clicks, and a message to nobody is lost.
 * The panel reads the pending job on mount and listens for later ones.
 */
const KEY = 'pendingJob';

export async function enqueueJob(input: CheckInput, tabId?: number): Promise<Job> {
  const job: Job = { id: crypto.randomUUID(), createdAt: Date.now(), tabId, input };
  await browser.storage.session.set({ [KEY]: job });
  return job;
}

export async function takeJob(): Promise<Job | null> {
  const r = await browser.storage.session.get(KEY);
  const parsed = JobSchema.safeParse(r[KEY]);
  if (!parsed.success) return null;
  await browser.storage.session.remove(KEY);
  return parsed.data;
}

export function onJob(cb: (job: Job) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'session') return;
    const change = changes[KEY];
    if (!change?.newValue) return;
    const parsed = JobSchema.safeParse(change.newValue);
    if (parsed.success) {
      void browser.storage.session.remove(KEY);
      cb(parsed.data);
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
