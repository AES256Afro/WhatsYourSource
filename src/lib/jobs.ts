import { browser } from 'wxt/browser';
import { clampInput, JobSchema, type CheckInput, type Job } from './messaging/protocol';

export type { Job } from './messaging/protocol';

/**
 * The background hands work to the side panel through `storage.session`, not messaging:
 * the panel may not be open yet when the user clicks, and a message to nobody is lost.
 * The panel reads the pending job on mount and listens for later ones.
 */
const KEY = 'pendingJob';

export async function enqueueJob(input: CheckInput, tabId?: number, windowId?: number): Promise<Job> {
  const job: Job = { id: crypto.randomUUID(), createdAt: Date.now(), tabId, windowId, input: clampInput(input) };
  await browser.storage.session.set({ [KEY]: job });
  return job;
}

/**
 * The browser window this panel serves, or undefined when it serves any. A side panel / sidebar has
 * no tab of its own and belongs to its window; the fallback `sidepanel.html` *window* is itself a
 * tab in a popup window, which no producer can know the id of, so it takes whatever is queued.
 */
export async function currentWindowId(): Promise<number | undefined> {
  try {
    const self = await browser.tabs.getCurrent();
    if (self) return undefined;
    return (await browser.windows.getCurrent()).id;
  } catch {
    return undefined;
  }
}

/** Panels are per window; a job for another window is somebody else's. */
export function jobIsForWindow(job: Job, windowId: number | undefined): boolean {
  return job.windowId == null || windowId == null || job.windowId === windowId;
}

const instanceId = crypto.randomUUID();

/**
 * Two panels can both be entitled to a job (a sidebar and a fallback window for the same browser
 * window). storage has no atomic test-and-set, so: write my claim unless someone else's is there,
 * wait a beat, and run only if my claim is still the one on record. Both contenders read the same
 * final value, so at most one runs.
 */
export async function claimJob(id: string): Promise<boolean> {
  const key = `claim:${id}`;
  const before = (await browser.storage.session.get(key))[key];
  if (typeof before === 'string' && before !== instanceId) return false;
  await browser.storage.session.set({ [key]: instanceId });
  await new Promise((r) => setTimeout(r, 80));
  const after = (await browser.storage.session.get(key))[key];
  return after === instanceId;
}

export async function takeJob(): Promise<Job | null> {
  const r = await browser.storage.session.get(KEY);
  const parsed = JobSchema.safeParse(r[KEY]);
  if (!parsed.success) return null;
  if (!jobIsForWindow(parsed.data, await currentWindowId())) return null;
  if (!(await claimJob(parsed.data.id))) return null;
  await browser.storage.session.remove(KEY);
  return parsed.data;
}

export function onJob(cb: (job: Job) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'session') return;
    const change = changes[KEY];
    if (!change?.newValue) return;
    const parsed = JobSchema.safeParse(change.newValue);
    if (!parsed.success) return;
    void (async () => {
      if (!jobIsForWindow(parsed.data, await currentWindowId())) return;
      if (!(await claimJob(parsed.data.id))) return;
      void browser.storage.session.remove(KEY);
      cb(parsed.data);
    })();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
